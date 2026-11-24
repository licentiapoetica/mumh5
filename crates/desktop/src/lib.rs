use anyhow::{Context, Result, bail};
use base64::{Engine, engine::general_purpose::STANDARD};
use mumh5_core::{
    transport::Transport,
    udp_transport::{self, Command},
};
use mumh5_platform::{
    certificates, network,
    profiles::{Profile, private_write},
};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tauri::{Manager, State, ipc::Channel};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;
struct Wire {
    send: mpsc::Sender<Vec<u8>>,
    udp: mpsc::Sender<Command>,
    ack: mpsc::Sender<()>,
    cancel: CancellationToken,
    identity: mumh5_core::identity::Identity,
    events: Channel<Value>,
    relays: Arc<tokio::sync::Mutex<HashMap<String, Arc<mumh5_platform::mumpeer::Link>>>>,
}
struct AppState {
    tray_state: Arc<Mutex<Value>>,
    attention: Arc<std::sync::atomic::AtomicBool>,
    audio: mumh5_platform::pipewire::ShareAudio,
    profile: Arc<Mutex<Profile>>,
    wires: Arc<Mutex<HashMap<String, Wire>>>,
}
/// The frontend dev server (`bun run dev`) counts as the app only in debug builds; in a release
/// another program listening on that port must get no navigation or microphone/camera grants.
fn dev_server(url: &tauri::Url) -> bool {
    cfg!(debug_assertions) && url.host_str() == Some("localhost") && url.port() == Some(1420)
}
fn string<'a>(v: &'a Value, k: &str) -> &'a str {
    v[k].as_str().unwrap_or("")
}
fn bytes(v: &Value, k: &str) -> Result<Vec<u8>> {
    Ok(STANDARD.decode(string(v, k))?)
}
fn failure(e: impl std::fmt::Display) -> String {
    e.to_string()
}
#[tauri::command]
async fn platform_call(
    action: String,
    args: Value,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> std::result::Result<Value, String> {
    async fn work(
        action: String,
        args: Value,
        state: &AppState,
        app: tauri::AppHandle,
    ) -> Result<Value> {
        match action.as_str() {
            #[cfg(mobile)]
            "attention" | "showWindow" | "updateTray" => return Ok(Value::Null),
            "shareInfo" => {
                return Ok(
                    json!({"portal":true,"audio":if cfg!(target_os="windows"){"loopback"}else if mumh5_platform::pipewire::ShareAudio::available().await{"pipewire"}else{"none"},"micLabel":mumh5_platform::pipewire::ShareAudio::label()}),
                );
            }
            "shareAudioApps" => return Ok(json!(state.audio.apps().await?)),
            "shareAudioStart" => {
                state.audio.start(args["target"].clone()).await?;
                return Ok(Value::Null);
            }
            "shareAudioStop" => {
                state.audio.stop().await?;
                return Ok(Value::Null);
            }
            "canPickColor" => return Ok(json!(mumh5_platform::color::available())),
            "pickColor" => return Ok(json!(mumh5_platform::color::pick().await?)),
            #[cfg(desktop)]
            "saveImage" | "copyImage" => {
                let data = if let Some(data) = args["data"].as_str() {
                    STANDARD.decode(data)?
                } else {
                    network::fetch(string(&args, "url"), 20 * 1024 * 1024)
                        .await?
                        .1
                };
                if data.len() > 20 * 1024 * 1024 {
                    bail!("Image is too large");
                }
                let copy = action == "copyImage";
                return tokio::task::spawn_blocking(move || -> Result<Value> {
                    if copy {
                        use tauri_plugin_clipboard_manager::ClipboardExt;
                        let mut reader = image::ImageReader::new(std::io::Cursor::new(&data))
                            .with_guessed_format()?;
                        let mut limits = image::Limits::default();
                        limits.max_alloc = Some(128 * 1024 * 1024);
                        limits.max_image_width = Some(8192);
                        limits.max_image_height = Some(8192);
                        reader.limits(limits);
                        let image = reader.decode()?.into_rgba8();
                        let (w, h) = image.dimensions();
                        app.clipboard()
                            .write_image(&tauri::image::Image::new_owned(image.into_raw(), w, h))?;
                    } else {
                        use tauri_plugin_dialog::DialogExt;
                        let Some(path) = app
                            .dialog()
                            .file()
                            .set_file_name("image.png")
                            .blocking_save_file()
                        else {
                            return Ok(Value::Null);
                        };
                        let path = path
                            .into_path()
                            .map_err(|e| anyhow::anyhow!(e.to_string()))?;
                        private_write(&path, &data)?;
                    }
                    Ok(Value::Null)
                })
                .await?;
            }
            "platformInfo" => {
                return Ok(json!({"os":std::env::consts::OS,"osVersion":std::env::consts::ARCH}));
            }
            "ping" => {
                return Ok(network::ping(
                    string(&args, "host"),
                    args["port"].as_u64().unwrap_or(64738) as u16,
                )
                .await
                .unwrap_or(Value::Null));
            }
            "linkPreview" => return network::link_preview(string(&args, "url")).await,
            "publicServers" => return network::public_servers(string(&args, "url")).await,
            #[cfg(desktop)]
            "showWindow" => {
                if let Some(w) = app.get_webview_window("main") {
                    w.show()?;
                    w.unminimize()?;
                    w.set_focus()?;
                }
                return Ok(Value::Null);
            }
            #[cfg(desktop)]
            "attention" => {
                state
                    .attention
                    .store(true, std::sync::atomic::Ordering::Relaxed);
                if let Some(w) = app.get_webview_window("main") {
                    w.request_user_attention(Some(tauri::UserAttentionType::Informational))?;
                }
                return Ok(Value::Null);
            }
            #[cfg(desktop)]
            "updateTray" => {
                *state
                    .tray_state
                    .lock()
                    .map_err(failure)
                    .map_err(anyhow::Error::msg)? = args.clone();
                if let Some(tray) = app.tray_by_id("main") {
                    tray.set_tooltip(Some(string(&args, "tooltip")))?;
                    if let Ok(data) =
                        STANDARD.decode(string(&args, "icon").split(',').next_back().unwrap_or(""))
                        && data.len() < 1024 * 1024
                        && let Ok(icon) = tauri::image::Image::from_bytes(&data)
                    {
                        tray.set_icon(Some(icon))?;
                    }
                }
                return Ok(Value::Null);
            }
            _ => {}
        }
        let profile = state.profile.clone();
        tokio::task::spawn_blocking(move || -> Result<Value> {
            let mut p = profile
                .lock()
                .map_err(|_| anyhow::anyhow!("Profile lock poisoned"))?;
            match action.as_str() {
                "bootstrap" => Ok(json!(p.state)),
                "stateWrite" => {
                    p.state_write(string(&args, "key").into(), string(&args, "raw").into())?;
                    Ok(Value::Null)
                }
                "identityList" => p.list(),
                "identityCreate" => {
                    let i = certificates::create(string(&args, "name"), string(&args, "email"))?;
                    p.add(string(&args, "name").into(), i)
                }
                "identityImport" => {
                    let i = certificates::import(&bytes(&args, "p12")?, string(&args, "password"))?;
                    p.add(string(&args, "name").into(), i)
                }
                "identityExport" => {
                    use tauri_plugin_dialog::DialogExt;
                    let i = p.identity(Some(string(&args, "id")))?;
                    let data = certificates::export(&i, string(&args, "password"), "mumh5")?;
                    drop(p);
                    let Some(path) = app
                        .dialog()
                        .file()
                        .add_filter("Identity backup", &["p12"])
                        .set_file_name("mumh5-identity.p12")
                        .blocking_save_file()
                    else {
                        return Ok(Value::Null);
                    };
                    let path = path
                        .into_path()
                        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
                    private_write(&path, &data)?;
                    Ok(json!(path.to_string_lossy()))
                }
                "identityChange" => p.change(
                    string(&args, "op"),
                    string(&args, "id"),
                    string(&args, "name"),
                ),
                "describeCerts" => {
                    let mut out = vec![];
                    for der in args["ders"].as_array().context("Missing certificates")? {
                        let cert = openssl::x509::X509::from_der(
                            &STANDARD.decode(der.as_str().context("Invalid certificate")?)?,
                        )?;
                        out.push(mumh5_core::certificates::describe(&cert)?);
                    }
                    Ok(json!(out))
                }
                "soundsLoad" => {
                    let path = p.directory.join("sounds/settings.json");
                    match std::fs::read(path) {
                        Ok(b) => Ok(serde_json::from_slice(&b)?),
                        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Value::Null),
                        Err(e) => Err(e.into()),
                    }
                }
                "soundsSave" => {
                    let dir = p.directory.join("sounds");
                    std::fs::create_dir_all(&dir)?;
                    private_write(
                        &dir.join("settings.json"),
                        &serde_json::to_vec(&args["settings"])?,
                    )?;
                    Ok(Value::Null)
                }
                "soundRead" | "soundWrite" | "soundRemove" => {
                    let key = string(&args, "key");
                    if key.is_empty()
                        || key.len() > 128
                        || !key.bytes().all(|c| {
                            c.is_ascii_alphanumeric() || c == b'-' || c == b'_' || c == b':'
                        })
                    {
                        bail!("Invalid sound key");
                    }
                    let dir = p.directory.join("sounds");
                    std::fs::create_dir_all(&dir)?;
                    let filename = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(key);
                    let path = dir.join(format!("{filename}.bin"));
                    match action.as_str() {
                        "soundRead" => Ok(std::fs::read(path)
                            .ok()
                            .map(|b| json!(STANDARD.encode(b)))
                            .unwrap_or(Value::Null)),
                        "soundWrite" => {
                            let b = bytes(&args, "data")?;
                            if b.len() > 128 * 1024 * 1024 {
                                bail!("Sound file too large");
                            }
                            private_write(&path, &b)?;
                            Ok(Value::Null)
                        }
                        _ => {
                            match std::fs::remove_file(path) {
                                Ok(()) => {}
                                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                                Err(e) => return Err(e.into()),
                            }
                            Ok(Value::Null)
                        }
                    }
                }
                "findMumble" => Ok(find_mumble()
                    .map(|_| json!({"name":"Mumble identity"}))
                    .unwrap_or(Value::Null)),
                "importMumble" => {
                    let path = find_mumble().context("Mumble certificate not found")?;
                    let i = certificates::import(&path, "")?;
                    p.add(string(&args, "name").into(), i)
                }
                _ => bail!("Unknown platform operation"),
            }
        })
        .await?
    }
    work(action, args, &state, app).await.map_err(failure)
}
fn find_mumble() -> Option<Vec<u8>> {
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)?;
    let config = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".config"));
    let roaming = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join("AppData/Roaming"));
    for path in [
        config.join("Mumble/Mumble/mumble_settings.json"),
        home.join("Library/Application Support/Mumble/Mumble/mumble_settings.json"),
        roaming.join("Mumble/Mumble/mumble_settings.json"),
    ] {
        if let Ok(data) = std::fs::read(path)
            && let Ok(settings) = serde_json::from_slice::<Value>(&data)
            && let Some(cert) = settings["certificate"].as_str()
            && let Ok(data) = STANDARD.decode(cert)
            && certificates::import(&data, "").is_ok()
        {
            return Some(data);
        }
    }
    [
        home.join(".config/Mumble/MumbleAutomaticCertificateBackup.p12"),
        home.join(".local/share/Mumble/MumbleAutomaticCertificateBackup.p12"),
        home.join(".local/share/mumble/MumbleAutomaticCertificateBackup.p12"),
    ]
    .into_iter()
    .find_map(|path| std::fs::read(path).ok())
}
#[tauri::command]
async fn wire_open(
    id: String,
    host: String,
    port: u16,
    identity_id: Option<String>,
    events: Channel<Value>,
    state: State<'_, AppState>,
) -> std::result::Result<(), String> {
    let identity = state
        .profile
        .lock()
        .map_err(failure)?
        .identity(identity_id.as_deref())
        .map_err(failure)?;
    let mut transport = Transport::connect(&host, port, &identity)
        .await
        .map_err(failure)?;
    let (udp, udp_rx) = mpsc::channel(64);
    let (udp_tx, mut udp_events) = mpsc::channel(64);
    let (ack, mut acks) = mpsc::channel(1);
    let cancel = transport.cancel.clone();
    let peer = transport.peer;
    {
        let mut wires = state.wires.lock().map_err(failure)?;
        if wires.contains_key(&id) {
            return Err("Connection already exists".into());
        }
        wires.insert(
            id.clone(),
            Wire {
                send: transport.send.clone(),
                udp,
                ack,
                cancel: cancel.clone(),
                identity,
                events: events.clone(),
                relays: Default::default(),
            },
        );
    }
    let secure = transport.secure.clone();
    if let Err(e) = events.send(json!({"event":"secure","args":[secure]})) {
        cancel.cancel();
        state.wires.lock().map_err(failure)?.remove(&id);
        return Err(failure(e));
    }
    let udp_cancel = cancel.clone();
    tokio::spawn(async move {
        let _ = udp_transport::run(peer, udp_rx, udp_tx, udp_cancel).await;
    });
    let wires = state.wires.clone();
    tokio::spawn(async move {
        let mut reason = "Connection closed".to_string();
        let mut udp_open = true;
        loop {
            tokio::select! {
             biased;
             _=cancel.cancelled()=>break,
             event=udp_events.recv(),if udp_open=>{if let Some(event)=event{if events.send(event).is_err(){break;}}else{udp_open=false;}},
             data=transport.receive.recv()=>match data{
              Some(Ok(data))=>{if events.send(json!({"event":"data","args":[data]})).is_err(){break;}
               // Backpressure only: a page the WebView throttles while hidden may answer late, and
               // the server (whose pings the page sends) decides when a silent client is gone.
               tokio::select!{_ = cancel.cancelled()=>break,r=acks.recv()=>{if r.is_none(){reason="Frontend stopped receiving data".into();break;}}}
              },Some(Err(e))=>{reason=format!("{e:#}");break;},None=>break
             }
            }
        }
        cancel.cancel();
        let _ = events.send(json!({"event":"close","args":[reason]}));
        if let Ok(mut w) = wires.lock() {
            w.remove(&id);
        }
    });
    Ok(())
}
#[tauri::command]
async fn wire_send(
    id: String,
    bytes: Vec<u8>,
    state: State<'_, AppState>,
) -> std::result::Result<(), String> {
    if bytes.len() > 8 * 1024 * 1024 {
        return Err("Frame too large".into());
    }
    let send = state
        .wires
        .lock()
        .map_err(failure)?
        .get(&id)
        .context("Connection closed")
        .map_err(failure)?
        .send
        .clone();
    send.send(bytes).await.map_err(failure)
}
#[tauri::command]
fn wire_ack(id: String, state: State<'_, AppState>) {
    if let Ok(wires) = state.wires.lock()
        && let Some(w) = wires.get(&id)
    {
        let _ = w.ack.try_send(());
    }
}
#[tauri::command]
fn wire_close(id: String, state: State<'_, AppState>) {
    if let Ok(wires) = state.wires.lock()
        && let Some(w) = wires.get(&id)
    {
        w.cancel.cancel();
    }
}
#[tauri::command]
async fn wire_udp(
    id: String,
    action: String,
    args: Value,
    state: State<'_, AppState>,
) -> std::result::Result<Value, String> {
    let tx = state
        .wires
        .lock()
        .map_err(failure)?
        .get(&id)
        .context("Connection closed")
        .map_err(failure)?
        .udp
        .clone();
    let b = |k| -> std::result::Result<Vec<u8>, String> {
        args[k]
            .as_array()
            .context("Missing UDP bytes")
            .map_err(failure)?
            .iter()
            .map(|n| {
                n.as_u64()
                    .filter(|n| *n <= 255)
                    .map(|n| n as u8)
                    .context("Invalid UDP byte")
                    .map_err(failure)
            })
            .collect()
    };
    let command = match action.as_str() {
        "setup" => Command::Setup(
            b("key")?,
            b("cn")?,
            b("sn")?,
            args["protobuf"].as_bool().unwrap_or(false),
        ),
        "nonce" => Command::Nonce(b("sn")?),
        "send" => Command::Send(b("bytes")?),
        "clientNonce" => {
            let (txreply, rx) = tokio::sync::oneshot::channel();
            tx.send(Command::ClientNonce(txreply))
                .await
                .map_err(failure)?;
            return Ok(json!(rx.await.map_err(failure)?));
        }
        _ => return Err("Unknown UDP operation".into()),
    };
    tx.send(command).await.map_err(failure)?;
    Ok(Value::Null)
}
#[tauri::command]
async fn wire_relay(
    id: String,
    action: String,
    args: Value,
    state: State<'_, AppState>,
) -> std::result::Result<Value, String> {
    async fn work(id: String, action: String, args: Value, state: &AppState) -> Result<Value> {
        let (relays, identity, cancel, events) = {
            let wires = state
                .wires
                .lock()
                .map_err(failure)
                .map_err(anyhow::Error::msg)?;
            let w = wires.get(&id).context("Connection closed")?;
            (
                w.relays.clone(),
                w.identity.clone(),
                w.cancel.clone(),
                w.events.clone(),
            )
        };
        let rid = string(&args, "rid").to_owned();
        if rid.is_empty() || rid.len() > 128 {
            bail!("Invalid relay ID");
        }
        let mut relays = relays.lock().await;
        match action.as_str() {
            "open" => {
                if relays.len() >= 16 || relays.contains_key(&rid) {
                    bail!("Relay already exists or limit reached");
                }
                let r = rid.clone();
                let link = mumh5_platform::mumpeer::Link::open(
                    serde_json::from_value(args["endpoint"].clone())?,
                    string(&args, "token").into(),
                    identity,
                    args["lowSide"].as_bool().unwrap_or(false),
                    cancel,
                    move |reason| {
                        let _ = events.send(json!({"event":"relayClose","args":[r,reason]}));
                    },
                )
                .await?;
                relays.insert(rid, link);
                Ok(Value::Null)
            }
            "turn" => {
                let lane = args["lane"]
                    .as_u64()
                    .filter(|n| *n <= 255)
                    .context("Invalid relay lane")? as u8;
                relays.get(&rid).context("Relay closed")?.turn(lane).await
            }
            "closeLane" => {
                if let Some(link) = relays.get(&rid) {
                    let lane = args["lane"]
                        .as_u64()
                        .filter(|n| *n <= 255)
                        .context("Invalid relay lane")? as u8;
                    link.close_lane(lane).await;
                }
                Ok(Value::Null)
            }
            "close" => {
                if let Some(link) = relays.remove(&rid) {
                    link.cancel.cancel();
                }
                Ok(Value::Null)
            }
            _ => bail!("Unknown relay operation"),
        }
    }
    work(id, action, args, &state).await.map_err(failure)
}
#[cfg(feature = "smoke-test")]
#[tauri::command]
fn smoke_report(report: Value, app: tauri::AppHandle) {
    if let Some(path) = std::env::var_os("MUMH5_SMOKE_REPORT") {
        let _ = std::fs::write(path, serde_json::to_vec_pretty(&report).unwrap());
        app.exit(if report["ok"] == true { 0 } else { 1 });
    }
}
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(desktop)]
    use tauri::Emitter;
    #[cfg(desktop)]
    use tauri::{
        menu::{Menu, MenuItem},
        tray::TrayIconBuilder,
    };
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_voice::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init());
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_clipboard_manager::init());
    #[cfg(feature = "smoke-test")]
    let builder = builder.invoke_handler(tauri::generate_handler![
        platform_call,
        wire_open,
        wire_send,
        wire_ack,
        wire_close,
        wire_udp,
        wire_relay,
        smoke_report
    ]);
    #[cfg(not(feature = "smoke-test"))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        platform_call,
        wire_open,
        wire_send,
        wire_ack,
        wire_close,
        wire_udp,
        wire_relay
    ]);
    builder
        .setup(|app| {
            let isolated = std::env::var_os("MUMH5_PROFILE").is_some();
            let directory = std::env::var_os("MUMH5_PROFILE")
                .map(PathBuf::from)
                .unwrap_or(app.path().app_data_dir()?);
            app.manage(AppState {
                tray_state: Default::default(),
                attention: Default::default(),
                audio: Default::default(),
                profile: Arc::new(Mutex::new(if isolated {
                    Profile::open(directory.clone())?
                } else {
                    Profile::open_migrating(directory.clone())?
                })),
                wires: Arc::new(Mutex::new(HashMap::new())),
            });
            #[cfg(desktop)]
            let tray = {
                let menu = Menu::with_items(
                    app,
                    &[
                        &MenuItem::with_id(app, "show", "Show mumh5", true, None::<&str>)?,
                        &MenuItem::with_id(app, "toggle-mute", "Toggle mute", true, None::<&str>)?,
                        &MenuItem::with_id(
                            app,
                            "toggle-deafen",
                            "Toggle deafen",
                            true,
                            None::<&str>,
                        )?,
                        &MenuItem::with_id(app, "mode:vad", "Voice activity", true, None::<&str>)?,
                        &MenuItem::with_id(app, "mode:ptt", "Push to talk", true, None::<&str>)?,
                        &MenuItem::with_id(
                            app,
                            "mode:continuous",
                            "Continuous transmission",
                            true,
                            None::<&str>,
                        )?,
                        &MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?,
                        &MenuItem::with_id(app, "disconnect", "Disconnect", true, None::<&str>)?,
                        &MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?,
                    ],
                )?;

                TrayIconBuilder::with_id("main")
                    .icon(app.default_window_icon().unwrap().clone())
                    .tooltip("mumh5")
                    .menu(&menu)
                    .on_menu_event(|app, event| match event.id.as_ref() {
                        "quit" => app.exit(0),
                        "show" => {
                            if let Some(w) = app.get_webview_window("main") {
                                let _ = w.show();
                                let _ = w.unminimize();
                                let _ = w.set_focus();
                            }
                        }
                        action => {
                            let _ = app.emit("tray-action", action);
                        }
                    })
                    .build(app)
                    .is_ok()
            };
            #[cfg(desktop)]
            {
                let handle = app.handle().clone();
                let state = app.state::<AppState>();
                let attention = state.attention.clone();
                let icons = state.tray_state.clone();
                tauri::async_runtime::spawn(async move {
                    let mut timer = tokio::time::interval(std::time::Duration::from_millis(600));
                    let mut lit = false;
                    let mut blinking = false;
                    loop {
                        timer.tick().await;
                        let alert = attention.load(std::sync::atomic::Ordering::Relaxed);
                        if !alert && !blinking {
                            continue;
                        }
                        blinking = alert;
                        lit = alert && !lit;
                        let icon = icons.lock().ok().and_then(|v| {
                            v[if lit { "alertIcon" } else { "icon" }]
                                .as_str()
                                .map(str::to_owned)
                        });
                        if let (Some(tray), Some(icon)) = (handle.tray_by_id("main"), icon)
                            && let Ok(bytes) =
                                STANDARD.decode(icon.split(',').next_back().unwrap_or(""))
                            && let Ok(image) = tauri::image::Image::from_bytes(&bytes)
                        {
                            let _ = tray.set_icon(Some(image));
                        }
                    }
                });
            }
            let handle = app.handle().clone();
            let popup_app = app.handle().clone();
            let w = tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::App("index.html".into()),
            )
            .title("mumh5")
            .inner_size(1280., 800.)
            .min_inner_size(680., 480.)
            .data_directory(directory.join("webview"))
            .on_page_load(|webview, payload| {
                #[cfg(feature = "smoke-test")]
                if std::env::var_os("MUMH5_SMOKE_REPORT").is_some()
                    && payload.event() == tauri::webview::PageLoadEvent::Finished
                {
                    let _ = webview.eval(include_str!("../tests/smoke.js"));
                }
                #[cfg(not(feature = "smoke-test"))]
                let _ = (webview, payload);
            })
            .on_new_window(move |url, features| {
                #[cfg(mobile)]
                {
                    let _ = (&popup_app, url, features);
                    tauri::webview::NewWindowResponse::Deny
                }
                #[cfg(desktop)]
                {
                    if url.as_str() != "about:blank" {
                        return tauri::webview::NewWindowResponse::Deny;
                    }
                    let label = format!("popup-{}", uuid::Uuid::new_v4());
                    match tauri::WebviewWindowBuilder::new(
                        &popup_app,
                        label,
                        tauri::WebviewUrl::External(url),
                    )
                    .window_features(features)
                    .title("mumh5")
                    .build()
                    {
                        Ok(window) => tauri::webview::NewWindowResponse::Create { window },
                        Err(_) => tauri::webview::NewWindowResponse::Deny,
                    }
                }
            })
            .on_permission_request(|webview, kind| {
                use tauri::webview::{PermissionKind, PermissionResponse};
                let local = webview.url().ok().is_some_and(|u| {
                    u.scheme() == "tauri"
                        || u.host_str() == Some("tauri.localhost")
                        || dev_server(&u)
                });
                if !local {
                    return PermissionResponse::Deny;
                }
                match kind {
                    PermissionKind::Microphone
                    | PermissionKind::Camera
                    | PermissionKind::DisplayCapture => PermissionResponse::Allow,
                    _ => PermissionResponse::Default,
                }
            })
            .on_navigation(move |url| {
                let internal = matches!(url.scheme(), "tauri" | "asset")
                    || url.host_str() == Some("tauri.localhost")
                    || dev_server(url);
                if !internal && matches!(url.scheme(), "https" | "http") {
                    use tauri_plugin_opener::OpenerExt;
                    let _ = handle.opener().open_url(url.as_str(), None::<&str>);
                }
                internal
            })
            .build()?;
            #[cfg(desktop)]
            w.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event
                    && tray
                {
                    api.prevent_close();
                }
            });
            // close-to-tray is performed by the window event handler below, while CLI remains independent.
            Ok(())
        })
        .on_window_event(|w, event| {
            #[cfg(desktop)]
            if matches!(event, tauri::WindowEvent::Focused(true)) {
                w.app_handle()
                    .state::<AppState>()
                    .attention
                    .store(false, std::sync::atomic::Ordering::Relaxed);
            }
            #[cfg(desktop)]
            if w.label() == "main"
                && matches!(event, tauri::WindowEvent::CloseRequested { .. })
                && w.app_handle().tray_by_id("main").is_some()
            {
                let _ = w.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("mumh5 desktop failed")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                let state = app.state::<AppState>();
                if let Ok(wires) = state.wires.lock() {
                    for wire in wires.values() {
                        wire.cancel.cancel();
                    }
                }
                tauri::async_runtime::block_on(state.audio.stop()).ok();
            }
        });
}
