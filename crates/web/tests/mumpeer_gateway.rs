//! The gateway keeps a mumpeer link for a browser and serves its lane on the public relay.
//! Needs a disposable Mumble server, like the core live tests:
//!   MUMH5_TEST_HOST=127.0.0.1 MUMH5_TEST_PORT=64750 cargo test -p mumh5-web --test mumpeer_gateway
use anyhow::{Context, Result, bail};
use futures_util::{SinkExt, StreamExt};
use openssl::{
    hash::MessageDigest,
    pkey::PKey,
    ssl::{AlpnError, Ssl, SslAcceptor, SslMethod, SslVerifyMode, select_next_proto},
    x509::X509,
};
use serde_json::{Value, json};
use std::{pin::Pin, process::Stdio, sync::Arc, time::Duration};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    net::{TcpListener, UdpSocket},
    sync::mpsc,
};
use tokio_openssl::SslStream;
use tokio_tungstenite::tungstenite::Message;
use turn::client::{Client, ClientConfig};
use webrtc_util::Conn;

fn packet(kind: u8, b: &[u8]) -> Vec<u8> {
    let mut p = vec![kind, (b.len() >> 8) as u8, b.len() as u8];
    p.extend_from_slice(b);
    p
}

/// A relay that accepts one bind, forwards lane frames to the test and can send its own.
async fn fake_relay() -> Result<(u16, String, mpsc::Receiver<Vec<u8>>, mpsc::Sender<Vec<u8>>)> {
    let id = mumh5_core::identity::generate("gateway-test-relay", "")?;
    let cert = X509::from_pem(id.cert_pem.as_bytes())?;
    let fp = hex(&cert.digest(MessageDigest::sha256())?);
    let mut acceptor = SslAcceptor::mozilla_modern_v5(SslMethod::tls_server())?;
    acceptor.set_certificate(&cert)?;
    let key = PKey::private_key_from_pem(id.key_pem.as_bytes())?;
    acceptor.set_private_key(&key)?;
    acceptor.set_verify(SslVerifyMode::NONE);
    acceptor.set_alpn_select_callback(|_, client| {
        select_next_proto(b"\x09mumpeer/1", client).ok_or(AlpnError::NOACK)
    });
    let acceptor = acceptor.build();
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let port = listener.local_addr()?.port();
    let (seen_tx, seen) = mpsc::channel(16);
    let (send, mut outgoing) = mpsc::channel::<Vec<u8>>(16);
    tokio::spawn(async move {
        let (tcp, _) = listener.accept().await.unwrap();
        let mut tls = SslStream::new(Ssl::new(acceptor.context()).unwrap(), tcp).unwrap();
        Pin::new(&mut tls).accept().await.unwrap();
        loop {
            let mut head = [0; 3];
            tokio::select! {
                r = tls.read_exact(&mut head) => {
                    if r.is_err() { break; }
                    let mut body = vec![0; u16::from_be_bytes([head[1], head[2]]) as usize];
                    tls.read_exact(&mut body).await.unwrap();
                    if head[0] == 0 {
                        let bind: Value = serde_json::from_slice(&body).unwrap();
                        assert_eq!(bind["t"], "bind");
                        tls.write_all(&packet(0, br#"{"v":1,"t":"ready"}"#)).await.unwrap();
                    } else {
                        let _ = seen_tx.send(body).await;
                    }
                }
                out = outgoing.recv() => match out {
                    Some(frame) => tls.write_all(&packet(1, &frame)).await.unwrap(),
                    None => { let _ = tls.shutdown().await; break; }
                }
            }
        }
    });
    Ok((port, fp, seen, send))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn free_udp_port() -> Result<u16> {
    Ok(std::net::UdpSocket::bind("127.0.0.1:0")?
        .local_addr()?
        .port())
}

type Ws =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

async fn next_json(ws: &mut Ws) -> Result<Value> {
    loop {
        match tokio::time::timeout(Duration::from_secs(15), ws.next())
            .await?
            .context("closed")??
        {
            Message::Text(t) => return Ok(serde_json::from_str(&t)?),
            Message::Close(_) => bail!("WebSocket closed"),
            _ => {}
        }
    }
}

async fn call(ws: &mut Ws, n: u64, mut msg: Value) -> Result<Value> {
    msg["n"] = json!(n);
    ws.send(Message::Text(msg.to_string().into())).await?;
    loop {
        let v = next_json(ws).await?;
        if v["n"] == n {
            return Ok(v);
        }
    }
}

#[tokio::test]
async fn gateway_keeps_mumpeer_links_for_browsers() -> Result<()> {
    let (Ok(host), Ok(port)) = (
        std::env::var("MUMH5_TEST_HOST"),
        std::env::var("MUMH5_TEST_PORT"),
    ) else {
        eprintln!("skipped: set MUMH5_TEST_HOST and MUMH5_TEST_PORT");
        return Ok(());
    };
    let (relay_port, fp, mut seen, relay_send) = fake_relay().await?;
    let stun = free_udp_port()?;
    let assets = std::env::temp_dir().join(format!("mumh5-gw-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&assets)?;
    let mut gateway = tokio::process::Command::new(env!("CARGO_BIN_EXE_mumh5-web"))
        .env_clear()
        .env("MUMH5_PORT", "0")
        .env("MUMH5_SERVERS", format!("{host}:{port}"))
        .env("MUMH5_STUN_PORT", stun.to_string())
        .env("MUMH5_STUN_BIND", "127.0.0.1")
        .env("MUMH5_TURN_PORTS", "0-0")
        .env("MUMH5_MUMPEER_PORTS", relay_port.to_string())
        .env("MUMH5_STATIC", &assets)
        .stdout(Stdio::piped())
        .kill_on_drop(true)
        .spawn()?;
    let mut lines = BufReader::new(gateway.stdout.take().context("stdout")?).lines();
    let line = tokio::time::timeout(Duration::from_secs(10), lines.next_line())
        .await??
        .context("no banner")?;
    let base = line
        .trim_start_matches("mumh5: ")
        .trim_end_matches('/')
        .replace("http://", "");

    let config: Value = reqwest::get(format!("http://{base}/api/config"))
        .await?
        .json()
        .await?;
    assert_eq!(config["mumpeer"], true, "{config}");

    let (mut ws, _) = tokio_tungstenite::connect_async(format!("ws://{base}/api/connect")).await?;
    let identity = mumh5_core::identity::generate("gateway-mumpeer-test", "")?;
    ws.send(Message::Text(json!({"host":host,"port":port.parse::<u16>()?,"certPem":identity.cert_pem,"keyPem":identity.key_pem}).to_string().into())).await?;
    assert_eq!(next_json(&mut ws).await?["type"], "secure");

    let rid = "0123456789abcdef";
    let token = "t".repeat(43);
    let wrong_port = call(&mut ws, 1, json!({"type":"relay-open","rid":rid,"address":{"host":host,"tcp":1,"fp":fp},"token":token,"lowSide":true})).await?;
    assert_eq!(wrong_port["type"], "relay-fail");
    assert_eq!(
        wrong_port["reason"],
        "This proxy does not allow that relay port"
    );
    let unknown = call(&mut ws, 2, json!({"type":"relay-turn","rid":rid,"lane":0})).await?;
    assert_eq!(unknown["reason"], "The mumpeer link is unavailable");

    let opened = call(&mut ws, 3, json!({"type":"relay-open","rid":rid,"address":{"host":host,"tcp":relay_port,"fp":fp},"token":token,"lowSide":true})).await?;
    assert_eq!(opened["type"], "relay-ok", "{opened}");
    let again = call(&mut ws, 4, json!({"type":"relay-open","rid":rid,"address":{"host":host,"tcp":relay_port,"fp":fp},"token":token,"lowSide":true})).await?;
    assert_eq!(again["reason"], "That mumpeer connection is already open");
    let lane = call(&mut ws, 5, json!({"type":"relay-turn","rid":rid,"lane":0})).await?;
    assert_eq!(lane["type"], "relay-ok", "{lane}");
    let ice = &lane["result"];
    assert_eq!(ice["port"], stun);

    let conn: Arc<dyn Conn + Send + Sync> = Arc::new(UdpSocket::bind("127.0.0.1:0").await?);
    let server = format!("127.0.0.1:{stun}");
    let client = Client::new(ClientConfig {
        stun_serv_addr: server.clone(),
        turn_serv_addr: server,
        username: ice["username"].as_str().context("username")?.into(),
        password: ice["credential"].as_str().context("credential")?.into(),
        realm: "mumh5".into(),
        software: "mumh5-test".into(),
        rto_in_ms: 100,
        conn,
        vnet: None,
    })
    .await?;
    client.listen().await?;
    let allocation = client.allocate().await?;
    let low: std::net::SocketAddr = "192.0.2.1:40000".parse()?;
    let high: std::net::SocketAddr = "192.0.2.2:40000".parse()?;
    assert_eq!(allocation.local_addr()?, low);
    allocation.send_to(b"media-out", high).await?;
    let frame = tokio::time::timeout(Duration::from_secs(5), seen.recv())
        .await?
        .context("no lane frame")?;
    assert_eq!(frame, [&[0u8][..], b"media-out"].concat());
    relay_send.send([&[0u8][..], b"media-in"].concat()).await?;
    let mut buffer = [0; 2048];
    let (n, from) =
        tokio::time::timeout(Duration::from_secs(5), allocation.recv_from(&mut buffer)).await??;
    assert_eq!((&buffer[..n], from), (&b"media-in"[..], high));

    // The relay going away is reported for a link that was ready.
    drop(relay_send);
    let closed = next_json(&mut ws).await?;
    assert_eq!(
        (closed["type"].as_str(), closed["rid"].as_str()),
        (Some("relay-closed"), Some(rid)),
        "{closed}"
    );
    let gone = call(&mut ws, 6, json!({"type":"relay-turn","rid":rid,"lane":0})).await?;
    assert_eq!(gone["reason"], "The mumpeer link is unavailable");

    allocation.close().await?;
    client.close().await?;
    let _ = gateway.kill().await;
    let _ = std::fs::remove_dir_all(assets);
    Ok(())
}
