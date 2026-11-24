use anyhow::{Context, Result, bail};
use base64::{Engine, engine::general_purpose::STANDARD};
use dream_cord_core::{
    transport::Transport,
    udp_transport::{self, Command},
};
use dream_cord_platform::{
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
}
struct AppState {
    profile: Arc<Mutex<Profile>>,
    wires: Arc<Mutex<HashMap<String, Wire>>>,
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
            "showWindow" => {
                if let Some(w) = app.get_webview_window("main") {
                    w.show()?;
                    w.unminimize()?;
                    w.set_focus()?;
                }
                return Ok(Value::Null);
            }
            "attention" => {
                if let Some(w) = app.get_webview_window("main") {
                    w.request_user_attention(Some(tauri::UserAttentionType::Informational))?;
                }
                return Ok(Value::Null);
            }
            "updateTray" => {
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
                    let data = certificates::export(&i, string(&args, "password"), "Dream Cord")?;
                    drop(p);
                    let Some(path) = app
                        .dialog()
                        .file()
                        .add_filter("Identity backup", &["p12"])
                        .set_file_name("dream-cord-identity.p12")
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
                        out.push(dream_cord_core::certificates::describe(&cert)?);
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
                    let i = certificates::import(&std::fs::read(path)?, "")?;
                    p.add(string(&args, "name").into(), i)
                }
                _ => bail!("Unknown platform operation"),
            }
        })
        .await?
    }
    work(action, args, &state, app).await.map_err(failure)
}
fn find_mumble() -> Option<PathBuf> {
    let home = std::env::var_os("HOME").map(PathBuf::from)?;
    [
        home.join(".config/Mumble/MumbleAutomaticCertificateBackup.p12"),
        home.join(".local/share/Mumble/MumbleAutomaticCertificateBackup.p12"),
        home.join(".local/share/mumble/MumbleAutomaticCertificateBackup.p12"),
    ]
    .into_iter()
    .find(|p| p.is_file())
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
               tokio::select!{_ = cancel.cancelled()=>break,r=tokio::time::timeout(std::time::Duration::from_secs(30),acks.recv())=>{if !matches!(r,Ok(Some(()))){reason="Frontend stopped receiving data".into();break;}}}
              },Some(Err(e))=>{reason=e.to_string();break;},None=>break
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
#[cfg(feature = "smoke-test")]
#[tauri::command]
fn smoke_report(report: Value, app: tauri::AppHandle) {
    if let Some(path) = std::env::var_os("DREAM_CORD_SMOKE_REPORT") {
        let _ = std::fs::write(path, serde_json::to_vec_pretty(&report).unwrap());
        app.exit(if report["ok"] == true { 0 } else { 1 });
    }
}
pub fn run() {
    use tauri::{
        Emitter,
        menu::{Menu, MenuItem},
        tray::TrayIconBuilder,
    };
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init());
    #[cfg(feature = "smoke-test")]
    let builder = builder.invoke_handler(tauri::generate_handler![
        platform_call,
        wire_open,
        wire_send,
        wire_ack,
        wire_close,
        wire_udp,
        smoke_report
    ]);
    #[cfg(not(feature = "smoke-test"))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        platform_call,
        wire_open,
        wire_send,
        wire_ack,
        wire_close,
        wire_udp
    ]);
    builder
        .setup(|app| {
            let directory = std::env::var_os("DREAM_CORD_PROFILE")
                .map(PathBuf::from)
                .unwrap_or(app.path().app_data_dir()?);
            app.manage(AppState {
                profile: Arc::new(Mutex::new(Profile::open(directory.clone())?)),
                wires: Arc::new(Mutex::new(HashMap::new())),
            });
            let menu = Menu::with_items(
                app,
                &[
                    &MenuItem::with_id(app, "show", "Show Dream Cord", true, None::<&str>)?,
                    &MenuItem::with_id(app, "mute", "Toggle mute", true, None::<&str>)?,
                    &MenuItem::with_id(app, "deaf", "Toggle deafen", true, None::<&str>)?,
                    &MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?,
                    &MenuItem::with_id(app, "disconnect", "Disconnect", true, None::<&str>)?,
                    &MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?,
                ],
            )?;
            let tray = TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Dream Cord")
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
                .is_ok();
            let handle = app.handle().clone();
            let w = tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::App("index.html".into()),
            )
            .title("Dream Cord")
            .inner_size(1280., 800.)
            .min_inner_size(680., 480.)
            .data_directory(directory.join("webview"))
            .on_page_load(|webview, payload| {
                #[cfg(feature = "smoke-test")]
                if std::env::var_os("DREAM_CORD_SMOKE_REPORT").is_some()
                    && payload.event() == tauri::webview::PageLoadEvent::Finished
                {
                    let _ = webview.eval(include_str!("../tests/smoke.js"));
                }
                #[cfg(not(feature = "smoke-test"))]
                let _ = (webview, payload);
            })
            .on_permission_request(|webview, kind| {
                use tauri::webview::{PermissionKind, PermissionResponse};
                let local = webview.url().ok().is_some_and(|u| {
                    u.scheme() == "tauri"
                        || u.host_str() == Some("tauri.localhost")
                        || u.host_str() == Some("localhost") && u.port() == Some(1420)
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
                    || matches!(url.host_str(), Some("tauri.localhost" | "localhost"))
                        && url.port() == Some(1420)
                    || url.as_str().starts_with("http://tauri.localhost/");
                if !internal && matches!(url.scheme(), "https" | "http") {
                    use tauri_plugin_opener::OpenerExt;
                    let _ = handle.opener().open_url(url.as_str(), None::<&str>);
                }
                internal
            })
            .build()?;
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
            if matches!(event, tauri::WindowEvent::CloseRequested { .. })
                && w.app_handle().tray_by_id("main").is_some()
            {
                let _ = w.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("Dream Cord desktop failed");
}
