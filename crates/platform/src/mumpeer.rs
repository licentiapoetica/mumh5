//! Pinned TLS mumpeer backhaul with a bounded, loopback-only TURN adapter per media lane.
use crate::turn::{LaneHandle, LaneIssuer, Options, TurnServer, VirtualBridge};
use anyhow::{Context, Result, bail};
use mumh5_core::identity::Identity;
use openssl::{
    hash::MessageDigest,
    pkey::PKey,
    ssl::{SslConnector, SslMethod, SslVerifyMode, SslVersion},
    x509::X509,
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    net::SocketAddr,
    pin::Pin,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpStream,
    sync::{broadcast, mpsc},
    time::timeout,
};
use tokio_openssl::SslStream;
use tokio_util::sync::CancellationToken;
#[derive(Deserialize)]
pub struct Endpoint {
    pub host: String,
    pub tcp: u16,
    pub fp: String,
}
/// Where a link's lanes are served.
#[derive(Clone, Default)]
pub enum Lanes {
    /// The desktop app: a TURN server on loopback for each lane, never reachable from outside.
    #[default]
    Loopback,
    /// The web gateway: a lane credential on its public relay. The page knows the relay's host
    /// (the one it reached), so the answer is `{port, username, credential, extra}`.
    Public {
        issuer: LaneIssuer,
        extra: Vec<String>,
    },
}
enum Served {
    Loopback(TurnServer),
    Public(#[allow(dead_code)] LaneHandle),
}
struct Lane {
    served: Served,
    ice: Value,
    cancel: CancellationToken,
}
/// How to reach the relay and where to serve lanes.
#[derive(Clone, Default)]
pub struct LinkOptions {
    pub lanes: Lanes,
    /// A pre-resolved (and policy-checked) relay address; otherwise the host is resolved here.
    pub address: Option<SocketAddr>,
}
pub struct Link {
    pub cancel: CancellationToken,
    lanes: tokio::sync::Mutex<HashMap<u8, Lane>>,
    mode: Lanes,
    receivers: Arc<Mutex<HashMap<u8, broadcast::Sender<Vec<u8>>>>>,
    send: mpsc::Sender<Vec<u8>>,
    low: bool,
}
async fn frame<R: tokio::io::AsyncRead + Unpin>(r: &mut R) -> Result<(u8, Vec<u8>)> {
    let mut h = [0; 3];
    r.read_exact(&mut h).await?;
    let n = u16::from_be_bytes([h[1], h[2]]) as usize;
    if h[0] > 1 || n > 1500 {
        bail!("Invalid mumpeer frame");
    }
    let mut b = vec![0; n];
    r.read_exact(&mut b).await?;
    Ok((h[0], b))
}
fn packet(kind: u8, b: &[u8]) -> Vec<u8> {
    let n = b.len() as u16;
    let mut p = vec![kind, (n >> 8) as u8, n as u8];
    p.extend_from_slice(b);
    p
}
impl Link {
    pub async fn open(
        endpoint: Endpoint,
        token: String,
        identity: Identity,
        low: bool,
        parent: CancellationToken,
        closed: impl FnOnce(String) + Send + 'static,
    ) -> Result<Arc<Self>> {
        Self::open_with(
            endpoint,
            token,
            identity,
            low,
            parent,
            closed,
            LinkOptions::default(),
        )
        .await
    }
    pub async fn open_with(
        endpoint: Endpoint,
        token: String,
        identity: Identity,
        low: bool,
        parent: CancellationToken,
        closed: impl FnOnce(String) + Send + 'static,
        options: LinkOptions,
    ) -> Result<Arc<Self>> {
        if endpoint.host.is_empty()
            || endpoint.host.len() > 253
            || endpoint.tcp == 0
            || token.len() > 1024
        {
            bail!("Invalid mumpeer endpoint or token");
        }
        let expected = mumh5_core::identity::fingerprint(&endpoint.fp)?;
        let tls = timeout(Duration::from_secs(10), async {
            let mut builder = SslConnector::builder(SslMethod::tls_client())?;
            builder.set_min_proto_version(Some(SslVersion::TLS1_3))?;
            builder.set_verify(SslVerifyMode::NONE);
            let cert = X509::from_pem(identity.cert_pem.as_bytes())?;
            let key = PKey::private_key_from_pem(identity.key_pem.as_bytes())?;
            builder.set_certificate(&cert)?;
            builder.set_private_key(&key)?;
            builder.check_private_key()?;
            builder.set_alpn_protos(b"\x09mumpeer/1")?;
            let tcp = match options.address {
                Some(address) => TcpStream::connect(address).await?,
                None => TcpStream::connect((endpoint.host.as_str(), endpoint.tcp)).await?,
            };
            tcp.set_nodelay(true)?;
            let mut tls =
                SslStream::new(builder.build().configure()?.into_ssl(&endpoint.host)?, tcp)?;
            Pin::new(&mut tls).connect().await?;
            let cert = tls
                .ssl()
                .peer_certificate()
                .context("Mumpeer did not present a certificate")?;
            let actual = cert
                .digest(MessageDigest::sha256())?
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect::<String>();
            if actual != expected || tls.ssl().selected_alpn_protocol() != Some(b"mumpeer/1") {
                bail!("Mumpeer certificate or protocol did not match");
            }
            tls.write_all(&packet(
                0,
                &serde_json::to_vec(&json!({"v":1,"t":"bind","tok":token}))?,
            ))
            .await?;
            loop {
                let (kind, b) = frame(&mut tls).await?;
                if kind != 0 {
                    bail!("Media before mumpeer ready");
                }
                let msg: Value = serde_json::from_slice(&b)?;
                if msg["v"] != 1 {
                    bail!("Invalid mumpeer version");
                }
                match msg["t"].as_str() {
                    Some("waiting") => {}
                    Some("ready") => break,
                    Some("error") => bail!("Mumpeer refused the link: {}", msg["code"]),
                    _ => bail!("Invalid mumpeer control"),
                }
            }
            anyhow::Ok(tls)
        })
        .await??;
        let cancel = parent.child_token();
        let (send, mut outgoing) = mpsc::channel::<Vec<u8>>(64);
        let receivers = Arc::new(Mutex::new(HashMap::<u8, broadcast::Sender<Vec<u8>>>::new()));
        let link = Arc::new(Self {
            cancel: cancel.clone(),
            lanes: Default::default(),
            receivers: receivers.clone(),
            send,
            low,
            mode: options.lanes,
        });
        tokio::spawn(async move {
            let (mut r, mut w) = tokio::io::split(tls);
            let read = async {
                loop {
                    let (kind, b) = frame(&mut r).await?;
                    if kind != 1 || b.len() < 2 {
                        bail!("Unexpected mumpeer control or empty packet");
                    }
                    if let Some(tx) = receivers
                        .lock()
                        .map_err(|_| anyhow::anyhow!("Lane lock poisoned"))?
                        .get(&b[0])
                    {
                        let _ = tx.send(b[1..].to_vec());
                    }
                }
                #[allow(unreachable_code)]
                anyhow::Ok(())
            };
            let write = async {
                while let Some(b) = outgoing.recv().await {
                    w.write_all(&b).await?;
                }
                anyhow::Ok(())
            };
            let reason = tokio::select! {_=cancel.cancelled()=>"Mumpeer link closed".into(),r=read=>r.err().map(|e|e.to_string()).unwrap_or_default(),r=write=>r.err().map(|e|e.to_string()).unwrap_or_default()};
            cancel.cancel();
            closed(reason);
        });
        Ok(link)
    }
    pub async fn turn(&self, lane: u8) -> Result<Value> {
        if self.cancel.is_cancelled() {
            bail!("Mumpeer link closed");
        }
        let mut lanes = self.lanes.lock().await;
        if let Some(l) = lanes.get(&lane) {
            return Ok(l.ice.clone());
        }
        let port = 40000 + lane as u16;
        let lo = format!("192.0.2.1:{port}").parse()?;
        let hi = format!("192.0.2.2:{port}").parse()?;
        let (tx, mut rx) = mpsc::channel::<Vec<u8>>(64);
        let (incoming, _) = broadcast::channel(64);
        self.receivers
            .lock()
            .map_err(|_| anyhow::anyhow!("Lane lock poisoned"))?
            .insert(lane, incoming.clone());
        let cancel = self.cancel.child_token();
        let bridge = VirtualBridge {
            local: if self.low { lo } else { hi },
            remote: if self.low { hi } else { lo },
            outgoing: tx,
            incoming,
            cancel: cancel.clone(),
        };
        let served = match &self.mode {
            Lanes::Loopback => TurnServer::start(
                Options {
                    bind: "127.0.0.1:0".parse()?,
                    max_allocations: 1,
                    max_per_address: 1,
                    ..Default::default()
                },
                Some(bridge),
            )
            .await
            .and_then(|server| {
                let (username, credential) = server.credentials()?;
                let ice = json!({"urls":format!("turn:127.0.0.1:{}?transport=tcp",server.port),"username":username,"credential":credential});
                Ok((Served::Loopback(server), ice))
            }),
            Lanes::Public { issuer, extra } => issuer.credentials().map(|(username, credential)| {
                let ice = json!({"port":issuer.port,"username":username,"credential":credential,"extra":extra});
                (Served::Public(issuer.registry.register(username, bridge)), ice)
            }),
        };
        let (served, ice) = match served {
            Ok(v) => v,
            Err(e) => {
                self.receivers.lock().unwrap().remove(&lane);
                return Err(e);
            }
        };
        let stop = cancel.clone();
        let send = self.send.clone();
        tokio::spawn(async move {
            loop {
                tokio::select! {_=stop.cancelled()=>break,b=rx.recv()=>{let Some(b)=b else{break;};let mut body=vec![lane];body.extend_from_slice(&b);let _=send.try_send(packet(1,&body));}}
            }
        });
        lanes.insert(
            lane,
            Lane {
                served,
                ice: ice.clone(),
                cancel,
            },
        );
        Ok(ice)
    }
    pub async fn close_lane(&self, lane: u8) {
        self.receivers.lock().unwrap().remove(&lane);
        if let Some(l) = self.lanes.lock().await.remove(&lane) {
            l.cancel.cancel();
            if let Served::Loopback(mut server) = l.served {
                server.close().await;
            }
        }
    }
    /// Ends the link and every lane.
    pub async fn close(&self) {
        self.cancel.cancel();
        let lanes: Vec<_> = self.lanes.lock().await.drain().collect();
        for (lane, l) in lanes {
            self.receivers.lock().unwrap().remove(&lane);
            l.cancel.cancel();
            if let Served::Loopback(mut server) = l.served {
                server.close().await;
            }
        }
    }
}
impl Drop for Link {
    fn drop(&mut self) {
        self.cancel.cancel();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use mumh5_core::identity::generate;
    use openssl::ssl::{AlpnError, SslAcceptor, select_next_proto};
    use tokio::{net::TcpListener, sync::oneshot};

    #[derive(Clone, Copy)]
    enum Relay {
        /// Speaks mumpeer/1, answers `waiting` then `ready`, then sends one media frame.
        Ready,
        /// Negotiates no ALPN protocol at all and only records what it receives.
        NoAlpn,
        /// Negotiates mumpeer/1 but only records what it receives.
        Listen,
        /// Refuses the bind with an error control message.
        Refuse,
    }

    /// A local relay with its own certificate. It reports every control/media byte it receives
    /// after the TLS handshake, so tests can prove the token never leaves on a rejected link.
    async fn relay(mode: Relay) -> (u16, String, oneshot::Receiver<Vec<u8>>) {
        let id = generate("mumpeer-test-relay", "").unwrap();
        let cert = X509::from_pem(id.cert_pem.as_bytes()).unwrap();
        let fp = cert
            .digest(MessageDigest::sha256())
            .unwrap()
            .iter()
            .map(|b| format!("{b:02X}"))
            .collect::<Vec<_>>()
            .join(":");
        let mut acceptor = SslAcceptor::mozilla_modern_v5(SslMethod::tls_server()).unwrap();
        acceptor.set_certificate(&cert).unwrap();
        acceptor
            .set_private_key(&PKey::private_key_from_pem(id.key_pem.as_bytes()).unwrap())
            .unwrap();
        acceptor.set_verify(SslVerifyMode::NONE);
        if !matches!(mode, Relay::NoAlpn) {
            acceptor.set_alpn_select_callback(|_, client| {
                select_next_proto(b"\x09mumpeer/1", client).ok_or(AlpnError::NOACK)
            });
        }
        let acceptor = acceptor.build();
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let (report, received) = oneshot::channel();
        tokio::spawn(async move {
            let (tcp, _) = listener.accept().await.unwrap();
            let mut tls = SslStream::new(Ssl::new(acceptor.context()).unwrap(), tcp).unwrap();
            if Pin::new(&mut tls).accept().await.is_err() {
                let _ = report.send(vec![]);
                return;
            }
            let mut seen = vec![];
            if matches!(mode, Relay::NoAlpn | Relay::Listen) {
                let mut buf = [0; 4096];
                while let Ok(Ok(n)) = timeout(Duration::from_secs(2), tls.read(&mut buf)).await {
                    if n == 0 {
                        break;
                    }
                    seen.extend_from_slice(&buf[..n]);
                }
                let _ = report.send(seen);
                return;
            }
            let (kind, bind) = frame(&mut tls).await.unwrap();
            assert_eq!(kind, 0);
            seen.extend_from_slice(&bind);
            let reply = |v: Value| packet(0, &serde_json::to_vec(&v).unwrap());
            match mode {
                Relay::Refuse => {
                    tls.write_all(&reply(json!({"v":1,"t":"error","code":"bad-token"})))
                        .await
                        .unwrap();
                }
                _ => {
                    tls.write_all(&reply(json!({"v":1,"t":"waiting"})))
                        .await
                        .unwrap();
                    tls.write_all(&reply(json!({"v":1,"t":"ready"})))
                        .await
                        .unwrap();
                    tls.write_all(&packet(1, &[3, 0xAA, 0xBB])).await.unwrap();
                }
            }
            let _ = report.send(seen);
            // Hold the link briefly, then tear it down from the relay side.
            tokio::time::sleep(Duration::from_millis(300)).await;
            let _ = tls.shutdown().await;
        });
        (port, fp, received)
    }

    fn endpoint(port: u16, fp: &str) -> Endpoint {
        Endpoint {
            host: "127.0.0.1".into(),
            tcp: port,
            fp: fp.into(),
        }
    }

    fn client() -> Identity {
        generate("mumpeer-test-client", "").unwrap()
    }

    use openssl::ssl::Ssl;

    #[tokio::test]
    async fn binds_with_token_and_reports_relay_teardown() {
        let (port, fp, received) = relay(Relay::Ready).await;
        let (closed_tx, closed_rx) = oneshot::channel();
        let link = Link::open(
            endpoint(port, &fp),
            "secret-token".into(),
            client(),
            true,
            CancellationToken::new(),
            move |reason| {
                let _ = closed_tx.send(reason);
            },
        )
        .await
        .unwrap();
        let bind: Value = serde_json::from_slice(&received.await.unwrap()).unwrap();
        assert_eq!(bind, json!({"v":1,"t":"bind","tok":"secret-token"}));
        // Lanes are allocated once, reused, and can be reallocated after closing.
        let first = link.turn(3).await.unwrap();
        assert_eq!(link.turn(3).await.unwrap(), first);
        link.close_lane(3).await;
        let again = link.turn(3).await.unwrap();
        assert!(
            again["urls"]
                .as_str()
                .unwrap()
                .starts_with("turn:127.0.0.1:")
        );
        let reason = timeout(Duration::from_secs(5), closed_rx)
            .await
            .unwrap()
            .unwrap();
        assert!(!reason.is_empty());
        assert!(link.cancel.is_cancelled());
        assert!(link.turn(4).await.is_err());
    }

    #[tokio::test]
    async fn wrong_pin_is_rejected_before_the_token_is_sent() {
        let (port, _, received) = relay(Relay::Listen).await;
        let wrong = ["00"; 32].join(":");
        let error = Link::open(
            endpoint(port, &wrong),
            "secret-token".into(),
            client(),
            true,
            CancellationToken::new(),
            |_| {},
        )
        .await
        .err()
        .unwrap();
        assert!(error.to_string().contains("did not match"), "{error}");
        assert!(received.await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn missing_alpn_is_rejected_before_the_token_is_sent() {
        let (port, fp, received) = relay(Relay::NoAlpn).await;
        let error = Link::open(
            endpoint(port, &fp),
            "secret-token".into(),
            client(),
            true,
            CancellationToken::new(),
            |_| {},
        )
        .await
        .err()
        .unwrap();
        assert!(error.to_string().contains("did not match"), "{error}");
        assert!(received.await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn relay_refusal_is_reported() {
        let (port, fp, _) = relay(Relay::Refuse).await;
        let error = Link::open(
            endpoint(port, &fp),
            "secret-token".into(),
            client(),
            true,
            CancellationToken::new(),
            |_| {},
        )
        .await
        .err()
        .unwrap();
        assert!(error.to_string().contains("bad-token"), "{error}");
    }

    #[tokio::test]
    async fn parent_cancellation_closes_the_link() {
        let (port, fp, _) = relay(Relay::Ready).await;
        let parent = CancellationToken::new();
        let (closed_tx, closed_rx) = oneshot::channel();
        let link = Link::open(
            endpoint(port, &fp),
            "secret-token".into(),
            client(),
            false,
            parent.clone(),
            move |reason| {
                let _ = closed_tx.send(reason);
            },
        )
        .await
        .unwrap();
        parent.cancel();
        let reason = timeout(Duration::from_secs(5), closed_rx)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(reason, "Mumpeer link closed");
        assert!(link.cancel.is_cancelled());
    }

    #[test]
    fn invalid_endpoints_and_oversized_tokens_are_refused() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let fp = ["00"; 32].join(":");
        for (ep, token) in [
            (endpoint(0, &fp), "t".to_owned()),
            (
                Endpoint {
                    host: String::new(),
                    tcp: 1,
                    fp: fp.clone(),
                },
                "t".to_owned(),
            ),
            (endpoint(1, &fp), "x".repeat(1025)),
        ] {
            let result = rt.block_on(Link::open(
                ep,
                token,
                client(),
                true,
                CancellationToken::new(),
                |_| {},
            ));
            assert!(result.is_err());
        }
    }
}
