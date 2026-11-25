//! Native encrypted voice lane used by the desktop's byte transport.
use crate::{crypt::Crypt, proto::udp, voice};
use anyhow::{Result, bail};
use prost::Message;
use serde_json::{Value, json};
use tokio::{
    net::UdpSocket,
    sync::mpsc,
    time::{Duration, Instant, interval},
};
use tokio_util::sync::CancellationToken;
/// What the lane reports. Voice stays bytes, so the desktop can hand it to the page without JSON.
pub enum Event {
    Voice(Vec<u8>),
    Json(Value),
}
pub enum Command {
    Setup(Vec<u8>, Vec<u8>, Vec<u8>, bool),
    Nonce(Vec<u8>),
    Send(Vec<u8>),
    ClientNonce(tokio::sync::oneshot::Sender<Option<Vec<u8>>>),
}
fn transient(e: &std::io::Error) -> bool {
    use std::io::ErrorKind::*;
    matches!(
        e.kind(),
        ConnectionRefused
            | ConnectionReset
            | ConnectionAborted
            | HostUnreachable
            | NetworkUnreachable
    )
}
/// Runs the lane until cancelled. If it fails, the frontend is told UDP is down so voice
/// falls back to the TCP tunnel instead of going silent.
pub async fn run(
    peer: std::net::SocketAddr,
    commands: mpsc::Receiver<Command>,
    events: mpsc::Sender<Event>,
    cancel: CancellationToken,
) -> Result<()> {
    let result = lane(peer, commands, events.clone(), cancel).await;
    if let Err(e) = &result {
        eprintln!("mumh5: UDP voice lane ended: {e:#}");
        let _ = events.try_send(Event::Json(json!({"event":"udpState","args":[false,0]})));
    }
    result
}
async fn lane(
    peer: std::net::SocketAddr,
    mut commands: mpsc::Receiver<Command>,
    events: mpsc::Sender<Event>,
    cancel: CancellationToken,
) -> Result<()> {
    let socket = UdpSocket::bind(if peer.is_ipv4() {
        "0.0.0.0:0"
    } else {
        "[::]:0"
    })
    .await?;
    socket.connect(peer).await?;
    let mut crypt: Option<Crypt> = None;
    let mut protobuf = false;
    let mut last_pong: Option<Instant> = None;
    let mut last_probe = Instant::now();
    let mut ticker = interval(Duration::from_secs(2));
    let mut buffer = vec![0; 65536];
    let mut failures = 0u32;
    let mut last_resync = Instant::now();
    loop {
        tokio::select! {
        _=cancel.cancelled()=>break,
        command=commands.recv()=>match command{
        Some(Command::Setup(k,c,s,p))=>{crypt=Some(Crypt::new(&k,&c,&s).ok_or_else(||anyhow::anyhow!("Invalid UDP key or nonce"))?);protobuf=p;last_pong=None;},
        Some(Command::Nonce(n))=>{if n.len()!=16{bail!("Invalid server nonce");}
        if let Some(c)=&mut crypt{c.resync(&n);}},
        Some(Command::Send(p))=>{if p.len()>65500{bail!("Voice packet too large");}
        if let Some(c)=&mut crypt{let _=socket.send(&c.encode(&p)).await;}},
        Some(Command::ClientNonce(reply))=>{let _=reply.send(crypt.as_ref().map(|c|c.send_iv.to_vec()));},None=>break},
        _=ticker.tick(),if crypt.is_some()=>{
        let mut ping=vec![if protobuf{1}else{1<<5}];if protobuf{udp::Ping{timestamp:crate::client::now(),..Default::default()}.encode(&mut ping)?;}else{voice::write_varint(&mut ping,crate::client::now());}
        last_probe=Instant::now();let _=socket.send(&crypt.as_mut().unwrap().encode(&ping)).await;
        let _=events.try_send(Event::Json(json!({"event":"udpState","args":[last_pong.is_some_and(|t|t.elapsed()<Duration::from_secs(8)),0]})));},
        n=socket.recv(&mut buffer)=>{let n=match n{Ok(n)=>n,
        // An ICMP error for an earlier datagram (server restarting, NAT rebinding) is reported on
        // the next receive; the lane stays usable, as in the client's own UDP path.
        Err(e) if transient(&e)=>continue,Err(e)=>return Err(e.into())};if let Some(p)=crypt.as_mut().and_then(|c|c.decode(&buffer[..n])){failures=0;let is_ping=if protobuf{p.first()==Some(&1)}else{p.first().is_some_and(|b|b>>5==1)};
        if is_ping{last_pong=Some(Instant::now());let _=events.try_send(Event::Json(json!({"event":"udpState","args":[true,last_probe.elapsed().as_secs_f64()*1000.0]})));}else{let _=events.try_send(Event::Voice(p));}}
        else if crypt.is_some(){failures+=1;if failures>8&&last_resync.elapsed()>Duration::from_secs(5){last_resync=Instant::now();let _=events.try_send(Event::Json(json!({"event":"udpResync","args":[]})));}}}
        }
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn icmp_errors_do_not_end_the_lane() {
        // A port with nothing listening: sends there come back as ECONNREFUSED on Linux.
        let closed = std::net::UdpSocket::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap();
        let (tx, rx) = mpsc::channel(8);
        let (events, _events_rx) = mpsc::channel(64);
        let cancel = CancellationToken::new();
        let task = tokio::spawn(run(closed, rx, events, cancel.clone()));
        tx.send(Command::Setup(vec![1; 16], vec![2; 16], vec![3; 16], true))
            .await
            .unwrap();
        for _ in 0..5 {
            tx.send(Command::Send(vec![0x80, 1, 2, 3])).await.unwrap();
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        assert!(!task.is_finished(), "lane ended after an ICMP error");
        cancel.cancel();
        assert!(task.await.unwrap().is_ok());
    }
}
