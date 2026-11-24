//! Browser frontend and Mumble WebSocket gateway, implemented entirely in Rust.
use anyhow::{Context, Result};
use axum::{
    Json, Router,
    extract::Request,
    extract::{
        DefaultBodyLimit, State, WebSocketUpgrade,
        ws::{Message, WebSocket},
    },
    http::{HeaderMap, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use base64::{Engine, engine::general_purpose::STANDARD};
use clap::Parser;
use dream_cord_core::{identity::Identity, transport::Transport};
use dream_cord_platform::{certificates, network};
use futures_util::SinkExt;
use serde_json::{Value, json};
use std::{path::PathBuf, sync::Arc, time::Duration};
use tokio::sync::Semaphore;
use tower_http::services::{ServeDir, ServeFile};
#[derive(Parser)]
#[command(about = "Dream Cord browser UI and native Rust Mumble gateway")]
struct Options {
    #[arg(long, default_value = "127.0.0.1:8080")]
    bind: std::net::SocketAddr,
    /// Explicitly permitted Mumble target (HOST:PORT); repeat for multiple servers.
    #[arg(long = "server")]
    servers: Vec<String>,
    /// Permit arbitrary targets, including private network addresses. Use only for trusted users.
    #[arg(long)]
    allow_any: bool,
    #[arg(long, default_value = "frontend/dist")]
    assets: PathBuf,
}
struct App {
    servers: Vec<(String, u16)>,
    allow_any: bool,
    crypto: Arc<Semaphore>,
    connections: Arc<Semaphore>,
}
impl App {
    fn allowed(&self, host: &str, port: u16) -> bool {
        port > 0
            && (self.allow_any
                || self
                    .servers
                    .iter()
                    .any(|(h, p)| h.eq_ignore_ascii_case(host) && *p == port))
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
async fn origin_guard(request: Request, next: Next) -> Response {
    // Browser requests must originate on the gateway itself. No wildcard CORS or ambient credentials.
    if let Some(origin) = request.headers().get("origin") {
        let valid = origin
            .to_str()
            .ok()
            .and_then(reqwest_url)
            .is_some_and(|authority| {
                request
                    .headers()
                    .get("host")
                    .and_then(|v| v.to_str().ok())
                    .is_some_and(|host| host.eq_ignore_ascii_case(&authority))
            });
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
        json!({"servers":app.servers.iter().map(|(host,port)|json!({"host":host,"port":port,"label":host})).collect::<Vec<_>>(),"any":app.allow_any,"stun":null,"turn":false}),
    )
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
        out.push(dream_cord_core::certificates::describe(&cert)?);
    }
    Ok(Json(json!(out)))
}
async fn ping(State(app): State<Shared>, Json(v): Json<Value>) -> ApiResult {
    let (h, p) = target(&v)?;
    if !app.allowed(h, p) {
        return Err(anyhow::anyhow!("Server is not permitted by this gateway").into());
    }
    Ok(Json(network::ping(h, p).await.unwrap_or(Value::Null)))
}
async fn connect(State(app): State<Shared>, ws: WebSocketUpgrade, headers: HeaderMap) -> Response {
    let Ok(permit) = app.connections.clone().try_acquire_owned() else {
        return (StatusCode::SERVICE_UNAVAILABLE, "Too many connections").into_response();
    };
    let address = headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    ws.max_message_size(8 * 1024 * 1024)
        .max_frame_size(8 * 1024 * 1024)
        .on_upgrade(move |socket| async move {
            let _permit = permit;
            let _ = tunnel(socket, app, address).await;
        })
}
async fn tunnel(mut ws: WebSocket, app: Shared, _address: String) -> Result<()> {
    let result=async{
  let Some(Ok(Message::Text(hello)))=tokio::time::timeout(Duration::from_secs(10),ws.recv()).await? else{anyhow::bail!("Expected connection handshake");};
  if hello.len()>128*1024{anyhow::bail!("Handshake too large");}let hello:Value=serde_json::from_str(&hello)?;let(host,port)=target(&hello)?;
  if !app.allowed(host,port){anyhow::bail!("Server is not permitted by this gateway");}
  let identity=Identity{cert_pem:text(&hello,"certPem").into(),key_pem:text(&hello,"keyPem").into()};
  let mut transport=Transport::connect(host,port,&identity).await?;
  ws.send(Message::Text(json!({"type":"secure","info":transport.secure}).to_string().into())).await?;
  loop{tokio::select!{
   frame=ws.recv()=>match frame{Some(Ok(Message::Binary(b)))=>transport.send.send(b.to_vec()).await?,Some(Ok(Message::Ping(p)))=>ws.send(Message::Pong(p)).await?,Some(Ok(Message::Pong(_)))=>{},Some(Ok(Message::Close(_)))|None=>break,Some(Err(e))=>return Err(e.into()),_=>anyhow::bail!("Expected binary Mumble frames")},
   data=transport.receive.recv()=>match data{Some(Ok(b))=>ws.send(Message::Binary(b.into())).await?,Some(Err(e))=>return Err(e),None=>break}
  }}anyhow::Ok(())
 }.await;
    let reason = result
        .as_ref()
        .err()
        .map(|e| e.to_string())
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
    let mut servers = vec![];
    for server in options.servers {
        let (h, p) = server.rsplit_once(':').context("Use --server HOST:PORT")?;
        let p = p.parse::<u16>()?;
        if h.is_empty() || p == 0 {
            anyhow::bail!("Invalid server");
        }
        servers.push((h.trim_matches(['[', ']']).to_string(), p));
    }
    if servers.is_empty() && !options.allow_any {
        anyhow::bail!("Specify at least one --server HOST:PORT, or explicitly enable --allow-any");
    }
    let app = Arc::new(App {
        servers,
        allow_any: options.allow_any,
        crypto: Arc::new(Semaphore::new(4)),
        connections: Arc::new(Semaphore::new(128)),
    });
    let api=Router::new().route("/config",get(config)).route("/identity/{action}",post(identity)).route("/certs/describe",post(describe)).route("/ping",post(ping)).route("/connect",get(connect)).route("/relay",get(||async{(StatusCode::NOT_FOUND,Json(json!({"error":"Configure STUN/TURN in sharing settings; built-in relay is unavailable"})))})).layer(DefaultBodyLimit::max(4*1024*1024)).layer(middleware::from_fn(origin_guard));
    let assets = ServeDir::new(&options.assets)
        .not_found_service(ServeFile::new(options.assets.join("index.html")));
    let router = Router::new()
        .nest("/api", api)
        .fallback_service(assets)
        .with_state(app);
    let listener = tokio::net::TcpListener::bind(options.bind).await?;
    println!("Dream Cord: http://{}", listener.local_addr()?);
    axum::serve(listener, router)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn targets_require_exact_explicit_allowlist() {
        let a = App {
            servers: vec![("voice.example".into(), 64738)],
            allow_any: false,
            crypto: Arc::new(Semaphore::new(1)),
            connections: Arc::new(Semaphore::new(1)),
        };
        assert!(a.allowed("VOICE.example", 64738));
        assert!(!a.allowed("127.0.0.1", 64738));
        assert!(!a.allowed("voice.example", 80));
        assert!(target(&json!({"host":"x","port":65536})).is_err());
    }
}
