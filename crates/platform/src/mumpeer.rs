//! Pinned TLS mumpeer backhaul with a bounded, loopback-only TURN adapter per media lane.
use crate::turn::{Options, TurnServer, VirtualBridge};
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
struct Lane {
    server: TurnServer,
    ice: Value,
    cancel: CancellationToken,
}
pub struct Link {
    pub cancel: CancellationToken,
    lanes: tokio::sync::Mutex<HashMap<u8, Lane>>,
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
            let tcp = TcpStream::connect((endpoint.host.as_str(), endpoint.tcp)).await?;
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
                    Some("error") => bail!("Mumpeer refused link: {}", msg["code"]),
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
        let server = match TurnServer::start(
            Options {
                bind: "127.0.0.1:0".parse()?,
                max_allocations: 1,
                max_per_address: 1,
                ..Default::default()
            },
            Some(bridge),
        )
        .await
        {
            Ok(s) => s,
            Err(e) => {
                self.receivers.lock().unwrap().remove(&lane);
                return Err(e);
            }
        };
        let (username, credential) = server.credentials()?;
        let ice = json!({"urls":format!("turn:127.0.0.1:{}?transport=tcp",server.port),"username":username,"credential":credential});
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
                server,
                ice: ice.clone(),
                cancel,
            },
        );
        Ok(ice)
    }
    pub async fn close_lane(&self, lane: u8) {
        self.receivers.lock().unwrap().remove(&lane);
        if let Some(mut l) = self.lanes.lock().await.remove(&lane) {
            l.cancel.cancel();
            l.server.close().await;
        }
    }
}
impl Drop for Link {
    fn drop(&mut self) {
        self.cancel.cancel();
    }
}
