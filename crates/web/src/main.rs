mod config;
mod relay;
// Browser frontend and Mumble WebSocket gateway, implemented entirely in Rust.
use anyhow::{Context, Result};
use axum::extract::{ConnectInfo, Extension};
use axum::{
    Json, Router,
    extract::Request,
    extract::{
        DefaultBodyLimit, State, WebSocketUpgrade,
        ws::{Message, WebSocket},
    },
    http::StatusCode,
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use base64::{Engine, engine::general_purpose::STANDARD};
use clap::Parser;
use futures_util::SinkExt;
use mumh5_core::{identity::Identity, transport::Transport};
use mumh5_platform::turn::TurnServer;
use mumh5_platform::{certificates, network};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    net::{IpAddr, SocketAddr},
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tokio::sync::Semaphore;
use tower_http::services::{ServeDir, ServeFile};
#[derive(Parser)]
#[command(about = "mumh5 browser UI and native Rust Mumble gateway")]
struct Options {
    #[arg(long)]
    bind: Option<SocketAddr>,
    /// Explicit permitted target, HOST[:PORT][=Label]; repeat for multiple servers.
    #[arg(long = "server")]
    servers: Vec<String>,
    /// Permit public targets; private targets require --allow-private or explicit --server.
    #[arg(long)]
    allow_any: bool,
    #[arg(long)]
    allow_private: bool,
    #[arg(long)]
    assets: Option<PathBuf>,
}
struct App {
    config: Arc<config::Config>,
    turn: Option<TurnServer>,
    crypto: Arc<Semaphore>,
    connections: Arc<Semaphore>,
    addresses: Mutex<HashMap<IpAddr, Arc<Semaphore>>>,
    rates: Mutex<HashMap<(IpAddr, String), (Instant, u32)>>,
}
impl App {
    fn rate(&self, ip: IpAddr, route: &str, limit: u32) -> bool {
        let Ok(mut rates) = self.rates.lock() else {
            return false;
        };
        rates.retain(|_, (at, _)| at.elapsed() < Duration::from_secs(60));
        if rates.len() > 20000 {
            return false;
        }
        let entry = rates
            .entry((ip, route.into()))
            .or_insert((Instant::now(), 0));
        entry.1 += 1;
        entry.1 <= limit
    }
    fn address_slot(&self, ip: IpAddr) -> Option<tokio::sync::OwnedSemaphorePermit> {
        let mut map = self.addresses.lock().ok()?;
        map.retain(|_, s| {
            s.available_permits() < self.config.max_per_address || Arc::strong_count(s) > 1
        });
        if map.len() > 20000 {
            return None;
        }
        map.entry(ip)
            .or_insert_with(|| Arc::new(Semaphore::new(self.config.max_per_address)))
            .clone()
            .try_acquire_owned()
            .ok()
    }
}
type Shared = Arc<App>;
type ApiResult = std::result::Result<Json<Value>, ApiError>;
struct ApiError(anyhow::Error);
impl<E: Into<anyhow::Error>> From<E> for ApiError {
    fn from(e: E) -> Self {
        Self(e.into())
    }
}
impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({"error":self.0.to_string()})),
        )
            .into_response()
    }
}
fn text<'a>(v: &'a Value, k: &str) -> &'a str {
    v[k].as_str().unwrap_or("")
}
fn target(v: &Value) -> Result<(&str, u16)> {
    let host = text(v, "host");
    let port = v["port"]
        .as_u64()
        .filter(|p| *p > 0 && *p <= 65535)
        .context("Invalid port")? as u16;
    if host.is_empty() || host.len() > 253 {
        anyhow::bail!("Invalid host");
    }
    Ok((host, port))
}
async fn origin_guard(
    State(app): State<Shared>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    mut request: Request,
    next: Next,
) -> Response {
    let client = if app.config.trust_proxy {
        request
            .headers()
            .get("x-forwarded-for")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.split(',').next_back())
            .and_then(|v| v.trim().parse::<IpAddr>().ok())
            .map(|ip| SocketAddr::new(ip, peer.port()))
            .unwrap_or(peer)
    } else {
        peer
    };
    request.extensions_mut().insert(client);
    let route = request.uri().path();
    let rate = if route.ends_with("/ping") {
        60
    } else if route.contains("/identity/") || route.ends_with("/relay") {
        20
    } else {
        240
    };
    if !app.rate(client.ip(), route, rate) {
        return (
            StatusCode::TOO_MANY_REQUESTS,
            "Too many requests; retry in a minute",
        )
            .into_response();
    }
    if route.ends_with("/relay") {
        let mut response = next.run(request).await;
        response
            .headers_mut()
            .insert("access-control-allow-origin", "*".parse().unwrap());
        return response;
    }
    // Browser requests must originate on the gateway itself. No wildcard CORS or ambient credentials.
    if let Some(origin) = request.headers().get("origin") {
        let valid = app
            .config
            .origins
            .iter()
            .any(|v| v == "*" || origin.to_str().ok() == Some(v.as_str()))
            || (app.config.origins.is_empty()
                && origin
                    .to_str()
                    .ok()
                    .and_then(reqwest_url)
                    .is_some_and(|authority| {
                        request
                            .headers()
                            .get("host")
                            .and_then(|v| v.to_str().ok())
                            .is_some_and(|host| host.eq_ignore_ascii_case(&authority))
                    }));
        if !valid {
            return (
                StatusCode::FORBIDDEN,
                Json(json!({"error":"Cross-origin gateway access is disabled"})),
            )
                .into_response();
        }
    }
    next.run(request).await
}
fn reqwest_url(s: &str) -> Option<String> {
    let uri: url::Url = s.parse().ok()?;
    if !matches!(uri.scheme(), "http" | "https") {
        return None;
    }
    Some(uri[url::Position::BeforeHost..url::Position::AfterPort].to_string())
}
async fn config(State(app): State<Shared>) -> Json<Value> {
    Json(
        json!({"servers":app.config.servers,"default":app.config.default,"any":app.config.allow_any,"stun":app.turn.as_ref().map(|t|t.port),"turn":app.turn.is_some()&&app.config.turn.as_ref().is_some_and(|o|o.relay),"mumpeer":mumpeer_issuer(&app).is_some(),"audioPackLimits":app.config.audio_limits}),
    )
}
/// The gateway keeps mumpeer links for browsers when its relay is on and relay ports are listed.
fn mumpeer_issuer(app: &App) -> Option<mumh5_platform::turn::LaneIssuer> {
    if app.config.mumpeer_ports.is_empty() || !app.config.turn.as_ref().is_some_and(|o| o.relay) {
        return None;
    }
    app.turn.as_ref()?.lane_issuer()
}
async fn relay(State(app): State<Shared>) -> Response {
    let Some(turn) = &app.turn else {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({"error":"No STUN or relay here"})),
        )
            .into_response();
    };
    if !app.config.turn.as_ref().is_some_and(|o| o.relay) {
        return Json(json!({"port":turn.port})).into_response();
    }
    match turn.credentials() {
        Ok((username, credential)) => {
            let mut v =
                json!({"port":turn.port,"username":username,"credential":credential,"ttl":43200});
            if !app.config.turn_urls.is_empty() {
                v["urls"] = json!(app.config.turn_urls);
            }
            Json(v).into_response()
        }
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}
async fn identity(
    State(app): State<Shared>,
    axum::extract::Path(action): axum::extract::Path<String>,
    Json(v): Json<Value>,
) -> ApiResult {
    let permit = app
        .crypto
        .clone()
        .try_acquire_owned()
        .map_err(|_| anyhow::anyhow!("Identity service busy; try again"))?;
    Ok(Json(tokio::task::spawn_blocking(move||->Result<Value>{let _permit=permit;match action.as_str(){
 "create"=>certificates::fresh(&certificates::create(text(&v,"name"),text(&v,"email"))?),
 "import"=>certificates::fresh(&certificates::import(&STANDARD.decode(text(&v,"p12"))?,text(&v,"password"))?),
 "export"=>{let i=Identity{cert_pem:text(&v,"certPem").into(),key_pem:text(&v,"keyPem").into()};Ok(json!({"p12":STANDARD.encode(certificates::export(&i,text(&v,"password"),text(&v,"name"))?)}))},_=>anyhow::bail!("Unknown identity operation")
 }}).await??))
}
async fn describe(Json(v): Json<Value>) -> ApiResult {
    let mut out = vec![];
    let ders = v["ders"].as_array().context("Missing certificates")?;
    if ders.len() > 16 {
        return Err(anyhow::anyhow!("Too many certificates").into());
    }
    for der in ders {
        let cert =
            openssl::x509::X509::from_der(&STANDARD.decode(der.as_str().context("Invalid DER")?)?)?;
        out.push(mumh5_core::certificates::describe(&cert)?);
    }
    Ok(Json(json!(out)))
}
async fn ping(State(app): State<Shared>, Json(v): Json<Value>) -> ApiResult {
    let (h, p) = target(&v)?;
    if !app.config.listed(h, p) {
        return Err(anyhow::anyhow!("Not a listed server of this proxy").into());
    }
    let address = app.config.address(h, p).await?;
    Ok(Json(
        network::ping(&address.ip().to_string(), p)
            .await
            .unwrap_or(Value::Null),
    ))
}
async fn connect(
    State(app): State<Shared>,
    Extension(address): Extension<SocketAddr>,
    ws: WebSocketUpgrade,
) -> Response {
    let Some(address_permit) = app.address_slot(address.ip()) else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            "Too many connections from this address",
        )
            .into_response();
    };
    let Ok(permit) = app.connections.clone().try_acquire_owned() else {
        return (StatusCode::SERVICE_UNAVAILABLE, "Too many connections").into_response();
    };
    ws.max_message_size(8 * 1024 * 1024)
        .max_frame_size(8 * 1024 * 1024)
        .on_upgrade(move |socket| async move {
            let _permit = permit;
            let _address_permit = address_permit;
            let _ = tunnel(socket, app, address).await;
        })
}
async fn tunnel(mut ws: WebSocket, app: Shared, address: SocketAddr) -> Result<()> {
    let (events, mut replies) = tokio::sync::mpsc::channel::<Value>(64);
    let mut relays: Option<Arc<relay::Relays>> = None;
    let result = async {
        let Some(Ok(Message::Text(hello))) =
            tokio::time::timeout(Duration::from_secs(10), ws.recv()).await?
        else {
            anyhow::bail!("Expected connection handshake");
        };
        if hello.len() > 128 * 1024 {
            anyhow::bail!("Handshake too large");
        }
        let hello: Value = serde_json::from_str(&hello)?;
        let (host, port) = target(&hello)?;
        let resolved = app.config.address(host, port).await?;
        let identity = Identity {
            cert_pem: text(&hello, "certPem").into(),
            key_pem: text(&hello, "keyPem").into(),
        };
        let mut transport = Transport::connect_to(
            host,
            port,
            &identity,
            Some(resolved),
            app.config.send_proxy.then_some(address),
        )
        .await?;
        ws.send(Message::Text(
            json!({"type":"secure","info":transport.secure})
                .to_string()
                .into(),
        ))
        .await?;
        // Once the connection is secure its identity may open mumpeer links.
        relays = mumpeer_issuer(&app).map(|issuer| {
            relay::Relays::new(
                app.config.clone(),
                issuer,
                relay::Target {
                    host: host.to_owned(),
                    guard: !app.config.allow_private && !app.config.listed(host, port),
                    identity,
                },
                events.clone(),
            )
        });
        loop {
            tokio::select! {
                frame = ws.recv() => match frame {
                    Some(Ok(Message::Binary(b))) => transport.send.send(b.to_vec()).await?,
                    Some(Ok(Message::Text(t))) => {
                        // Text frames after the handshake are mumpeer requests; others are ignored.
                        let Ok(msg) = serde_json::from_str::<Value>(&t) else { continue };
                        if !msg["type"].as_str().is_some_and(|t| t.starts_with("relay-")) {
                            continue;
                        }
                        match &relays {
                            Some(relays) => {
                                tokio::spawn(relays.clone().handle(msg));
                            }
                            None => {
                                if let Some(n) = msg["n"].as_u64() {
                                    let fail = json!({"type":"relay-fail","n":n,"reason":"Mumpeer is unavailable on this proxy"});
                                    ws.send(Message::Text(fail.to_string().into())).await?;
                                }
                            }
                        }
                    }
                    Some(Ok(Message::Ping(p))) => ws.send(Message::Pong(p)).await?,
                    Some(Ok(Message::Pong(_))) => {}
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Err(e)) => return Err(e.into()),
                },
                reply = replies.recv() => if let Some(reply) = reply {
                    ws.send(Message::Text(reply.to_string().into())).await?;
                },
                data = transport.receive.recv() => match data {
                    Some(Ok(b)) => ws.send(Message::Binary(b.into())).await?,
                    Some(Err(e)) => return Err(e),
                    None => break,
                },
            }
        }
        anyhow::Ok(())
    }
    .await;
    // Links end with the connection, before the close frame, and say nothing themselves.
    drop(relays);
    let reason = result
        .as_ref()
        .err()
        .map(|e| format!("{e:#}"))
        .unwrap_or_else(|| "Connection closed".into());
    let _ = ws
        .send(Message::Text(
            json!({"type":"close","reason":reason}).to_string().into(),
        ))
        .await;
    let _ = ws.close().await;
    result
}
#[tokio::main]
async fn main() -> Result<()> {
    let options = Options::parse();
    let mut cfg = config::Config::from_env()?;
    if let Some(bind) = options.bind {
        cfg.bind = bind;
    }
    if let Some(assets) = options.assets {
        cfg.assets = assets;
    }
    for s in options.servers {
        cfg.servers.extend(config::servers(&s)?);
    }
    cfg.allow_any |= options.allow_any;
    cfg.allow_private |= options.allow_private;
    if cfg.servers.is_empty() && !cfg.allow_any {
        anyhow::bail!("Set MUMH5_SERVERS, MUMH5_DEFAULT_SERVER, --server or --allow-any");
    }
    let turn = if let Some(opts) = cfg.turn.clone() {
        Some(TurnServer::start(opts, None).await?)
    } else {
        None
    };
    let assets_path = cfg.assets.clone();
    let bind = cfg.bind;
    if cfg.debug {
        eprintln!(
            "mumh5 gateway: {} permitted targets, {} connection slots",
            cfg.servers.len(),
            cfg.max_connections
        );
    }
    let app = Arc::new(App {
        crypto: Arc::new(Semaphore::new(4)),
        connections: Arc::new(Semaphore::new(cfg.max_connections)),
        addresses: Default::default(),
        rates: Default::default(),
        config: Arc::new(cfg),
        turn,
    });
    let api = Router::new()
        .route("/config", get(config))
        .route("/identity/{action}", post(identity))
        .route("/certs/describe", post(describe))
        .route("/ping", post(ping))
        .route("/connect", get(connect))
        .route("/relay", get(relay))
        .layer(DefaultBodyLimit::max(4 * 1024 * 1024))
        .layer(middleware::from_fn_with_state(app.clone(), origin_guard));
    let assets = ServeDir::new(&assets_path)
        .not_found_service(ServeFile::new(assets_path.join("index.html")));
    let router = Router::new()
        .nest("/api", api)
        .fallback_service(assets)
        .with_state(app);
    let listener = tokio::net::TcpListener::bind(bind).await?;
    println!("mumh5: http://{}", listener.local_addr()?);
    axum::serve(
        listener,
        router.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(async {
        let _ = tokio::signal::ctrl_c().await;
    })
    .await?;
    Ok(())
}
