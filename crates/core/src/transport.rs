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

/// Largest single write the transports accept; Mumble frames are far smaller.
pub const MAX_WRITE: usize = 8 * 1024 * 1024;
/// TLS records carry at most 16 KiB, so a larger read buffer never gets more per read.
pub const READ_BUFFER: usize = 16 * 1024;
/// The error for an orderly close by the server, which the UI shows as the reason.
pub fn closed_by_server() -> anyhow::Error {
    anyhow::anyhow!("Mumble server closed the TLS connection")
}

/// A handshaked TLS stream, for callers that pump it on their own task (the gateway).
pub struct Link {
    pub stream: SslStream<TcpStream>,
    pub secure: Value,
    pub peer: std::net::SocketAddr,
}

pub struct Transport {
    pub secure: Value,
    pub peer: std::net::SocketAddr,
    pub send: mpsc::Sender<Vec<u8>>,
    pub receive: mpsc::Receiver<Result<Vec<u8>>>,
    pub cancel: CancellationToken,
}
impl Transport {
    pub async fn connect(host: &str, port: u16, identity: &Identity) -> Result<Self> {
        Self::connect_to(host, port, identity, None, None).await
    }
    /// Connect to an already resolved/authorized address, optionally announcing the browser via PROXY v1.
    pub async fn connect_to(
        host: &str,
        port: u16,
        identity: &Identity,
        address: Option<std::net::SocketAddr>,
        proxy_client: Option<std::net::SocketAddr>,
    ) -> Result<Self> {
        let Link {
            stream,
            secure,
            peer,
        } = Link::open(host, port, identity, address, proxy_client).await?;
        let (send, mut outgoing) = mpsc::channel::<Vec<u8>>(32);
        let (incoming, receive) = mpsc::channel(16);
        let cancel = CancellationToken::new();
        let stop = cancel.clone();
        tokio::spawn(async move {
            let (mut reader, mut writer) = tokio::io::split(stream);
            let read = async {
                let mut buffer = vec![0; READ_BUFFER];
                loop {
                    let n = reader
                        .read(&mut buffer)
                        .await
                        .context("Reading Mumble TLS stream")?;
                    if n == 0 {
                        return Err(closed_by_server());
                    }
                    if incoming.send(Ok(buffer[..n].to_vec())).await.is_err() {
                        break;
                    }
                }
                anyhow::Ok(())
            };
            let write = async {
                while let Some(bytes) = outgoing.recv().await {
                    if bytes.len() > MAX_WRITE {
                        bail!("Frame too large");
                    }
                    writer
                        .write_all(&bytes)
                        .await
                        .context("Writing Mumble TLS stream")?;
                }
                anyhow::Ok(())
            };
            let result = tokio::select! {_ = stop.cancelled()=>Ok(()), r=read=>r,r=write=>r};
            if let Err(e) = result {
                let _ = incoming.send(Err(e)).await;
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
impl Link {
    pub async fn open(
        host: &str,
        port: u16,
        identity: &Identity,
        address: Option<std::net::SocketAddr>,
        proxy_client: Option<std::net::SocketAddr>,
    ) -> Result<Self> {
        if host.is_empty() || host.len() > 253 || port == 0 {
            bail!("Invalid server address");
        }
        let mut tcp = if let Some(address) = address {
            timeout(Duration::from_secs(20), TcpStream::connect(address)).await??
        } else {
            timeout(Duration::from_secs(20), TcpStream::connect((host, port))).await??
        };
        tcp.set_nodelay(true)?;
        let peer = tcp.peer_addr()?;
        if let Some(client) = proxy_client {
            let line = if client.is_ipv4() == peer.is_ipv4() {
                format!(
                    "PROXY {} {} {} {} {}\r\n",
                    if client.is_ipv4() { "TCP4" } else { "TCP6" },
                    client.ip(),
                    peer.ip(),
                    client.port(),
                    peer.port()
                )
            } else {
                "PROXY UNKNOWN\r\n".into()
            };
            timeout(Duration::from_secs(5), tcp.write_all(line.as_bytes())).await??;
        }
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
        Ok(Self {
            stream: tls,
            secure,
            peer,
        })
    }
}
impl Drop for Transport {
    fn drop(&mut self) {
        self.cancel.cancel();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use openssl::{
        pkey::PKey,
        ssl::{Ssl, SslAcceptor, SslMethod},
        x509::X509,
    };
    use tokio::net::TcpListener;

    #[tokio::test]
    async fn tls_eof_keeps_received_bytes_and_reports_the_upstream_close() -> Result<()> {
        let identity = identity::generate("localhost", "")?;
        let mut acceptor = SslAcceptor::mozilla_intermediate(SslMethod::tls_server())?;
        let cert = X509::from_pem(identity.cert_pem.as_bytes())?;
        let key = PKey::private_key_from_pem(identity.key_pem.as_bytes())?;
        acceptor.set_certificate(&cert)?;
        acceptor.set_private_key(&key)?;
        let acceptor = acceptor.build();
        let listener = TcpListener::bind("127.0.0.1:0").await?;
        let port = listener.local_addr()?.port();
        let server = tokio::spawn(async move {
            let (tcp, _) = listener.accept().await?;
            let mut stream = SslStream::new(Ssl::new(acceptor.context())?, tcp)?;
            Pin::new(&mut stream).accept().await?;
            stream.write_all(b"server data before close").await?;
            stream.shutdown().await?;
            anyhow::Ok(())
        });
        let mut transport = Transport::connect("127.0.0.1", port, &identity).await?;
        let (received, reason) = timeout(Duration::from_secs(5), async {
            let mut received = Vec::new();
            while let Some(packet) = transport.receive.recv().await {
                match packet {
                    Ok(bytes) => received.extend(bytes),
                    Err(error) => return (received, format!("{error:#}")),
                }
            }
            (received, String::new())
        })
        .await?;
        assert_eq!(received, b"server data before close");
        assert!(
            reason.contains("Mumble server closed the TLS connection"),
            "{reason}"
        );
        server.await??;
        Ok(())
    }
}
