//! STUN/TURN over UDP and TCP, backed by the native TURN implementation shared with WebRTC.
use anyhow::{Result, bail};
use async_trait::async_trait;
use std::{
    any::Any,
    collections::HashMap,
    net::{IpAddr, SocketAddr},
    sync::{Arc, Mutex as StdMutex},
    time::Duration,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream, UdpSocket},
    sync::{Mutex, broadcast, mpsc},
};
use tokio_util::sync::CancellationToken;
use turn::{
    auth::{AuthHandler, generate_auth_key, generate_long_term_credentials},
    relay::RelayAddressGenerator,
    server::{
        Server,
        config::{ConnConfig, ServerConfig},
    },
};
use webrtc_util::Conn;
type TurnResult<T> = std::result::Result<T, turn::Error>;
type UtilResult<T> = std::result::Result<T, webrtc_util::Error>;
fn io_error(message: &str) -> webrtc_util::Error {
    std::io::Error::other(message).into()
}
pub fn private(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(a) => {
            let o = a.octets();
            a.is_private()
                || a.is_loopback()
                || a.is_link_local()
                || a.is_unspecified()
                || a.is_multicast()
                || o[0] >= 224
                || o[0] == 100 && (64..=127).contains(&o[1])
        }
        IpAddr::V6(a) => a.to_ipv4_mapped().map(|a| private(a.into())).unwrap_or(
            a.is_loopback()
                || a.is_unspecified()
                || a.is_multicast()
                || a.is_unique_local()
                || a.is_unicast_link_local(),
        ),
    }
}
#[derive(Clone)]
pub struct Options {
    pub bind: SocketAddr,
    pub relay: bool,
    pub public_ip: Option<IpAddr>,
    pub min_port: u16,
    pub max_port: u16,
    pub max_allocations: usize,
    pub max_per_address: usize,
    pub allow_private: bool,
}
impl Default for Options {
    fn default() -> Self {
        Self {
            bind: "0.0.0.0:3478".parse().unwrap(),
            relay: true,
            public_ip: None,
            min_port: 49160,
            max_port: 49659,
            max_allocations: 256,
            max_per_address: 16,
            allow_private: false,
        }
    }
}
/// A mumpeer lane on the public relay is reached with its own credential,
/// `<expiry>:lane-<32 hex>`. Such a username only ever gets its virtual address, never a
/// normal relay, and one allocation at a time.
pub fn is_lane_user(user: &str) -> bool {
    user.split_once(":lane-").is_some_and(|(expiry, id)| {
        !expiry.is_empty()
            && expiry.bytes().all(|b| b.is_ascii_digit())
            && id.len() == 32
            && id.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
    })
}
struct LaneEntry {
    bridge: VirtualBridge,
    busy: Option<(u64, CancellationToken)>,
}
/// Virtual lanes (mumpeer links the gateway keeps for browsers) served by the public relay.
#[derive(Default)]
pub struct LaneRegistry {
    lanes: StdMutex<HashMap<String, LaneEntry>>,
    next: std::sync::atomic::AtomicU64,
}
/// Keeps a lane registered; dropping it removes the lane and ends its allocation.
pub struct LaneHandle {
    registry: Arc<LaneRegistry>,
    username: String,
}
impl Drop for LaneHandle {
    fn drop(&mut self) {
        if let Ok(mut lanes) = self.registry.lanes.lock()
            && let Some(entry) = lanes.remove(&self.username)
            && let Some((_, cancel)) = entry.busy
        {
            cancel.cancel();
        }
    }
}
/// One allocation's hold on a lane; dropping it frees the lane for the next allocation.
struct LaneClaim {
    registry: Arc<LaneRegistry>,
    username: String,
    id: u64,
}
impl Drop for LaneClaim {
    fn drop(&mut self) {
        if let Ok(mut lanes) = self.registry.lanes.lock()
            && let Some(entry) = lanes.get_mut(&self.username)
            && entry.busy.as_ref().is_some_and(|(id, _)| *id == self.id)
        {
            entry.busy = None;
        }
    }
}
impl LaneRegistry {
    pub fn register(self: &Arc<Self>, username: String, bridge: VirtualBridge) -> LaneHandle {
        if let Ok(mut lanes) = self.lanes.lock() {
            lanes.insert(username.clone(), LaneEntry { bridge, busy: None });
        }
        LaneHandle {
            registry: self.clone(),
            username,
        }
    }
    pub fn has(&self, username: &str) -> bool {
        self.lanes.lock().is_ok_and(|l| l.contains_key(username))
    }
    fn claim(
        self: &Arc<Self>,
        username: &str,
    ) -> Option<(VirtualBridge, CancellationToken, LaneClaim)> {
        let mut lanes = self.lanes.lock().ok()?;
        let entry = lanes.get_mut(username)?;
        if entry.busy.is_some() {
            return None;
        }
        let id = self.next.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let cancel = entry.bridge.cancel.child_token();
        entry.busy = Some((id, cancel.clone()));
        Some((
            entry.bridge.clone(),
            cancel,
            LaneClaim {
                registry: self.clone(),
                username: username.to_owned(),
                id,
            },
        ))
    }
}
/// Hands out lane credentials on a running public relay.
#[derive(Clone)]
pub struct LaneIssuer {
    pub registry: Arc<LaneRegistry>,
    pub port: u16,
    secret: String,
}
impl LaneIssuer {
    /// A fresh lane credential: `(username, credential)`, valid for twelve hours.
    pub fn credentials(&self) -> Result<(String, String)> {
        let expiry = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)?
            .as_secs()
            + 12 * 3600;
        let username = format!("{expiry}:lane-{}", uuid::Uuid::new_v4().simple());
        let credential = hmac_password(&self.secret, &username)?;
        Ok((username, credential))
    }
}
fn hmac_password(secret: &str, user: &str) -> Result<String> {
    use base64::{Engine, engine::general_purpose::STANDARD};
    use openssl::{hash::MessageDigest, pkey::PKey, sign::Signer};
    let key = PKey::hmac(secret.as_bytes())?;
    let mut signer = Signer::new(MessageDigest::sha1(), &key)?;
    signer.update(user.as_bytes())?;
    Ok(STANDARD.encode(signer.sign_to_vec()?))
}
type Users = Arc<StdMutex<HashMap<SocketAddr, String>>>;
struct Credentials {
    secret: String,
    relay: bool,
    lanes: Option<Arc<LaneRegistry>>,
    /// The user each client 5-tuple last authenticated as; allocation reads it to pick a lane.
    users: Users,
}
impl AuthHandler for Credentials {
    fn auth_handle(&self, user: &str, realm: &str, src: SocketAddr) -> TurnResult<Vec<u8>> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| turn::Error::Other(e.to_string()))?
            .as_secs();
        let expiry = user
            .split(':')
            .next()
            .and_then(|n| n.parse::<u64>().ok())
            .unwrap_or(0);
        if !self.relay || expiry <= now || expiry > now + 12 * 3600 + 60 {
            return Err(turn::Error::Other("Expired TURN credentials".into()));
        }
        // Without its registered lane a lane credential gets nothing at all.
        if is_lane_user(user) && !self.lanes.as_ref().is_some_and(|l| l.has(user)) {
            return Err(turn::Error::Other("Unknown mumpeer lane".into()));
        }
        let password =
            hmac_password(&self.secret, user).map_err(|e| turn::Error::Other(e.to_string()))?;
        if let Ok(mut users) = self.users.lock() {
            users.insert(src, user.to_owned());
        }
        Ok(generate_auth_key(user, realm, &password))
    }
}
#[derive(Default)]
struct Quota {
    counts: StdMutex<HashMap<IpAddr, usize>>,
}
struct Lease {
    quota: Arc<Quota>,
    ip: IpAddr,
}
impl Drop for Lease {
    fn drop(&mut self) {
        if let Ok(mut counts) = self.quota.counts.lock()
            && let Some(count) = counts.get_mut(&self.ip)
        {
            *count = count.saturating_sub(1);
            if *count == 0 {
                counts.remove(&self.ip);
            }
        }
    }
}
impl Quota {
    fn reserve(self: &Arc<Self>, ip: IpAddr, opts: &Options) -> TurnResult<Lease> {
        let mut counts = self
            .counts
            .lock()
            .map_err(|_| turn::Error::Other("TURN quota lock failed".into()))?;
        if counts.values().sum::<usize>() >= opts.max_allocations
            || counts.get(&ip).copied().unwrap_or(0) >= opts.max_per_address
        {
            return Err(turn::Error::Other("TURN allocation quota reached".into()));
        }
        *counts.entry(ip).or_default() += 1;
        Ok(Lease {
            quota: self.clone(),
            ip,
        })
    }
}
#[derive(Clone)]
pub struct VirtualBridge {
    pub local: SocketAddr,
    pub remote: SocketAddr,
    pub outgoing: mpsc::Sender<Vec<u8>>,
    pub incoming: broadcast::Sender<Vec<u8>>,
    pub cancel: CancellationToken,
}
enum RelayKind {
    Udp(Arc<UdpSocket>),
    Virtual {
        tx: mpsc::Sender<Vec<u8>>,
        rx: Mutex<broadcast::Receiver<Vec<u8>>>,
        remote: SocketAddr,
    },
}
struct RelayConn {
    kind: RelayKind,
    local: SocketAddr,
    public: IpAddr,
    allow_private: bool,
    cancel: CancellationToken,
    lease: StdMutex<Option<Lease>>,
    claim: StdMutex<Option<LaneClaim>>,
}
#[async_trait]
impl Conn for RelayConn {
    async fn connect(&self, _addr: SocketAddr) -> UtilResult<()> {
        Ok(())
    }
    async fn recv(&self, b: &mut [u8]) -> UtilResult<usize> {
        Ok(self.recv_from(b).await?.0)
    }
    async fn recv_from(&self, b: &mut [u8]) -> UtilResult<(usize, SocketAddr)> {
        tokio::select! {_=self.cancel.cancelled()=>Err(io_error("Relay closed")),result=async{match &self.kind{RelayKind::Udp(socket)=>{let(n,mut peer)=socket.recv_from(b).await?;if peer.ip().is_loopback()&&!self.public.is_loopback(){peer.set_ip(self.public);}Ok((n,peer))},RelayKind::Virtual{rx,remote,..}=>{let p=rx.lock().await.recv().await.map_err(|_|io_error("Relay closed"))?;if p.len()>b.len(){return Err(io_error("Relay packet too large"));}b[..p.len()].copy_from_slice(&p);Ok((p.len(),*remote))}}}=>result}
    }
    async fn send(&self, _b: &[u8]) -> UtilResult<usize> {
        Err(io_error("Use send_to for a relay"))
    }
    async fn send_to(&self, b: &[u8], mut target: SocketAddr) -> UtilResult<usize> {
        match &self.kind {
            RelayKind::Udp(socket) => {
                if target.ip() != self.public && !self.allow_private && private(target.ip()) {
                    return Err(io_error("Private TURN peer denied"));
                }
                if target.ip() == self.public && !self.public.is_loopback() {
                    target.set_ip(if target.is_ipv4() {
                        "127.0.0.1".parse().unwrap()
                    } else {
                        "::1".parse().unwrap()
                    });
                }
                Ok(socket.send_to(b, target).await?)
            }
            RelayKind::Virtual { tx, remote, .. } => {
                if target != *remote {
                    return Err(io_error("Mumpeer peer mismatch"));
                }
                if b.len() < 1500 {
                    let _ = tx.try_send(b.to_vec());
                }
                Ok(b.len())
            }
        }
    }
    fn local_addr(&self) -> UtilResult<SocketAddr> {
        Ok(self.local)
    }
    fn remote_addr(&self) -> Option<SocketAddr> {
        None
    }
    async fn close(&self) -> UtilResult<()> {
        self.cancel.cancel();
        if let Ok(mut lease) = self.lease.lock() {
            lease.take();
        }
        if let Ok(mut claim) = self.claim.lock() {
            claim.take();
        }
        Ok(())
    }
    fn as_any(&self) -> &(dyn Any + Send + Sync) {
        self
    }
}
struct Generator {
    opts: Options,
    quota: Arc<Quota>,
    client: SocketAddr,
    local: IpAddr,
    virtual_bridge: Option<VirtualBridge>,
    lanes: Option<Arc<LaneRegistry>>,
    users: Users,
}
impl Generator {
    fn lane_user(&self) -> Option<String> {
        if self.virtual_bridge.is_some() {
            return None;
        }
        let users = self.users.lock().ok()?;
        users.get(&self.client).filter(|u| is_lane_user(u)).cloned()
    }
}
fn virtual_conn(
    bridge: &VirtualBridge,
    cancel: CancellationToken,
    lease: Lease,
    claim: Option<LaneClaim>,
) -> RelayConn {
    RelayConn {
        kind: RelayKind::Virtual {
            tx: bridge.outgoing.clone(),
            rx: Mutex::new(bridge.incoming.subscribe()),
            remote: bridge.remote,
        },
        local: bridge.local,
        public: bridge.local.ip(),
        allow_private: false,
        cancel,
        lease: StdMutex::new(Some(lease)),
        claim: StdMutex::new(claim),
    }
}
#[async_trait]
impl RelayAddressGenerator for Generator {
    fn validate(&self) -> TurnResult<()> {
        Ok(())
    }
    fn supports_family(&self, v4: bool) -> bool {
        if self.lane_user().is_some() {
            return v4;
        }
        self.virtual_bridge
            .as_ref()
            .map(|v| v.local.is_ipv4() == v4)
            .unwrap_or(self.opts.public_ip.is_none_or(|ip| ip.is_ipv4() == v4))
    }
    async fn allocate_conn(
        &self,
        v4: bool,
        requested: u16,
    ) -> TurnResult<(Arc<dyn Conn + Send + Sync>, SocketAddr)> {
        if let Some(user) = self.lane_user() {
            // A lane credential reaches its lane or nothing: never a normal relay.
            if !v4 {
                return Err(turn::Error::Other("Mumpeer relay requires IPv4".into()));
            }
            let (bridge, cancel, claim) = self
                .lanes
                .as_ref()
                .and_then(|l| l.claim(&user))
                .ok_or_else(|| turn::Error::Other("Mumpeer lane busy or closed".into()))?;
            let lease = self.quota.reserve(self.client.ip(), &self.opts)?;
            let conn = virtual_conn(&bridge, cancel, lease, Some(claim));
            return Ok((Arc::new(conn), bridge.local));
        }
        let lease = self.quota.reserve(self.client.ip(), &self.opts)?;
        if let Some(bridge) = &self.virtual_bridge {
            if !v4 {
                return Err(turn::Error::Other("Mumpeer relay requires IPv4".into()));
            }
            let conn = virtual_conn(bridge, bridge.cancel.child_token(), lease, None);
            return Ok((Arc::new(conn), bridge.local));
        }
        let bind: IpAddr = if v4 {
            "0.0.0.0".parse().unwrap()
        } else {
            "::".parse().unwrap()
        };
        let mut socket = None;
        if requested != 0 {
            socket = UdpSocket::bind(SocketAddr::new(bind, requested)).await.ok();
        } else if self.opts.min_port == 0 && self.opts.max_port == 0 {
            socket = UdpSocket::bind(SocketAddr::new(bind, 0)).await.ok();
        } else {
            let range = self.opts.max_port.saturating_sub(self.opts.min_port) as u32 + 1;
            let start = (uuid::Uuid::new_v4().as_u128() % range as u128) as u32;
            for n in 0..range {
                let port = self.opts.min_port + ((n + start) % range) as u16;
                if let Ok(s) = UdpSocket::bind(SocketAddr::new(bind, port)).await {
                    socket = Some(s);
                    break;
                }
            }
        }
        let socket =
            Arc::new(socket.ok_or_else(|| turn::Error::Other("No free TURN relay port".into()))?);
        let mut address = socket.local_addr()?;
        let public = self.opts.public_ip.unwrap_or(self.local);
        if public.is_ipv4() != v4 {
            return Err(turn::Error::Other("No matching TURN address family".into()));
        }
        address.set_ip(public);
        let conn = RelayConn {
            kind: RelayKind::Udp(socket),
            local: address,
            public,
            allow_private: self.opts.allow_private,
            cancel: CancellationToken::new(),
            lease: StdMutex::new(Some(lease)),
            claim: StdMutex::new(None),
        };
        Ok((Arc::new(conn), address))
    }
}
enum Sender {
    Udp(Arc<UdpSocket>),
    Tcp(mpsc::Sender<Vec<u8>>),
}
struct PacketConn {
    rx: Mutex<mpsc::Receiver<Vec<u8>>>,
    sender: Sender,
    local: SocketAddr,
    peer: SocketAddr,
    cancel: CancellationToken,
}
#[async_trait]
impl Conn for PacketConn {
    async fn connect(&self, _addr: SocketAddr) -> UtilResult<()> {
        Ok(())
    }
    async fn recv(&self, b: &mut [u8]) -> UtilResult<usize> {
        Ok(self.recv_from(b).await?.0)
    }
    async fn recv_from(&self, b: &mut [u8]) -> UtilResult<(usize, SocketAddr)> {
        tokio::select! {_=self.cancel.cancelled()=>Err(io_error("TURN client closed")),packet=async{self.rx.lock().await.recv().await}=>{let p=packet.ok_or_else(||io_error("TURN client closed"))?;if p.len()>b.len(){return Err(io_error("TURN packet too large"));}b[..p.len()].copy_from_slice(&p);Ok((p.len(),self.peer))}}
    }
    async fn send(&self, b: &[u8]) -> UtilResult<usize> {
        self.send_to(b, self.peer).await
    }
    async fn send_to(&self, b: &[u8], target: SocketAddr) -> UtilResult<usize> {
        if target != self.peer {
            return Err(io_error("TURN client mismatch"));
        }
        match &self.sender {
            Sender::Udp(socket) => Ok(socket.send_to(b, target).await?),
            Sender::Tcp(tx) => {
                let mut p = b.to_vec();
                p.resize((p.len() + 3) & !3, 0);
                let _ = tx.try_send(p);
                Ok(b.len())
            }
        }
    }
    fn local_addr(&self) -> UtilResult<SocketAddr> {
        Ok(self.local)
    }
    fn remote_addr(&self) -> Option<SocketAddr> {
        Some(self.peer)
    }
    async fn close(&self) -> UtilResult<()> {
        self.cancel.cancel();
        Ok(())
    }
    fn as_any(&self) -> &(dyn Any + Send + Sync) {
        self
    }
}
#[derive(Clone)]
struct ContextState {
    opts: Options,
    quota: Arc<Quota>,
    auth: Arc<Credentials>,
    cancel: CancellationToken,
    virtual_bridge: Option<VirtualBridge>,
    lanes: Option<Arc<LaneRegistry>>,
    users: Users,
}
fn local_ip(peer: SocketAddr) -> Result<IpAddr> {
    let socket = std::net::UdpSocket::bind(if peer.is_ipv4() {
        "0.0.0.0:0"
    } else {
        "[::]:0"
    })?;
    socket.connect(peer)?;
    Ok(socket.local_addr()?.ip())
}
async fn serve_client(conn: Arc<PacketConn>, state: ContextState) -> Result<()> {
    let local = if conn.local.ip().is_unspecified() {
        local_ip(conn.peer)?
    } else {
        conn.local.ip()
    };
    let server = Server::new(ServerConfig {
        conn_configs: vec![ConnConfig {
            conn: conn.clone(),
            relay_addr_generator: Box::new(Generator {
                opts: state.opts.clone(),
                quota: state.quota,
                client: conn.peer,
                local,
                virtual_bridge: state.virtual_bridge,
                lanes: state.lanes,
                users: state.users.clone(),
            }),
        }],
        realm: "mumh5".into(),
        auth_handler: state.auth,
        channel_bind_timeout: Duration::from_secs(600),
        alloc_close_notify: None,
    })
    .await?;
    tokio::select! {_=conn.cancel.cancelled()=>{},_=state.cancel.cancelled()=>{}}
    let _ = server.close().await;
    if let Ok(mut users) = state.users.lock() {
        users.remove(&conn.peer);
    }
    Ok(())
}
async fn tcp_client(tcp: TcpStream, state: ContextState) -> Result<()> {
    tcp.set_nodelay(true)?;
    let local = tcp.local_addr()?;
    let peer = tcp.peer_addr()?;
    let cancel = state.cancel.child_token();
    let (tx, rx) = mpsc::channel(64);
    let (out, mut writes) = mpsc::channel(64);
    let conn = Arc::new(PacketConn {
        rx: Mutex::new(rx),
        sender: Sender::Tcp(out),
        local,
        peer,
        cancel: cancel.clone(),
    });
    let c = cancel.clone();
    let server = tokio::spawn(async move {
        let _ = serve_client(conn, state).await;
        c.cancel();
    });
    let (mut read, mut write) = tcp.into_split();
    let reader = async {
        loop {
            let mut head = [0; 4];
            tokio::time::timeout(Duration::from_secs(600), read.read_exact(&mut head)).await??;
            let prefix = match head[0] & 0xc0 {
                0 => 20,
                0x40 => 4,
                _ => bail!("Invalid TURN TCP frame"),
            };
            let size = prefix + u16::from_be_bytes([head[2], head[3]]) as usize;
            if size > 65536 {
                bail!("TURN frame too large");
            }
            let mut packet = vec![0; (size + 3) & !3];
            packet[..4].copy_from_slice(&head);
            tokio::time::timeout(Duration::from_secs(600), read.read_exact(&mut packet[4..]))
                .await??;
            packet.truncate(size);
            if tx.send(packet).await.is_err() {
                break;
            }
        }
        anyhow::Ok(())
    };
    let writer = async {
        while let Some(p) = writes.recv().await {
            write.write_all(&p).await?;
        }
        anyhow::Ok(())
    };
    tokio::select! {_=cancel.cancelled()=>{},_=reader=>{},_=writer=>{}}
    cancel.cancel();
    let _ = server.await;
    Ok(())
}
pub struct TurnServer {
    pub port: u16,
    secret: String,
    lanes: Option<Arc<LaneRegistry>>,
    cancel: CancellationToken,
    tasks: Vec<tokio::task::JoinHandle<()>>,
}
impl TurnServer {
    pub async fn start(opts: Options, bridge: Option<VirtualBridge>) -> Result<Self> {
        if opts.min_port > opts.max_port || opts.max_allocations == 0 || opts.max_per_address == 0 {
            bail!("Invalid TURN limits");
        }
        let secret = uuid::Uuid::new_v4().simple().to_string();
        let cancel = CancellationToken::new();
        // Only a public relay (no fixed bridge) serves lanes of links kept for browsers.
        let lanes = (bridge.is_none() && opts.relay).then(|| Arc::new(LaneRegistry::default()));
        let users = Users::default();
        let state = ContextState {
            auth: Arc::new(Credentials {
                secret: secret.clone(),
                relay: opts.relay,
                lanes: lanes.clone(),
                users: users.clone(),
            }),
            opts: opts.clone(),
            quota: Arc::new(Quota::default()),
            cancel: cancel.clone(),
            virtual_bridge: bridge,
            lanes: lanes.clone(),
            users,
        };
        let mut tasks = vec![];
        let port;
        if state.virtual_bridge.is_none() {
            let socket = Arc::new(UdpSocket::bind(opts.bind).await?);
            port = socket.local_addr()?.port();
            let state = state.clone();
            let stop = cancel.clone();
            tasks.push(tokio::spawn(async move{
 let mut peers:HashMap<SocketAddr,(mpsc::Sender<Vec<u8>>,CancellationToken,tokio::time::Instant)>=HashMap::new();let mut buffer=vec![0;65536];let mut sweep=tokio::time::interval(Duration::from_secs(30));loop{tokio::select!{_=stop.cancelled()=>break,_=sweep.tick()=>{peers.retain(|_,(_,c,t)|{if t.elapsed()>Duration::from_secs(600){c.cancel();false}else{!c.is_cancelled()}});},r=socket.recv_from(&mut buffer)=>{let Ok((n,addr))=r else{break;};if n<4{continue;}
if !peers.contains_key(&addr){if peers.len()>=state.opts.max_allocations.saturating_mul(4).max(16){continue;}let(tx,rx)=mpsc::channel(64);let c=stop.child_token();let conn=Arc::new(PacketConn{rx:Mutex::new(rx),sender:Sender::Udp(socket.clone()),local:socket.local_addr().unwrap(),peer:addr,cancel:c.clone()});let s=state.clone();let closed=c.clone();tokio::spawn(async move{let _=serve_client(conn,s).await;closed.cancel();});peers.insert(addr,(tx,c,tokio::time::Instant::now()));}
if let Some((tx,_,at))=peers.get_mut(&addr){*at=tokio::time::Instant::now();let _=tx.try_send(buffer[..n].to_vec());}}}}for(_,(_,c,_))in peers{c.cancel();}
 }));
        } else {
            port = 0;
        }
        let port = if opts.relay {
            let listener = match TcpListener::bind(SocketAddr::new(opts.bind.ip(), port)).await {
                Ok(v) => v,
                Err(e) => {
                    cancel.cancel();
                    for task in tasks {
                        task.abort();
                    }
                    return Err(e.into());
                }
            };
            let port = listener.local_addr()?.port();
            let state = state.clone();
            let stop = cancel.clone();
            tasks.push(tokio::spawn(async move{let slots=Arc::new(tokio::sync::Semaphore::new(state.opts.max_allocations.saturating_mul(4).max(16)));loop{tokio::select!{_=stop.cancelled()=>break,r=listener.accept()=>{let Ok((stream,_))=r else{break;};let Ok(permit)=slots.clone().try_acquire_owned()else{continue;};let s=state.clone();tokio::spawn(async move{let _permit=permit;let _=tcp_client(stream,s).await;});}}}}));
            port
        } else {
            port
        };
        Ok(Self {
            port,
            secret,
            lanes,
            cancel,
            tasks,
        })
    }
    /// Issues lane credentials on this relay, when it relays at all.
    pub fn lane_issuer(&self) -> Option<LaneIssuer> {
        Some(LaneIssuer {
            registry: self.lanes.clone()?,
            port: self.port,
            secret: self.secret.clone(),
        })
    }
    pub fn credentials(&self) -> Result<(String, String)> {
        Ok(generate_long_term_credentials(
            &self.secret,
            Duration::from_secs(12 * 3600),
        )?)
    }
    pub async fn close(&mut self) {
        self.cancel.cancel();
        for task in self.tasks.drain(..) {
            let _ = task.await;
        }
    }
}
impl Drop for TurnServer {
    fn drop(&mut self) {
        self.cancel.cancel();
        for task in &self.tasks {
            task.abort();
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_private_relay_destinations() {
        for ip in [
            "127.0.0.1",
            "10.1.2.3",
            "100.64.0.1",
            "::1",
            "fc00::1",
            "::ffff:127.0.0.1",
        ] {
            assert!(private(ip.parse().unwrap()));
        }
        assert!(!private("8.8.8.8".parse().unwrap()));
    }
}

#[cfg(test)]
mod integration_tests {
    use super::*;
    use turn::client::{Client, ClientConfig};
    struct TcpPackets {
        read: Mutex<tokio::net::tcp::OwnedReadHalf>,
        write: Mutex<tokio::net::tcp::OwnedWriteHalf>,
        peer: SocketAddr,
        local: SocketAddr,
    }
    impl TcpPackets {
        async fn open(port: u16) -> Result<Self> {
            let stream = TcpStream::connect(("127.0.0.1", port)).await?;
            let peer = stream.peer_addr()?;
            let local = stream.local_addr()?;
            let (read, write) = stream.into_split();
            Ok(Self {
                read: Mutex::new(read),
                write: Mutex::new(write),
                peer,
                local,
            })
        }
    }
    #[async_trait]
    impl Conn for TcpPackets {
        async fn connect(&self, _: SocketAddr) -> UtilResult<()> {
            Ok(())
        }
        async fn recv(&self, b: &mut [u8]) -> UtilResult<usize> {
            Ok(self.recv_from(b).await?.0)
        }
        async fn recv_from(&self, b: &mut [u8]) -> UtilResult<(usize, SocketAddr)> {
            let mut read = self.read.lock().await;
            let mut head = [0; 4];
            read.read_exact(&mut head).await?;
            let prefix = if head[0] & 0xc0 == 0 { 20 } else { 4 };
            let size = prefix + u16::from_be_bytes([head[2], head[3]]) as usize;
            let padded = (size + 3) & !3;
            let mut packet = vec![0; padded];
            packet[..4].copy_from_slice(&head);
            read.read_exact(&mut packet[4..]).await?;
            if size > b.len() {
                return Err(io_error("Packet too large"));
            }
            b[..size].copy_from_slice(&packet[..size]);
            Ok((size, self.peer))
        }
        async fn send(&self, b: &[u8]) -> UtilResult<usize> {
            self.send_to(b, self.peer).await
        }
        async fn send_to(&self, b: &[u8], _: SocketAddr) -> UtilResult<usize> {
            let mut packet = b.to_vec();
            packet.resize((packet.len() + 3) & !3, 0);
            self.write.lock().await.write_all(&packet).await?;
            Ok(b.len())
        }
        fn local_addr(&self) -> UtilResult<SocketAddr> {
            Ok(self.local)
        }
        fn remote_addr(&self) -> Option<SocketAddr> {
            Some(self.peer)
        }
        async fn close(&self) -> UtilResult<()> {
            self.write.lock().await.shutdown().await?;
            Ok(())
        }
        fn as_any(&self) -> &(dyn Any + Send + Sync) {
            self
        }
    }
    async fn client(server: &TurnServer, tcp: bool) -> Result<Client> {
        let (user, password) = server.credentials()?;
        client_as(server, tcp, user, password).await
    }
    async fn client_as(
        server: &TurnServer,
        tcp: bool,
        user: String,
        password: String,
    ) -> Result<Client> {
        let conn: Arc<dyn Conn + Send + Sync> = if tcp {
            Arc::new(TcpPackets::open(server.port).await?)
        } else {
            Arc::new(UdpSocket::bind("127.0.0.1:0").await?)
        };
        let address = format!("127.0.0.1:{}", server.port);
        let client = Client::new(ClientConfig {
            stun_serv_addr: address.clone(),
            turn_serv_addr: address,
            username: user,
            password,
            realm: "mumh5".into(),
            software: "mumh5-test".into(),
            rto_in_ms: 100,
            conn,
            vnet: None,
        })
        .await?;
        client.listen().await?;
        Ok(client)
    }
    #[tokio::test]
    async fn authenticated_udp_and_tcp_relay_bidirectionally() -> Result<()> {
        tokio::time::timeout(Duration::from_secs(15), async {
            let mut server = TurnServer::start(
                Options {
                    bind: "127.0.0.1:0".parse()?,
                    min_port: 0,
                    max_port: 0,
                    allow_private: true,
                    ..Default::default()
                },
                None,
            )
            .await?;
            for tcp in [false, true] {
                let client = client(&server, tcp).await?;
                let relay = client.allocate().await?;
                let peer = UdpSocket::bind("127.0.0.1:0").await?;
                let peer_addr = peer.local_addr()?;
                relay.send_to(b"outgoing", peer_addr).await?;
                let mut buffer = [0; 2048];
                let (n, source) = peer.recv_from(&mut buffer).await?;
                assert_eq!(&buffer[..n], b"outgoing");
                assert_eq!(source, relay.local_addr()?);
                peer.send_to(b"incoming", source).await?;
                let (n, source) = relay.recv_from(&mut buffer).await?;
                assert_eq!(&buffer[..n], b"incoming");
                assert_eq!(source, peer_addr);
                relay.close().await?;
                client.close().await?;
            }
            server.close().await;
            anyhow::Ok(())
        })
        .await??;
        Ok(())
    }
    #[tokio::test]
    async fn virtual_lane_carries_media_without_binding_documentation_addresses() -> Result<()> {
        tokio::time::timeout(Duration::from_secs(15),async{
 let(a_tx,mut a_rx)=mpsc::channel(64);let(b_tx,mut b_rx)=mpsc::channel(64);let(a_in,_)=broadcast::channel(64);let(b_in,_)=broadcast::channel(64);let a=a_in.clone();let b=b_in.clone();let cancel=CancellationToken::new();let stop=cancel.clone();let pump=tokio::spawn(async move{loop{tokio::select!{_=stop.cancelled()=>break,p=a_rx.recv()=>{if let Some(p)=p{let _=b.send(p);}else{break;}},p=b_rx.recv()=>{if let Some(p)=p{let _=a.send(p);}else{break;}}}}});
 let low="192.0.2.1:40001".parse()?;let high="192.0.2.2:40001".parse()?;let opts=Options{bind:"127.0.0.1:0".parse()?,max_allocations:1,max_per_address:1,..Default::default()};let mut left=TurnServer::start(opts.clone(),Some(VirtualBridge{local:low,remote:high,outgoing:a_tx,incoming:a_in,cancel:cancel.clone()})).await?;let mut right=TurnServer::start(opts,Some(VirtualBridge{local:high,remote:low,outgoing:b_tx,incoming:b_in,cancel:cancel.clone()})).await?;let a=client(&left,true).await?;let b=client(&right,true).await?;let ar=a.allocate().await?;let br=b.allocate().await?;assert_eq!(ar.local_addr()?,low);assert_eq!(br.local_addr()?,high);
 // Permissions are established by sending in both directions, as ICE connectivity checks do.
 ar.send_to(b"probe",high).await?;br.send_to(b"back",low).await?;ar.send_to(b"forward",high).await?;let mut bytes=[0;2048];let(n,from)=ar.recv_from(&mut bytes).await?;assert_eq!(&bytes[..n],b"back");assert_eq!(from,high);loop{let(n,from)=br.recv_from(&mut bytes).await?;assert_eq!(from,low);if &bytes[..n]==b"forward"{break;}}
 ar.close().await?;br.close().await?;a.close().await?;b.close().await?;cancel.cancel();pump.await?;left.close().await;right.close().await;anyhow::Ok(())}).await??;
        Ok(())
    }
    #[test]
    fn lane_usernames_are_recognised() {
        assert!(is_lane_user(
            "1800000000:lane-0123456789abcdef0123456789abcdef"
        ));
        for user in [
            "1800000000",
            "x:lane-0123456789abcdef0123456789abcdef",
            "1:lane-0123",
            "1:lane-0123456789ABCDEF0123456789ABCDEF",
        ] {
            assert!(!is_lane_user(user), "{user}");
        }
    }
    #[tokio::test]
    async fn public_relay_lanes_reach_only_their_virtual_address() -> Result<()> {
        tokio::time::timeout(Duration::from_secs(20), async {
            let mut server = TurnServer::start(
                Options {
                    bind: "127.0.0.1:0".parse()?,
                    min_port: 0,
                    max_port: 0,
                    ..Default::default()
                },
                None,
            )
            .await?;
            let issuer = server.lane_issuer().expect("relay serves lanes");
            let (out_tx, mut out_rx) = mpsc::channel(64);
            let (incoming, _) = broadcast::channel(64);
            let cancel = CancellationToken::new();
            let high: SocketAddr = "192.0.2.2:40001".parse()?;
            let low: SocketAddr = "192.0.2.1:40001".parse()?;
            let bridge = VirtualBridge {
                local: high,
                remote: low,
                outgoing: out_tx,
                incoming: incoming.clone(),
                cancel: cancel.clone(),
            };
            // An unregistered lane credential is refused outright, never given a normal relay.
            let (ghost, ghost_password) = issuer.credentials()?;
            let refused = client_as(&server, false, ghost, ghost_password).await?;
            assert!(refused.allocate().await.is_err());
            refused.close().await?;
            let (user, password) = issuer.credentials()?;
            let handle = issuer.registry.register(user.clone(), bridge);
            for tcp in [false, true] {
                let client = client_as(&server, tcp, user.clone(), password.clone()).await?;
                let relay = client.allocate().await?;
                // The high side of the pair gets its own address, not the low placeholder.
                assert_eq!(relay.local_addr()?, high);
                relay.send_to(b"to-peer", low).await?;
                assert_eq!(out_rx.recv().await.as_deref(), Some(&b"to-peer"[..]));
                incoming.send(b"from-peer".to_vec())?;
                let mut bytes = [0; 2048];
                let (n, from) = relay.recv_from(&mut bytes).await?;
                assert_eq!((&bytes[..n], from), (&b"from-peer"[..], low));
                // One allocation at a time per lane.
                let second = client_as(&server, true, user.clone(), password.clone()).await?;
                assert!(second.allocate().await.is_err());
                second.close().await?;
                relay.close().await?;
                client.close().await?;
                // Freed for the next allocation once the first closes.
                for _ in 0..50 {
                    if issuer
                        .registry
                        .lanes
                        .lock()
                        .unwrap()
                        .get(&user)
                        .is_some_and(|e| e.busy.is_none())
                    {
                        break;
                    }
                    tokio::time::sleep(Duration::from_millis(20)).await;
                }
            }
            drop(handle);
            assert!(!issuer.registry.has(&user));
            let late = client_as(&server, false, user, password).await?;
            assert!(late.allocate().await.is_err());
            late.close().await?;
            cancel.cancel();
            server.close().await;
            anyhow::Ok(())
        })
        .await??;
        Ok(())
    }
}
