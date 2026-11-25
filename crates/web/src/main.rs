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
    http::{HeaderValue, StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
    serve::ListenerExt,
};
use base64::{Engine, engine::general_purpose::STANDARD};
use clap::Parser;
use futures_util::SinkExt;
use mumh5_core::{identity::Identity, transport};
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
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    sync::Semaphore,
};
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
    rates: Mutex<Rates>,
}
/// Request budgets per client address and route class, in one-minute windows.
#[derive(Default)]
struct Rates {
    windows: HashMap<(IpAddr, Route), (Instant, u32)>,
    swept: Option<Instant>,
}
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
enum Route {
    Ping,
    Identity,
    Relay,
    Other,
}
impl Route {
    fn of(path: &str) -> Self {
        if path.ends_with("/ping") {
            Self::Ping
        } else if path.contains("/identity/") {
            Self::Identity
        } else if path.ends_with("/relay") {
            Self::Relay
        } else {
            Self::Other
        }
    }
    fn limit(self) -> u32 {
        match self {
            Self::Ping => 60,
            Self::Identity | Self::Relay => 20,
            Self::Other => 240,
        }
    }
}
/// Beyond this many tracked windows the oldest are forgotten; the limiter never refuses everyone.
const MAX_RATE_WINDOWS: usize = 20000;
const RATE_WINDOW: Duration = Duration::from_secs(60);
impl Rates {
    fn allow(&mut self, ip: IpAddr, route: Route) -> bool {
        let now = Instant::now();
        // Expired windows are swept at most every few seconds, not on every request.
        if self
            .swept
            .is_none_or(|t| now.duration_since(t) > Duration::from_secs(5))
        {
            self.windows
                .retain(|_, (at, _)| now.duration_since(*at) < RATE_WINDOW);
            self.swept = Some(now);
        }
        if self.windows.len() >= MAX_RATE_WINDOWS && !self.windows.contains_key(&(ip, route)) {
            let mut starts: Vec<Instant> = self.windows.values().map(|(at, _)| *at).collect();
            starts.sort_unstable();
            let cutoff = starts[starts.len() / 2];
            self.windows.retain(|_, (at, _)| *at > cutoff);
        }
        let entry = self.windows.entry((ip, route)).or_insert((now, 0));
        if now.duration_since(entry.0) >= RATE_WINDOW {
            *entry = (now, 0);
        }
        entry.1 += 1;
        entry.1 <= route.limit()
    }
}
impl App {
    fn rate(&self, ip: IpAddr, route: Route) -> bool {
        self.rates
            .lock()
            .map(|mut rates| rates.allow(ip, route))
            .unwrap_or(true)
    }
    fn address_slot(&self, ip: IpAddr) -> Option<tokio::sync::OwnedSemaphorePermit> {
        let mut map = self.addresses.lock().ok()?;
        // Only addresses with a live connection are kept, so this map never exceeds the
        // gateway's connection limit and new addresses are never refused for its size.
        map.retain(|_, s| {
            s.available_permits() < self.config.max_per_address || Arc::strong_count(s) > 1
        });
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
    let route = request.uri().path().to_owned();
    if !app.rate(client.ip(), Route::of(&route)) {
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
/// The largest text frame accepted after the handshake (mumpeer requests are well under 1 KiB).
const MAX_REQUEST_FRAME: usize = 4096;
const MAX_PENDING_REQUESTS: usize = 4;
async fn tunnel(mut ws: WebSocket, app: Shared, address: SocketAddr) -> Result<()> {
    let (events, mut replies) = tokio::sync::mpsc::channel::<Value>(64);
    let mut relays: Option<Arc<relay::Relays>> = None;
    // Mumpeer requests handled at once per connection; opening a link can take seconds.
    let requests = Arc::new(Semaphore::new(MAX_PENDING_REQUESTS));
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
        // One task owns both ends: no channel hop, split lock or cross-thread wakeup per packet.
        let mut link = transport::Link::open(
            host,
            port,
            &identity,
            Some(resolved),
            app.config.send_proxy.then_some(address),
        )
        .await?;
        // Mumble only ever sees the gateway's address; the browser is told its own so the app can
        // show it (UserInfoDialog)
        let mut info = link.secure.clone();
        info["clientAddress"] = json!(address.ip().to_canonical().to_string());
        ws.send(Message::Text(
            json!({"type":"secure","info":info}).to_string().into(),
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
        let mut buffer = vec![0; transport::READ_BUFFER];
        loop {
            tokio::select! {
                frame = ws.recv() => match frame {
                    Some(Ok(Message::Binary(b))) => {
                        if b.len() > transport::MAX_WRITE {
                            anyhow::bail!("Frame too large");
                        }
                        link.stream.write_all(&b).await.context("Writing Mumble TLS stream")?;
                    }
                    Some(Ok(Message::Text(t))) => {
                        // Text frames after the handshake are small mumpeer requests; others are ignored.
                        if t.len() > MAX_REQUEST_FRAME {
                            anyhow::bail!("Request too large");
                        }
                        let Ok(msg) = serde_json::from_str::<Value>(&t) else { continue };
                        if !msg["type"].as_str().is_some_and(|t| t.starts_with("relay-")) {
                            continue;
                        }
                        let permit = requests.clone().try_acquire_owned();
                        match (&relays, permit) {
                            (Some(relays), Ok(permit)) => {
                                let relays = relays.clone();
                                tokio::spawn(async move {
                                    let _permit = permit;
                                    relays.handle(msg).await;
                                });
                            }
                            (relays, _) => {
                                if let Some(n) = msg["n"].as_u64() {
                                    let reason = if relays.is_some() { "Too many mumpeer requests at once" } else { "Mumpeer is unavailable on this proxy" };
                                    let fail = json!({"type":"relay-fail","n":n,"reason":reason});
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
                // Cancel safe: a read dropped by another branch has consumed nothing.
                n = link.stream.read(&mut buffer) => match n.context("Reading Mumble TLS stream")? {
                    0 => return Err(transport::closed_by_server()),
                    n => ws.send(Message::Binary(buffer[..n].to_vec().into())).await?,
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
    let static_files = Router::new()
        .fallback_service(assets)
        .layer(middleware::from_fn(cache_headers));
    let router = Router::new()
        .nest("/api", api)
        .fallback_service(static_files)
        .with_state(app);
    let service = router.into_make_service_with_connect_info::<SocketAddr>();
    let stop = tokio_util::sync::CancellationToken::new();
    let Some(shards) = shard_count() else {
        let listener = tokio::net::TcpListener::bind(bind).await?;
        println!("mumh5: http://{}", listener.local_addr()?);
        let stopped = stop.clone();
        tokio::spawn(async move {
            shutdown_signal().await;
            stopped.cancel();
        });
        return serve(listener, service, stop).await;
    };
    // Each shard is a single-threaded runtime with its own listener on the same port; the
    // kernel spreads connections over them. A connection's WebSocket, Mumble socket and tunnel
    // then stay on one thread, while the work-stealing runtime woke idle workers on every packet.
    let first = listen(bind, shards > 1)?;
    let bind = first.local_addr()?;
    let mut listeners = vec![first];
    for _ in 1..shards {
        listeners.push(listen(bind, true)?);
    }
    println!("mumh5: http://{bind}");
    let threads = listeners
        .into_iter()
        .enumerate()
        .map(|(n, listener)| {
            let service = service.clone();
            let stop = stop.clone();
            std::thread::Builder::new()
                .name(format!("mumh5-shard-{n}"))
                .spawn(move || {
                    tokio::runtime::Builder::new_current_thread()
                        .enable_all()
                        .build()?
                        .block_on(async {
                            let listener = tokio::net::TcpListener::from_std(listener)?;
                            serve(listener, service, stop).await
                        })
                })
        })
        .collect::<std::io::Result<Vec<_>>>()?;
    tokio::select! {
        _ = shutdown_signal() => {}
        _ = stop.cancelled() => {}
    }
    stop.cancel();
    let joined = tokio::task::spawn_blocking(move || {
        threads.into_iter().try_for_each(|thread| {
            thread
                .join()
                .map_err(|_| anyhow::anyhow!("Gateway thread panicked"))?
        })
    });
    joined.await?
}

/// Listener shards (MUMH5_THREADS, default 1). Every thread that sleeps in epoll is woken
/// per packet, while one busy thread takes many ready sockets per wakeup: at 14,400 voice
/// packets/s one shard used half the CPU of 16. Raise it when one core is not enough. Only
/// Linux spreads connections over listeners sharing a port; elsewhere the main runtime serves.
fn shard_count() -> Option<usize> {
    if !cfg!(target_os = "linux") {
        return None;
    }
    Some(
        std::env::var("MUMH5_THREADS")
            .ok()
            .and_then(|v| v.parse::<usize>().ok())
            .filter(|n| *n > 0)
            .unwrap_or(1),
    )
}

/// `shared` lets the shards bind one port. Only then: a lone listener with SO_REUSEPORT would let
/// a second gateway started by mistake bind the same port and take part of the connections,
/// instead of failing with "address in use".
fn listen(bind: SocketAddr, shared: bool) -> Result<std::net::TcpListener> {
    let socket = if bind.is_ipv4() {
        tokio::net::TcpSocket::new_v4()?
    } else {
        tokio::net::TcpSocket::new_v6()?
    };
    socket.set_reuseaddr(true)?;
    #[cfg(target_os = "linux")]
    socket.set_reuseport(shared)?;
    socket.bind(bind)?;
    Ok(socket.listen(1024)?.into_std()?)
}

/// Ctrl-C, or SIGTERM from `docker stop` and service managers. Without SIGTERM, Docker waited its
/// grace period (10 s) and then killed the gateway, so a restart kept web clients offline longer.
async fn shutdown_signal() {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{SignalKind, signal};
        if let Ok(mut term) = signal(SignalKind::terminate()) {
            tokio::select! {
                _ = tokio::signal::ctrl_c() => {}
                _ = term.recv() => {}
            }
            return;
        }
    }
    let _ = tokio::signal::ctrl_c().await;
}

async fn serve(
    listener: tokio::net::TcpListener,
    service: axum::extract::connect_info::IntoMakeServiceWithConnectInfo<Router, SocketAddr>,
    stop: tokio_util::sync::CancellationToken,
) -> Result<()> {
    // Without it, Nagle and delayed ACKs hold every later response on a keep-alive
    // connection (and small WebSocket voice frames) for about 40 ms.
    let listener = listener.tap_io(|tcp| {
        let _ = tcp.set_nodelay(true);
    });
    let result = axum::serve(listener, service)
        .with_graceful_shutdown(stop.clone().cancelled_owned())
        .await;
    // One shard failing stops the gateway rather than leaving it half served.
    stop.cancel();
    Ok(result?)
}

/// Only files under `assets/` carry a content hash in their name. The page, the service worker,
/// `version.json`, the manifest and the icons keep theirs across deploys and must stay fresh.
async fn cache_headers(req: Request, next: Next) -> Response {
    let hashed = req.uri().path().starts_with("/assets/");
    let mut res = next.run(req).await;
    // A missing asset falls back to the page, which must never be kept
    let page = res
        .headers()
        .get(header::CONTENT_TYPE)
        .is_some_and(|v| v.as_bytes().starts_with(b"text/html"));
    let value = if hashed && !page && res.status().is_success() {
        "public, max-age=31536000, immutable"
    } else {
        "no-cache"
    };
    res.headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static(value));
    res
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn one_client_cannot_lock_out_others() {
        let mut rates = Rates::default();
        let attacker: IpAddr = "203.0.113.1".parse().unwrap();
        // Distinct paths fall into one route class, so the attacker only spends its own budget.
        let allowed = (0..30000)
            .filter(|n| rates.allow(attacker, Route::of(&format!("/api/identity/{n}"))))
            .count();
        assert_eq!(allowed, Route::Identity.limit() as usize);
        assert!(rates.allow("203.0.113.2".parse().unwrap(), Route::Identity));
        assert!(rates.windows.len() < MAX_RATE_WINDOWS);
    }
    #[test]
    fn many_addresses_evict_old_windows_instead_of_refusing() {
        let mut rates = Rates::default();
        for n in 0..(MAX_RATE_WINDOWS as u32 + 500) {
            let ip = IpAddr::from(std::net::Ipv4Addr::from(0x0a00_0000 + n));
            assert!(rates.allow(ip, Route::Other));
        }
        assert!(rates.windows.len() <= MAX_RATE_WINDOWS);
    }
}
