use crate::{
    audio::Audio,
    crypt::Crypt,
    identity,
    proto::{control as pb, udp},
    signal::Assembler,
    video::{self, VideoCommand, VideoFrame},
};
use anyhow::{Context, Result, anyhow, bail};
use base64::{Engine, engine::general_purpose::STANDARD};
use openssl::{hash::MessageDigest, x509::X509VerifyResult};
use prost::Message;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, HashSet, VecDeque},
    path::PathBuf,
    pin::Pin,
    sync::{Arc, RwLock},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpStream, UdpSocket},
    sync::{mpsc, oneshot},
    time::{MissedTickBehavior, interval, timeout},
};
use tokio_openssl::SslStream;
use tokio_util::sync::CancellationToken;

pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
#[derive(Clone, Debug)]
pub struct Options {
    pub host: String,
    pub port: u16,
    pub name: String,
    pub state_dir: PathBuf,
    pub password: Option<String>,
    pub trust_new: bool,
    pub server_fingerprint: Option<String>,
    pub tokens: Vec<String>,
    pub tcp_only: bool,
    pub ice_servers: Value,
}
impl Options {
    pub fn new(
        host: impl Into<String>,
        name: impl Into<String>,
        state_dir: impl Into<PathBuf>,
    ) -> Self {
        Self {
            host: host.into(),
            port: 64738,
            name: name.into(),
            state_dir: state_dir.into(),
            password: None,
            trust_new: false,
            server_fingerprint: None,
            tokens: vec![],
            tcp_only: false,
            ice_servers: json!([]),
        }
    }
}
#[derive(Clone, Default, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct User {
    pub session: u32,
    pub name: String,
    pub channel_id: u32,
    pub user_id: Option<u32>,
    pub hash: String,
    pub mute: bool,
    pub deaf: bool,
    pub self_mute: bool,
    pub self_deaf: bool,
    pub suppress: bool,
}
#[derive(Clone, Default, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Channel {
    pub id: u32,
    pub name: String,
    pub parent: Option<u32>,
    pub description: String,
}
#[derive(Clone, Default, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct State {
    pub session: u32,
    pub users: BTreeMap<u32, User>,
    pub channels: BTreeMap<u32, Channel>,
    pub server_version: u64,
    pub connected: bool,
    pub udp: bool,
    pub video_shape: Option<(u32, u32)>,
}
impl State {
    pub fn own(&self) -> Option<&User> {
        self.users.get(&self.session)
    }
    pub fn path(&self, id: u32) -> String {
        let mut names = vec![];
        let mut current = Some(id);
        let mut seen = HashSet::new();
        while let Some(id) = current {
            if !seen.insert(id) {
                break;
            }
            let Some(ch) = self.channels.get(&id) else {
                break;
            };
            if id != 0 {
                names.push(ch.name.as_str());
            }
            current = ch.parent;
        }
        names.reverse();
        format!("/{}", names.join("/"))
    }
    pub fn user(&self, target: &Target) -> Result<u32> {
        match target {
            Target::Id(id) if self.users.contains_key(id) => Ok(*id),
            Target::Name(name) => {
                let ids: Vec<_> = self
                    .users
                    .values()
                    .filter(|u| &u.name == name)
                    .map(|u| u.session)
                    .collect();
                if ids.len() == 1 {
                    Ok(ids[0])
                } else {
                    bail!("User not found or ambiguous: {name}")
                }
            }
            _ => bail!("User not found"),
        }
    }
    pub fn channel(&self, target: &Target) -> Result<u32> {
        match target {
            Target::Id(id) if self.channels.contains_key(id) => Ok(*id),
            Target::Name(name) => {
                let ids: Vec<_> = self
                    .channels
                    .values()
                    .filter(|c| &c.name == name || self.path(c.id) == *name)
                    .map(|c| c.id)
                    .collect();
                if ids.len() == 1 {
                    Ok(ids[0])
                } else {
                    bail!("Channel not found or ambiguous: {name}")
                }
            }
            _ => bail!("Channel not found"),
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Target {
    Id(u32),
    Name(String),
}
#[derive(Clone)]
pub struct Client(pub(crate) Arc<Inner>);
pub(crate) struct Inner {
    pub state: Arc<RwLock<State>>,
    pub commands: mpsc::Sender<Request>,
    pub video: mpsc::Sender<VideoCommand>,
    pub cancel: CancellationToken,
}
impl Drop for Inner {
    fn drop(&mut self) {
        self.cancel.cancel();
    }
}
pub(crate) enum Operation {
    Flush,
    Json(Value),
    Pcm(Vec<i16>),
    Plugins {
        to: Vec<u32>,
        id: String,
        packets: Vec<Vec<u8>>,
    },
}
pub(crate) struct Request {
    pub op: Operation,
    pub reply: oneshot::Sender<Result<Value>>,
}
pub struct Connection {
    pub client: Client,
    pub events: mpsc::Receiver<Value>,
    pub audio: mpsc::Receiver<Vec<i16>>,
    pub video: mpsc::Receiver<VideoFrame>,
}
impl Client {
    pub async fn connect(options: Options) -> Result<Connection> {
        if options.host.is_empty()
            || options.name.trim().is_empty()
            || options.name.len() > 128
            || options.port == 0
        {
            bail!("Invalid server, port or username");
        }
        let ident = identity::load(&options.state_dir, &options.name).await?;
        let tcp = timeout(
            Duration::from_secs(20),
            TcpStream::connect((options.host.as_str(), options.port)),
        )
        .await??;
        tcp.set_nodelay(true)?;
        let peer = tcp.peer_addr()?;
        let connector = identity::connector(&ident)?;
        let ssl = connector.configure()?.into_ssl(&options.host)?;
        let mut stream = SslStream::new(ssl, tcp)?;
        timeout(Duration::from_secs(20), Pin::new(&mut stream).connect()).await??;
        let cert = stream
            .ssl()
            .peer_certificate()
            .context("No server certificate")?;
        let fingerprint = hex::encode(cert.digest(MessageDigest::sha256())?);
        identity::trust(
            &options.state_dir,
            &options.host,
            options.port,
            &fingerprint,
            stream.ssl().verify_result() == X509VerifyResult::OK,
            options.trust_new,
            options.server_fingerprint.as_deref(),
        )
        .await?;
        let socket = if !options.tcp_only {
            let address = if peer.is_ipv4() {
                "0.0.0.0:0"
            } else {
                "[::]:0"
            };
            match UdpSocket::bind(address).await {
                Ok(s) => {
                    if s.connect(peer).await.is_ok() {
                        Some(s)
                    } else {
                        None
                    }
                }
                Err(_) => None,
            }
        } else {
            None
        };
        let state = Arc::new(RwLock::new(State::default()));
        let cancel = CancellationToken::new();
        let (commands, rx) = mpsc::channel(64);
        let (events, event_rx) = mpsc::channel(64);
        let (audio_out, audio_rx) = mpsc::channel(50);
        let (frames, frame_rx) = mpsc::channel(2);
        let (video_tx, video_rx) = mpsc::channel(64);
        let inner = Arc::new(Inner {
            state: state.clone(),
            commands,
            video: video_tx.clone(),
            cancel: cancel.clone(),
        });
        video::spawn(
            Arc::downgrade(&inner),
            state.clone(),
            video_rx,
            frames,
            events.clone(),
            options.ice_servers.clone(),
            cancel.clone(),
        );
        let (ready, login) = oneshot::channel();
        tokio::spawn(async move {
            let result = run(
                stream,
                socket,
                options,
                RunContext {
                    state: state.clone(),
                    commands: rx,
                    events: events.clone(),
                    audio_out,
                    video: video_tx,
                    cancel: cancel.clone(),
                    ready,
                },
            )
            .await;
            state.write().unwrap().connected = false;
            let reason = result
                .err()
                .map(|e| e.to_string())
                .unwrap_or_else(|| "Disconnected".into());
            let _ = events.try_send(json!({"event":"closed","reason":reason}));
            cancel.cancel();
        });
        let client = Self(inner);
        match timeout(Duration::from_secs(25), login).await {
            Ok(Ok(Ok(()))) => {}
            Ok(Ok(Err(error))) => return Err(error),
            _ => {
                client.0.cancel.cancel();
                bail!("Connection closed or login timed out");
            }
        }
        Ok(Connection {
            client,
            events: event_rx,
            audio: audio_rx,
            video: frame_rx,
        })
    }
    pub fn state(&self) -> State {
        self.0.state.read().unwrap().clone()
    }
    async fn request(&self, op: Operation) -> Result<Value> {
        let (tx, rx) = oneshot::channel();
        self.0
            .commands
            .send(Request { op, reply: tx })
            .await
            .map_err(|_| anyhow!("Client disconnected"))?;
        timeout(Duration::from_secs(25), rx)
            .await
            .context("Command timed out")?
            .context("Client disconnected")?
    }
    pub async fn command(&self, value: Value) -> Result<Value> {
        match value["op"].as_str().unwrap_or("") {
            "share" | "video" | "watch" | "unwatch" | "stop-video" | "auto-watch" => {
                self.video_command(value).await
            }
            "join" => {
                let target = serde_json::from_value(value["channel"].clone())?;
                self.join(target).await?;
                Ok(Value::Null)
            }
            "quit" => {
                let _ = timeout(Duration::from_secs(2), self.flush()).await;
                self.request(Operation::Json(value)).await
            }
            _ => self.request(Operation::Json(value)).await,
        }
    }
    pub async fn send_text(
        &self,
        text: &str,
        user: Option<Target>,
        channel: Option<Target>,
    ) -> Result<()> {
        self.command(json!({"op":"send","text":text,"user":user,"channel":channel}))
            .await?;
        self.flush().await
    }
    pub async fn join(&self, channel: Target) -> Result<()> {
        let id = self.state().channel(&channel)?;
        self.request(Operation::Json(json!({"op":"join","channel":channel})))
            .await?;
        timeout(Duration::from_secs(10), async {
            loop {
                let state = self.state();
                if !state.connected {
                    bail!("Disconnected while joining");
                }
                if state.own().is_some_and(|u| u.channel_id == id) {
                    return Ok(());
                }
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        })
        .await
        .context("Joining channel timed out")?
    }
    pub async fn flush(&self) -> Result<()> {
        self.request(Operation::Flush).await?;
        Ok(())
    }
    pub async fn enable_audio(&self, bitrate: u32) -> Result<()> {
        self.command(json!({"op":"enable-audio","bitrate":bitrate}))
            .await?;
        Ok(())
    }
    pub async fn disable_audio(&self) -> Result<()> {
        self.command(json!({"op":"disable-audio"})).await?;
        Ok(())
    }
    pub async fn send_audio(&self, samples: Vec<i16>) -> Result<()> {
        self.request(Operation::Pcm(samples)).await?;
        Ok(())
    }
    pub async fn plugins(&self, to: Vec<u32>, id: &str, packets: Vec<Vec<u8>>) -> Result<()> {
        self.request(Operation::Plugins {
            to,
            id: id.to_owned(),
            packets,
        })
        .await?;
        Ok(())
    }
    pub async fn close(&self) -> Result<()> {
        if !self.0.cancel.is_cancelled() {
            let _ = self.command(json!({"op":"quit"})).await;
        }
        self.0.cancel.cancel();
        timeout(Duration::from_secs(5), async {
            self.0.commands.closed().await;
            self.0.video.closed().await;
        })
        .await
        .context("Timed out closing client resources")?;
        Ok(())
    }
    pub fn push_video(&self, data: Vec<u8>) -> Result<bool> {
        let shape = self
            .0
            .state
            .read()
            .unwrap()
            .video_shape
            .context("Start video sharing before pushing frames")?;
        if data.len() != crate::video::frame_bytes(shape.0, shape.1)? {
            bail!("Video frame has the wrong I420 byte length");
        }
        if self.0.video.capacity() < 62 {
            return Ok(false);
        }
        match self.0.video.try_send(VideoCommand::Frame(data)) {
            Ok(()) => Ok(true),
            Err(mpsc::error::TrySendError::Full(_)) => Ok(false),
            Err(_) => bail!("Video client stopped"),
        }
    }
    pub async fn video_command(&self, command: Value) -> Result<Value> {
        let (tx, rx) = oneshot::channel();
        self.0
            .video
            .send(VideoCommand::Request(command, tx))
            .await
            .map_err(|_| anyhow!("Video client stopped"))?;
        timeout(Duration::from_secs(25), rx).await??
    }
}
fn pack<M: Message>(kind: u16, message: &M) -> Vec<u8> {
    raw(kind, &message.encode_to_vec())
}
fn raw(kind: u16, bytes: &[u8]) -> Vec<u8> {
    let mut frame = Vec::with_capacity(bytes.len() + 6);
    frame.extend_from_slice(&kind.to_be_bytes());
    frame.extend_from_slice(&(bytes.len() as u32).to_be_bytes());
    frame.extend_from_slice(bytes);
    frame
}
fn escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace("\r\n", "\n")
        .replace('\n', "<br/>")
}
struct Runner {
    state: Arc<RwLock<State>>,
    writer: mpsc::Sender<Vec<u8>>,
    events: mpsc::Sender<Value>,
    video: mpsc::Sender<VideoCommand>,
    audio_out: mpsc::Sender<Vec<i16>>,
    audio: Option<Audio>,
    crypt: Option<Crypt>,
    last_pong: Option<Instant>,
    crypto_failures: u8,
    last_resync: Instant,
    plugin_queue: VecDeque<Vec<u8>>,
    text_queue: VecDeque<Vec<u8>>,
    next_plugin: Instant,
    next_text: Instant,
    text: Assembler,
    seen: HashSet<String>,
    message_limit: usize,
    image_limit: usize,
    max_bandwidth: u32,
    flush_requests: Vec<oneshot::Sender<Result<Value>>>,
    barriers: BTreeMap<u64, Vec<oneshot::Sender<Result<Value>>>>,
    flush_serial: u64,
}
impl Runner {
    fn event(&self, value: Value) -> Result<()> {
        self.events
            .try_send(value)
            .map_err(|_| anyhow!("Event consumer is too slow or closed"))
    }
    fn send<M: Message>(
        &self,
        kind: u16,
        msg: &M,
    ) -> impl std::future::Future<Output = Result<()>> + Send + 'static {
        let writer = self.writer.clone();
        let bytes = pack(kind, msg);
        async move {
            writer
                .send(bytes)
                .await
                .map_err(|_| anyhow!("TLS writer stopped"))
        }
    }
    fn protobuf(&self) -> bool {
        self.state.read().unwrap().server_version >= ((1u64 << 48) | (5u64 << 32))
    }
    fn queue_plugins(&mut self, to: Vec<u32>, id: String, packets: Vec<Vec<u8>>) -> Result<Value> {
        if packets.len() + self.plugin_queue.len() > 64 {
            bail!("Plugin message queue is full");
        }
        if packets.iter().any(|p| p.len() > 904) {
            bail!("Plugin packet too large");
        }
        if to.is_empty() {
            return Ok(Value::Null);
        }
        if self.state.read().unwrap().server_version < ((1u64 << 48) | (4u64 << 32)) {
            bail!("Plugin messages need Mumble 1.4 or newer");
        }
        for packet in packets {
            self.plugin_queue.push_back(pack(
                26,
                &pb::PluginDataTransmission {
                    receiver_sessions: to.clone(),
                    data: Some(packet),
                    data_id: Some(id.clone()),
                    ..Default::default()
                },
            ));
        }
        Ok(Value::Null)
    }
    async fn command(&mut self, value: Value) -> Result<(Value, bool)> {
        let op = value["op"]
            .as_str()
            .context("Expected a JSON object with an op")?;
        let target = |key: &str| -> Result<Option<Target>> {
            if value[key].is_null() {
                Ok(None)
            } else {
                Ok(Some(serde_json::from_value(value[key].clone())?))
            }
        };
        match op {
            "quit" => return Ok((Value::Null, true)),
            "list" => {
                let state = self.state.read().unwrap();
                return Ok((
                    json!({"users":state.users.values().collect::<Vec<_>>(),"channels":state.channels.values().map(|c|json!({"id":c.id,"name":c.name,"path":state.path(c.id)})).collect::<Vec<_>>(),"udp":state.udp}),
                    false,
                ));
            }
            "enable-audio" => {
                let rate = value["bitrate"].as_u64().unwrap_or(40000);
                if !(6000..=128000).contains(&rate) {
                    bail!("Audio bitrate must be 6000..128000");
                }
                if self.audio.is_none() {
                    let allowed = if self.max_bandwidth > 0 {
                        self.max_bandwidth.saturating_sub(28000).max(6000)
                    } else {
                        128000
                    };
                    self.audio = Some(Audio::new((rate as u32).min(allowed) as i32)?);
                }
            }
            "disable-audio" => {
                self.audio = None;
            }
            "audio" => {
                let text = value["data"]
                    .as_str()
                    .context("audio data must be base64 PCM")?;
                if text.len() > 256000 {
                    bail!("Audio chunk too large");
                }
                let bytes = STANDARD.decode(text)?;
                if bytes.len() % 2 != 0 {
                    bail!("PCM needs complete 16-bit samples");
                }
                if self.audio.is_none() {
                    self.audio = Some(Audio::new(40000)?);
                }
                let samples: Vec<_> = bytes
                    .as_chunks::<2>()
                    .0
                    .iter()
                    .map(|b| i16::from_le_bytes([b[0], b[1]]))
                    .collect();
                self.audio.as_mut().unwrap().input(&samples)?;
            }
            "mute" | "deaf" => {
                let enabled = value[if op == "mute" { "muted" } else { "deafened" }]
                    .as_bool()
                    .context("Mute/deafen value must be boolean")?;
                let session = self.state.read().unwrap().session;
                let mut msg = pb::UserState {
                    session: Some(session),
                    ..Default::default()
                };
                if op == "mute" {
                    msg.self_mute = Some(enabled);
                    if !enabled {
                        msg.self_deaf = Some(false);
                    }
                } else {
                    msg.self_deaf = Some(enabled);
                    if enabled {
                        msg.self_mute = Some(true);
                    }
                }
                self.send(9, &msg).await?;
            }
            "join" => {
                let target = target("channel")?.context("channel is required")?;
                let id = self.state.read().unwrap().channel(&target)?;
                if self
                    .state
                    .read()
                    .unwrap()
                    .channels
                    .get(&id)
                    .is_some_and(|c| c.description.contains("<!--mumh5:text-->"))
                {
                    bail!("Text channels can be messaged without joining");
                }
                let session = self.state.read().unwrap().session;
                self.send(
                    9,
                    &pb::UserState {
                        session: Some(session),
                        channel_id: Some(id),
                        ..Default::default()
                    },
                )
                .await?;
            }
            "send" => {
                let text = value["text"]
                    .as_str()
                    .filter(|s| !s.trim().is_empty())
                    .context("Message text must not be empty")?;
                let html = if value["html"] == true {
                    text.to_owned()
                } else {
                    escape(text)
                };
                let user = target("user")?;
                let channel = target("channel")?;
                if user.is_some() && channel.is_some() {
                    bail!("Choose a user or channel, not both");
                }
                let (session, channel, is_text, to) = {
                    let state = self.state.read().unwrap();
                    let session = user.as_ref().map(|t| state.user(t)).transpose()?;
                    let channel = channel
                        .as_ref()
                        .map(|t| state.channel(t))
                        .transpose()?
                        .unwrap_or_else(|| state.own().map(|u| u.channel_id).unwrap_or(0));
                    let is_text = session.is_none()
                        && state
                            .channels
                            .get(&channel)
                            .is_some_and(|c| c.description.contains("<!--mumh5:text-->"));
                    let to = state
                        .users
                        .keys()
                        .filter(|id| **id != state.session)
                        .copied()
                        .collect::<Vec<_>>();
                    (session, channel, is_text, to)
                };
                if is_text {
                    if html.chars().map(char::len_utf16).sum::<usize>() > 24000 {
                        bail!("Text channel message is too long");
                    }
                    let id = uuid::Uuid::new_v4().simple().to_string();
                    self.remember(id.clone());
                    let body = json!({"i":id,"c":channel,"h":html}).to_string();
                    let packets = crate::signal::encode(3, Some(&body))?;
                    self.queue_plugins(to, "mumh5.text".into(), packets)?;
                } else {
                    let limit = if html.to_ascii_lowercase().contains("<img") {
                        self.image_limit
                    } else {
                        self.message_limit
                    };
                    if limit > 0 && html.chars().map(char::len_utf16).sum::<usize>() > limit {
                        bail!("Message exceeds server limit ({limit})");
                    }
                    if self.text_queue.len() >= 32 {
                        bail!("Text queue is full");
                    }
                    self.text_queue.push_back(pack(
                        11,
                        &pb::TextMessage {
                            session: session.into_iter().collect(),
                            channel_id: if session.is_some() {
                                vec![]
                            } else {
                                vec![channel]
                            },
                            message: html,
                            ..Default::default()
                        },
                    ));
                }
            }
            _ => bail!("Unknown operation: {op}"),
        }
        Ok((Value::Null, false))
    }
    fn remember(&mut self, id: String) {
        if self.seen.len() >= 2000 {
            self.seen.clear();
        }
        self.seen.insert(id);
    }
    async fn process_request(&mut self, request: Request) -> Result<bool> {
        if matches!(&request.op, Operation::Flush) {
            if self.flush_requests.len() + self.barriers.values().map(Vec::len).sum::<usize>() >= 64
            {
                let _ = request.reply.send(Err(anyhow!("Flush queue is full")));
            } else {
                self.flush_requests.push(request.reply);
            }
            return Ok(false);
        }
        let result = match request.op {
            Operation::Flush => unreachable!(),
            Operation::Json(value) => self.command(value).await,
            Operation::Pcm(samples) => {
                if samples.len() > 96000 {
                    Err(anyhow!("PCM chunk too large"))
                } else {
                    self.audio
                        .as_mut()
                        .context("Enable audio first")
                        .and_then(|a| a.input(&samples))
                        .map(|_| (Value::Null, false))
                }
            }
            Operation::Plugins { to, id, packets } => {
                self.queue_plugins(to, id, packets).map(|v| (v, false))
            }
        };
        let quit = result.as_ref().is_ok_and(|(_, q)| *q);
        let _ = request.reply.send(result.map(|(value, _)| value));
        Ok(quit)
    }
    async fn tick(&mut self, socket: &Option<UdpSocket>) -> Result<()> {
        if Instant::now() >= self.next_plugin
            && let Some(packet) = self.plugin_queue.pop_front()
        {
            self.writer.send(packet).await?;
            self.next_plugin = Instant::now() + Duration::from_millis(300);
        }
        if Instant::now() >= self.next_text
            && let Some(packet) = self.text_queue.pop_front()
        {
            self.writer.send(packet).await?;
            self.next_text = Instant::now() + Duration::from_millis(1100);
        }
        if self.text_queue.is_empty()
            && self.plugin_queue.is_empty()
            && !self.flush_requests.is_empty()
        {
            self.flush_serial += 1;
            self.send(
                3,
                &pb::Ping {
                    timestamp: Some(self.flush_serial),
                    ..Default::default()
                },
            )
            .await?;
            let pending = std::mem::take(&mut self.flush_requests);
            self.barriers.insert(self.flush_serial, pending);
        }
        let muted = self
            .state
            .read()
            .unwrap()
            .own()
            .is_none_or(|u| u.mute || u.self_mute || u.deaf || u.self_deaf || u.suppress);
        let protobuf = self.protobuf();
        if let Some(audio) = &mut self.audio {
            let (packet, pcm) = audio.tick(muted, protobuf);
            let _ = self.audio_out.try_send(pcm);
            if let Some(packet) = packet {
                let good = self
                    .last_pong
                    .is_some_and(|at| at.elapsed() < Duration::from_secs(8));
                if good {
                    if let (Some(socket), Some(crypt)) = (socket, &mut self.crypt) {
                        let encrypted = crypt.encode(&packet);
                        if socket.send(&encrypted).await.is_err() {
                            self.last_pong = None;
                        }
                    }
                } else {
                    self.writer.send(raw(1, &packet)).await?;
                }
            }
        }
        Ok(())
    }
    async fn udp_ping(&mut self, socket: &UdpSocket) -> Result<()> {
        let packet = if self.protobuf() {
            let mut bytes = vec![1];
            udp::Ping {
                timestamp: now(),
                ..Default::default()
            }
            .encode(&mut bytes)?;
            bytes
        } else {
            let mut bytes = vec![1 << 5];
            crate::voice::write_varint(&mut bytes, now());
            bytes
        };
        if let Some(crypt) = &mut self.crypt {
            let _ = socket.send(&crypt.encode(&packet)).await;
        }
        self.state.write().unwrap().udp = self
            .last_pong
            .is_some_and(|at| at.elapsed() < Duration::from_secs(8));
        Ok(())
    }
    async fn udp_receive(&mut self, packet: &[u8]) -> Result<()> {
        if let Some(plain) = self.crypt.as_mut().and_then(|c| c.decode(packet)) {
            self.crypto_failures = 0;
            let is_ping = if self.protobuf() {
                plain.first() == Some(&1)
            } else {
                plain.first().is_some_and(|b| b >> 5 == 1)
            };
            if is_ping {
                self.last_pong = Some(Instant::now());
                self.state.write().unwrap().udp = true;
            } else if let Some(audio) = &mut self.audio {
                audio.receive(&plain, self.state.read().unwrap().session);
            }
        } else {
            self.crypto_failures = self.crypto_failures.saturating_add(1);
            if self.crypto_failures > 8 && self.last_resync.elapsed() > Duration::from_secs(5) {
                self.last_resync = Instant::now();
                self.send(15, &pb::CryptSetup::default()).await?;
            }
        }
        Ok(())
    }
    async fn receive(&mut self, kind: u16, bytes: &[u8]) -> Result<bool> {
        match kind {
            0 => {
                let v = pb::Version::decode(bytes)?;
                self.state.write().unwrap().server_version = v.version_v2.unwrap_or_else(|| {
                    let v = v.version_v1.unwrap_or(0);
                    ((v as u64 >> 16) << 48)
                        | (((v as u64 >> 8) & 255) << 32)
                        | ((v as u64 & 255) << 16)
                });
            }
            1 => {
                if let Some(audio) = &mut self.audio {
                    audio.receive(bytes, self.state.read().unwrap().session);
                }
            }
            3 => {
                let ping = pb::Ping::decode(bytes)?;
                if let Some(nonce) = ping.timestamp
                    && let Some(requests) = self.barriers.remove(&nonce)
                {
                    for request in requests {
                        let _ = request.send(Ok(Value::Null));
                    }
                }
            }
            4 => {
                let msg = pb::Reject::decode(bytes)?;
                bail!("Login rejected: {}", msg.reason.unwrap_or_default());
            }
            5 => {
                let msg = pb::ServerSync::decode(bytes)?;
                self.max_bandwidth = msg.max_bandwidth.unwrap_or(0);
                let mut state = self.state.write().unwrap();
                state.session = msg.session.context("ServerSync has no session")?;
                state.connected = true;
                return Ok(true);
            }
            6 => {
                let msg = pb::ChannelRemove::decode(bytes)?;
                self.state.write().unwrap().channels.remove(&msg.channel_id);
            }
            7 => {
                let msg = pb::ChannelState::decode(bytes)?;
                let id = msg.channel_id.unwrap_or(0);
                let request = msg.description_hash.is_some() && msg.description.is_none();
                {
                    let mut state = self.state.write().unwrap();
                    let c = state.channels.entry(id).or_insert_with(|| Channel {
                        id,
                        ..Default::default()
                    });
                    if let Some(v) = msg.name {
                        c.name = v;
                    }
                    if msg.parent.is_some() {
                        c.parent = msg.parent;
                    }
                    if let Some(v) = msg.description {
                        c.description = v;
                    }
                }
                if request {
                    self.send(
                        23,
                        &pb::RequestBlob {
                            channel_description: vec![id],
                            ..Default::default()
                        },
                    )
                    .await?;
                }
            }
            8 => {
                let msg = pb::UserRemove::decode(bytes)?;
                let own = {
                    let mut state = self.state.write().unwrap();
                    state.users.remove(&msg.session);
                    state.session == msg.session
                };
                if own {
                    bail!("Removed from server: {}", msg.reason.unwrap_or_default());
                }
                if let Some(audio) = &mut self.audio {
                    audio.remove(msg.session);
                }
                let _ = self.video.try_send(VideoCommand::UserChanged);
            }
            9 => {
                let msg = pb::UserState::decode(bytes)?;
                let id = msg.session.unwrap_or(0);
                let (user, connected, moved, own) = {
                    let mut state = self.state.write().unwrap();
                    let own = state.session == id;
                    let connected = state.connected;
                    let u = state.users.entry(id).or_insert_with(|| User {
                        session: id,
                        ..Default::default()
                    });
                    let moved = msg.channel_id.is_some_and(|c| c != u.channel_id);
                    if let Some(v) = msg.name {
                        u.name = v;
                    }
                    if let Some(v) = msg.channel_id {
                        u.channel_id = v;
                    }
                    if msg.user_id.is_some() {
                        u.user_id = msg.user_id;
                    }
                    if let Some(v) = msg.hash {
                        u.hash = v;
                    }
                    if let Some(v) = msg.mute {
                        u.mute = v;
                    }
                    if let Some(v) = msg.deaf {
                        u.deaf = v;
                    }
                    if let Some(v) = msg.self_mute {
                        u.self_mute = v;
                    }
                    if let Some(v) = msg.self_deaf {
                        u.self_deaf = v;
                    }
                    if let Some(v) = msg.suppress {
                        u.suppress = v;
                    }
                    (u.clone(), connected, moved, own)
                };
                if connected {
                    self.event(json!({"event":"user","session":id,"name":user.name,"channelId":user.channel_id,"userId":user.user_id}))?;
                    if moved && own {
                        let _ = self.video.try_send(VideoCommand::Entered);
                    } else {
                        let _ = self.video.try_send(VideoCommand::UserChanged);
                    }
                }
            }
            11 => {
                let msg = pb::TextMessage::decode(bytes)?;
                let state = self.state.read().unwrap();
                self.event(json!({"event":"text","actor":msg.actor,"author":msg.actor.and_then(|id|state.users.get(&id)).map(|u|u.name.as_str()).unwrap_or("Server"),"self":msg.actor==Some(state.session),"html":msg.message,"sessions":msg.session,"channels":msg.channel_id,"trees":msg.tree_id,"textChannel":false,"time":now()}))?;
            }
            12 => {
                let msg = pb::PermissionDenied::decode(bytes)?;
                self.event(json!({"event":"warning","message":format!("Permission denied: {}",msg.reason.unwrap_or_else(||format!("type {:?}",msg.r#type)))}))?;
            }
            15 => {
                let msg = pb::CryptSetup::decode(bytes)?;
                if let (Some(key), Some(client), Some(server)) = (
                    msg.key.as_deref(),
                    msg.client_nonce.as_deref(),
                    msg.server_nonce.as_deref(),
                ) {
                    self.crypt = Crypt::new(key, client, server);
                } else if let Some(nonce) = msg.server_nonce {
                    if let Some(crypt) = &mut self.crypt {
                        crypt.resync(&nonce);
                    }
                } else if let Some(crypt) = &self.crypt {
                    self.send(
                        15,
                        &pb::CryptSetup {
                            client_nonce: Some(crypt.send_iv.to_vec()),
                            ..Default::default()
                        },
                    )
                    .await?;
                }
            }
            24 => {
                let msg = pb::ServerConfig::decode(bytes)?;
                if let Some(n) = msg.message_length {
                    self.message_limit = n as usize;
                }
                if let Some(n) = msg.image_message_length {
                    self.image_limit = n as usize;
                }
            }
            26 => {
                let msg = pb::PluginDataTransmission::decode(bytes)?;
                let sender = msg.sender_session.unwrap_or(0);
                let data = msg.data.unwrap_or_default();
                let id = msg.data_id.unwrap_or_default();
                if !self.state.read().unwrap().users.contains_key(&sender) {
                    return Ok(false);
                }
                if id == "mumh5.share" {
                    if self
                        .video
                        .try_send(VideoCommand::Signal(sender, data))
                        .is_err()
                    {
                        self.event(
                            json!({"event":"mediaError","message":"Video signaling queue is full"}),
                        )?;
                    }
                } else if id == "mumh5.text"
                    && let Some((kind, text)) = self.text.push(sender, &data)
                {
                    if kind == 1 {
                        self.queue_plugins(vec![sender], id, crate::signal::encode(2, None)?)?;
                    } else if kind == 3
                        && let Some(text) = text
                        && let Ok(v) = serde_json::from_str::<Value>(&text)
                        && let (Some(id), Some(channel), Some(html)) =
                            (v["i"].as_str(), v["c"].as_u64(), v["h"].as_str())
                        && !id.is_empty()
                        && id.len() <= 40
                        && channel <= u32::MAX as u64
                        && html.chars().map(char::len_utf16).sum::<usize>() <= 24000
                        && !self.seen.contains(id)
                        && self
                            .state
                            .read()
                            .unwrap()
                            .channels
                            .get(&(channel as u32))
                            .is_some_and(|c| c.description.contains("<!--mumh5:text-->"))
                    {
                        self.remember(id.into());
                        let state = self.state.read().unwrap();
                        self.event(json!({"event":"text","actor":sender,"author":state.users.get(&sender).map(|u|u.name.as_str()).unwrap_or("Server"),"self":sender==state.session,"html":html,"sessions":[],"channels":[channel],"trees":[],"textChannel":true,"time":now()}))?;
                    }
                }
            }
            _ => {}
        }
        Ok(false)
    }
}
struct RunContext {
    state: Arc<RwLock<State>>,
    commands: mpsc::Receiver<Request>,
    events: mpsc::Sender<Value>,
    audio_out: mpsc::Sender<Vec<i16>>,
    video: mpsc::Sender<VideoCommand>,
    cancel: CancellationToken,
    ready: oneshot::Sender<Result<()>>,
}
async fn run(
    stream: SslStream<TcpStream>,
    socket: Option<UdpSocket>,
    options: Options,
    context: RunContext,
) -> Result<()> {
    let RunContext {
        state,
        mut commands,
        events,
        audio_out,
        video,
        cancel,
        ready,
    } = context;
    let (mut read, mut write) = tokio::io::split(stream);
    let (write_tx, mut write_rx) = mpsc::channel::<Vec<u8>>(128);
    let (in_tx, mut incoming) = mpsc::channel(8);
    let stop = cancel.clone();
    let reader = tokio::spawn(async move {
        loop {
            let result = async {
                let kind = read.read_u16().await?;
                let size = read.read_u32().await? as usize;
                if size > 8 * 1024 * 1024 {
                    bail!("Mumble frame exceeds 8 MiB");
                }
                let mut body = vec![0; size];
                read.read_exact(&mut body).await?;
                Ok::<_, anyhow::Error>((kind, body))
            }
            .await;
            let failed = result.is_err();
            tokio::select! {_=stop.cancelled()=>break,result=in_tx.send(result)=>{if result.is_err(){break;}}}
            if failed {
                break;
            }
        }
    });
    let stop = cancel.clone();
    let mut writer = tokio::spawn(async move {
        loop {
            tokio::select! {_=stop.cancelled()=>break,bytes=write_rx.recv()=>{let Some(bytes)=bytes else{break};if !matches!(timeout(Duration::from_secs(20),write.write_all(&bytes)).await,Ok(Ok(()))){stop.cancel();break;}}}
        }
        let _ = write.shutdown().await;
    });
    let mut runner = Runner {
        state,
        writer: write_tx,
        events,
        video,
        audio_out,
        audio: None,
        crypt: None,
        last_pong: None,
        crypto_failures: 0,
        last_resync: Instant::now() - Duration::from_secs(30),
        plugin_queue: VecDeque::new(),
        text_queue: VecDeque::new(),
        next_plugin: Instant::now(),
        next_text: Instant::now(),
        text: Assembler::default(),
        seen: HashSet::new(),
        message_limit: 5000,
        image_limit: 131072,
        max_bandwidth: 0,
        flush_requests: vec![],
        barriers: BTreeMap::new(),
        flush_serial: 1 << 63,
    };
    let result = async {
        runner.send(0, &pb::Version { version_v1: Some(0x010500), version_v2: Some((1u64 << 48) | (5u64 << 32)), release: Some("Dream Cord 0.1.0".into()), os: Some(std::env::consts::OS.into()), ..Default::default() }).await?;
        runner.send(2, &pb::Authenticate { username: Some(options.name), password: options.password, tokens: options.tokens, opus: Some(true), client_type: Some(1), ..Default::default() }).await?;
        let mut ready = Some(ready);
        let mut clock = interval(Duration::from_millis(10)); clock.set_missed_tick_behavior(MissedTickBehavior::Skip);
        let mut ping = interval(Duration::from_secs(5));
        let mut udp_ping = interval(Duration::from_secs(2));
        let mut udp_buffer = [0u8; 65536];
        let mut last_received = Instant::now();
        loop {
            tokio::select! {
                _ = cancel.cancelled() => break,
                msg = incoming.recv() => {
                    let (kind, body) = msg.context("TLS connection closed")??;
                    last_received = Instant::now();
                    match runner.receive(kind, &body).await {
                        Ok(synced) => { if synced && let Some(ready) = ready.take() { let _ = ready.send(Ok(())); } },
                        Err(error) => { if let Some(ready) = ready.take() { let _ = ready.send(Err(anyhow!(error.to_string()))); } return Err(error); }
                    }
                }
                request = commands.recv() => {
                    let Some(request) = request else { break; };
                    if runner.process_request(request).await? { break; }
                }
                _ = clock.tick(), if runner.audio.is_some() || !runner.plugin_queue.is_empty() || !runner.text_queue.is_empty() || !runner.flush_requests.is_empty() => {
                    runner.tick(&socket).await?;
                }
                _ = ping.tick() => {
                    runner.barriers.retain(|_, requests| { requests.retain(|r| !r.is_closed()); !requests.is_empty() });
                    if last_received.elapsed() > Duration::from_secs(30) { bail!("Server stopped responding"); }
                    runner.send(3, &pb::Ping { timestamp: Some(now()), ..Default::default() }).await?;
                }
                _ = udp_ping.tick(), if runner.audio.is_some() && socket.is_some() && runner.crypt.is_some() => {
                    runner.udp_ping(socket.as_ref().unwrap()).await?;
                }
                received = async { if let Some(socket) = &socket { socket.recv(&mut udp_buffer).await } else { std::future::pending().await } } => {
                    if let Ok(size) = received { runner.udp_receive(&udp_buffer[..size]).await?; }
                }
            }
        }
        Ok(())
    }.await;
    cancel.cancel();
    reader.abort();
    if timeout(Duration::from_secs(2), &mut writer).await.is_err() {
        writer.abort();
    }
    result
}
