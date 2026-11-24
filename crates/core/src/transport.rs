//! Bounded native TLS byte transport. The UI checks `secure` before authenticating.
//! This reuses the CLI's identity connector; no private key crosses desktop IPC.
use crate::{
    certificates,
    identity::{self, Identity},
};
use anyhow::{Context, Result, bail};
use openssl::{hash::MessageDigest, x509::X509VerifyResult};
use serde_json::{Value, json};
use std::{pin::Pin, time::Duration};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpStream,
    sync::mpsc,
    time::timeout,
};
use tokio_openssl::SslStream;
use tokio_util::sync::CancellationToken;

pub struct Transport {
    pub secure: Value,
    pub peer: std::net::SocketAddr,
    pub send: mpsc::Sender<Vec<u8>>,
    pub receive: mpsc::Receiver<Result<Vec<u8>>>,
    pub cancel: CancellationToken,
}
impl Transport {
    pub async fn connect(host: &str, port: u16, identity: &Identity) -> Result<Self> {
        if host.is_empty() || host.len() > 253 || port == 0 {
            bail!("Invalid server address");
        }
        let tcp = timeout(Duration::from_secs(20), TcpStream::connect((host, port))).await??;
        tcp.set_nodelay(true)?;
        let peer = tcp.peer_addr()?;
        let ssl = identity::connector(identity)?.configure()?.into_ssl(host)?;
        let mut tls = SslStream::new(ssl, tcp)?;
        timeout(Duration::from_secs(20), Pin::new(&mut tls).connect()).await??;
        let leaf = tls
            .ssl()
            .peer_certificate()
            .context("Server did not present a certificate")?;
        let mut chain = vec![certificates::describe(&leaf)?];
        if let Some(certs) = tls.ssl().peer_cert_chain() {
            for cert in certs {
                if cert.to_der()? != leaf.to_der()? {
                    chain.push(certificates::describe(cert)?);
                }
            }
        }
        let verification = tls.ssl().verify_result();
        let secure = json!({"fingerprint":certificates::digest(&leaf,MessageDigest::sha256())?,"authorized":verification==X509VerifyResult::OK,"authError":if verification==X509VerifyResult::OK {None} else {Some(verification.error_string())},"chain":chain});
        let (send, mut outgoing) = mpsc::channel::<Vec<u8>>(32);
        let (incoming, receive) = mpsc::channel(16);
        let cancel = CancellationToken::new();
        let stop = cancel.clone();
        tokio::spawn(async move {
            let (mut reader, mut writer) = tokio::io::split(tls);
            let read = async {
                let mut buffer = vec![0; 65536];
                loop {
                    let n = reader.read(&mut buffer).await?;
                    if n == 0 {
                        break;
                    }
                    if incoming.send(Ok(buffer[..n].to_vec())).await.is_err() {
                        break;
                    }
                }
                anyhow::Ok(())
            };
            let write = async {
                while let Some(bytes) = outgoing.recv().await {
                    if bytes.len() > 8 * 1024 * 1024 {
                        bail!("Frame too large");
                    }
                    writer.write_all(&bytes).await?;
                }
                anyhow::Ok(())
            };
            let result = tokio::select! {_ = stop.cancelled()=>Ok(()), r=read=>r,r=write=>r};
            if let Err(e) = result {
                let _ = incoming.try_send(Err(e));
            }
        });
        Ok(Self {
            secure,
            peer,
            send,
            receive,
            cancel,
        })
    }
}
impl Drop for Transport {
    fn drop(&mut self) {
        self.cancel.cancel();
    }
}
