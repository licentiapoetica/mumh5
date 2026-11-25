//! WebRTC transport for Linux WebViews that provide capture and codecs but lack peer connections.
//! Signaling, channel membership, and the sharing route are still managed by the UI.
use anyhow::{Context, Result, bail};
use serde::Deserialize;
use serde_json::Value;
use std::{
    collections::HashMap,
    sync::{Arc, LazyLock, Mutex, Weak},
    time::{Duration, Instant},
};
use tauri::{
    State, Webview,
    ipc::{InvokeBody, JavaScriptChannelId, Request, Response},
};
use tokio::sync::{Mutex as AsyncMutex, mpsc};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;
use webrtc::{
    api::{
        API, APIBuilder,
        interceptor_registry::register_default_interceptors,
        media_engine::{MIME_TYPE_OPUS, MIME_TYPE_VP8, MediaEngine},
    },
    ice_transport::ice_server::RTCIceServer,
    interceptor::registry::Registry,
    media::{Sample, io::sample_builder::SampleBuilder},
    peer_connection::{
        RTCPeerConnection, configuration::RTCConfiguration,
        policy::ice_transport_policy::RTCIceTransportPolicy,
        sdp::session_description::RTCSessionDescription,
    },
    rtcp::payload_feedbacks::{
        full_intra_request::FullIntraRequest, picture_loss_indication::PictureLossIndication,
    },
    rtp::{
        codecs::{opus::OpusPacket, vp8::Vp8Packet},
        packetizer::Depacketizer,
    },
    rtp_transceiver::{
        RTCPFeedback,
        rtp_codec::{RTCRtpCodecCapability, RTCRtpCodecParameters, RTPCodecType},
    },
    track::{
        track_local::track_local_static_sample::TrackLocalStaticSample, track_remote::TrackRemote,
    },
};

const MAX_SAMPLE: usize = 2 * 1024 * 1024;
const SAMPLE_HEADER: usize = 5;
const VIDEO: u8 = 0;
const AUDIO: u8 = 1;

#[derive(Default)]
pub(crate) struct Peers(Mutex<HashMap<Uuid, Arc<Peer>>>);

struct Peer {
    connection: Arc<RTCPeerConnection>,
    source: Option<Uuid>,
    video: Option<Arc<TrackLocalStaticSample>>,
    audio: Option<Arc<TrackLocalStaticSample>>,
    incoming: AsyncMutex<mpsc::Receiver<Vec<u8>>>,
    cancel: CancellationToken,
}

fn video_codec() -> RTCRtpCodecCapability {
    RTCRtpCodecCapability {
        mime_type: MIME_TYPE_VP8.into(),
        clock_rate: 90000,
        rtcp_feedback: vec![
            RTCPFeedback {
                typ: "nack".into(),
                parameter: String::new(),
            },
            RTCPFeedback {
                typ: "nack".into(),
                parameter: "pli".into(),
            },
        ],
        ..Default::default()
    }
}

fn audio_codec() -> RTCRtpCodecCapability {
    RTCRtpCodecCapability {
        mime_type: MIME_TYPE_OPUS.into(),
        clock_rate: 48000,
        channels: 2,
        sdp_fmtp_line: "minptime=10;useinbandfec=1;stereo=1;sprop-stereo=1".into(),
        ..Default::default()
    }
}

static API: LazyLock<Result<API>> = LazyLock::new(|| {
    let mut engine = MediaEngine::default();
    for (capability, payload_type, kind) in [
        (video_codec(), 96, RTPCodecType::Video),
        (audio_codec(), 111, RTPCodecType::Audio),
    ] {
        engine.register_codec(
            RTCRtpCodecParameters {
                capability,
                payload_type,
                ..Default::default()
            },
            kind,
        )?;
    }
    let registry = register_default_interceptors(Registry::new(), &mut engine)?;
    Ok(APIBuilder::new()
        .with_media_engine(engine)
        .with_interceptor_registry(registry)
        .build())
});

impl Peer {
    async fn open(
        config: RTCConfiguration,
        source: Option<Uuid>,
        audio: bool,
        notify: impl Fn(String) + Clone + Send + Sync + 'static,
    ) -> Result<Arc<Self>> {
        let api = API.as_ref().map_err(|err| anyhow::anyhow!("{err}"))?;
        let connection = Arc::new(api.new_peer_connection(config).await?);
        let cancel = CancellationToken::new();
        let (send, incoming) = mpsc::channel(12);
        let on_state = notify.clone();
        connection.on_peer_connection_state_change(Box::new(move |state| {
            let on_state = on_state.clone();
            Box::pin(async move { on_state(state.to_string()) })
        }));

        let mut peer = Self {
            connection,
            source,
            video: None,
            audio: None,
            incoming: AsyncMutex::new(incoming),
            cancel,
        };
        if source.is_some() {
            let configured = async {
                peer.video = Some(
                    peer.add_track(video_codec(), "video", notify.clone())
                        .await?,
                );
                if audio {
                    peer.audio = Some(peer.add_track(audio_codec(), "audio", notify).await?);
                }
                Ok::<_, anyhow::Error>(())
            }
            .await;
            if let Err(error) = configured {
                peer.close().await;
                return Err(error);
            }
        } else {
            let connection = Arc::downgrade(&peer.connection);
            let cancel = peer.cancel.clone();
            peer.connection.on_track(Box::new(move |track, _, _| {
                let connection = connection.clone();
                let cancel = cancel.clone();
                let send = send.clone();
                Box::pin(async move {
                    if track
                        .codec()
                        .capability
                        .mime_type
                        .eq_ignore_ascii_case(MIME_TYPE_VP8)
                    {
                        tokio::spawn(read_samples(
                            track,
                            Vp8Packet::default(),
                            VIDEO,
                            connection,
                            send,
                            cancel,
                        ));
                    } else if track
                        .codec()
                        .capability
                        .mime_type
                        .eq_ignore_ascii_case(MIME_TYPE_OPUS)
                    {
                        tokio::spawn(read_samples(
                            track, OpusPacket, AUDIO, connection, send, cancel,
                        ));
                    }
                })
            }));
        }
        Ok(Arc::new(peer))
    }

    async fn add_track(
        &self,
        codec: RTCRtpCodecCapability,
        name: &'static str,
        notify: impl Fn(String) + Send + Sync + 'static,
    ) -> Result<Arc<TrackLocalStaticSample>> {
        let track = Arc::new(TrackLocalStaticSample::new(
            codec,
            name.into(),
            "mumh5-share".into(),
        ));
        let sender = self.connection.add_track(track.clone()).await?;
        let cancel = self.cancel.clone();
        tokio::spawn(async move {
            loop {
                let packets = tokio::select! {
                    _ = cancel.cancelled() => break,
                    result = sender.read_rtcp() => match result {
                        Ok((packets, _)) => packets,
                        Err(_) => break,
                    },
                };
                if name == "video"
                    && packets.iter().any(|packet| {
                        let any = packet.as_any();
                        any.is::<PictureLossIndication>() || any.is::<FullIntraRequest>()
                    })
                {
                    notify("keyframe".into());
                }
            }
        });
        Ok(track)
    }

    async fn local_sdp(&self, offer: Option<String>) -> Result<String> {
        let mut gathered = self.connection.gathering_complete_promise().await;
        let local = if let Some(offer) = offer {
            self.connection
                .set_remote_description(RTCSessionDescription::offer(offer)?)
                .await?;
            self.connection.create_answer(None).await?
        } else {
            self.connection.create_offer(None).await?
        };
        self.connection.set_local_description(local).await?;
        let _ = tokio::time::timeout(Duration::from_secs(3), gathered.recv()).await;
        Ok(self
            .connection
            .local_description()
            .await
            .context("No local share description")?
            .sdp)
    }

    async fn close(&self) {
        self.cancel.cancel();
        let _ = self.connection.close().await;
    }
}

async fn read_samples<T: Depacketizer + Send + 'static>(
    track: Arc<TrackRemote>,
    depacketizer: T,
    kind: u8,
    connection: Weak<RTCPeerConnection>,
    send: mpsc::Sender<Vec<u8>>,
    cancel: CancellationToken,
) {
    let clock_rate = if kind == VIDEO { 90000 } else { 48000 };
    let mut samples = SampleBuilder::new(48, depacketizer, clock_rate)
        .with_max_time_delay(Duration::from_millis(120));
    let mut key_needed = kind == VIDEO;
    let mut last_request: Option<Instant> = None;
    loop {
        let packet = tokio::select! {
            _ = cancel.cancelled() => break,
            result = track.read_rtp() => match result {
                Ok((packet, _)) => packet,
                Err(_) => break,
            },
        };
        samples.push(packet);
        while let Some(sample) = samples.pop() {
            if sample.data.is_empty() || sample.data.len() > MAX_SAMPLE {
                continue;
            }
            if kind == VIDEO && sample.prev_dropped_packets > sample.prev_padding_packets {
                key_needed = true;
            }
            if key_needed && sample.data[0] & 1 != 0 {
                continue;
            }
            let duration = sample.duration.as_micros().clamp(1, 250_000) as u32;
            let mut bytes = Vec::with_capacity(SAMPLE_HEADER + sample.data.len());
            bytes.push(kind);
            bytes.extend_from_slice(&duration.to_le_bytes());
            bytes.extend_from_slice(&sample.data);
            key_needed = send.try_send(bytes).is_err() && kind == VIDEO;
        }
        if key_needed && last_request.is_none_or(|at| at.elapsed() >= Duration::from_secs(1)) {
            let Some(peer) = connection.upgrade() else {
                break;
            };
            let _ = peer
                .write_rtcp(&[Box::new(PictureLossIndication {
                    sender_ssrc: 0,
                    media_ssrc: track.ssrc(),
                })])
                .await;
            last_request = Some(Instant::now());
        }
    }
}

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub(crate) enum Operation {
    Open {
        ice_servers: Vec<RTCIceServer>,
        relay_only: bool,
        source: Option<Uuid>,
        audio: bool,
        events: JavaScriptChannelId,
    },
    Offer,
    Answer {
        sdp: String,
    },
    Accept {
        sdp: String,
    },
    Stats,
    Close,
}

impl Peers {
    fn get(&self, id: Uuid) -> Result<Arc<Peer>> {
        self.0
            .lock()
            .map_err(|_| anyhow::anyhow!("Share connection lock poisoned"))?
            .get(&id)
            .cloned()
            .context("Share connection has closed")
    }

    async fn call(&self, id: Uuid, operation: Operation, webview: Webview) -> Result<Value> {
        match operation {
            Operation::Open {
                ice_servers,
                relay_only,
                source,
                audio,
                events,
            } => {
                let config = RTCConfiguration {
                    ice_servers,
                    ice_transport_policy: if relay_only {
                        RTCIceTransportPolicy::Relay
                    } else {
                        RTCIceTransportPolicy::All
                    },
                    ..Default::default()
                };
                let events = events.channel_on(webview);
                // WebRTC calls this from inside its own connection tasks: delivering to the
                // WebView there can wait for the UI thread and stall the handshake, so events
                // are queued and delivered by a task of their own, in order.
                let (queue, mut queued) = mpsc::unbounded_channel::<String>();
                tokio::spawn(async move {
                    while let Some(event) = queued.recv().await {
                        let events = events.clone();
                        if tokio::task::spawn_blocking(move || events.send(event))
                            .await
                            .is_err()
                        {
                            break;
                        }
                    }
                });
                let peer = Peer::open(config, source, audio, move |event| {
                    let _ = queue.send(event);
                })
                .await?;
                let inserted = {
                    let mut peers = self
                        .0
                        .lock()
                        .map_err(|_| anyhow::anyhow!("Share connection lock poisoned"))?;
                    if peers.len() >= 24 || peers.contains_key(&id) {
                        false
                    } else {
                        peers.insert(id, peer.clone());
                        true
                    }
                };
                if !inserted {
                    peer.close().await;
                    bail!("Too many share connections");
                }
                Ok(Value::Null)
            }
            Operation::Offer => Ok(self.get(id)?.local_sdp(None).await?.into()),
            Operation::Answer { sdp } => Ok(self.get(id)?.local_sdp(Some(sdp)).await?.into()),
            Operation::Accept { sdp } => {
                self.get(id)?
                    .connection
                    .set_remote_description(RTCSessionDescription::answer(sdp)?)
                    .await?;
                Ok(Value::Null)
            }
            Operation::Stats => Ok(serde_json::to_value(
                self.get(id)?.connection.get_stats().await,
            )?),
            Operation::Close => {
                let peer = self
                    .0
                    .lock()
                    .map_err(|_| anyhow::anyhow!("Share connection lock poisoned"))?
                    .remove(&id);
                if let Some(peer) = peer {
                    peer.close().await;
                }
                Ok(Value::Null)
            }
        }
    }

    async fn send(&self, source: Uuid, bytes: &[u8]) -> Result<()> {
        if bytes.len() <= SAMPLE_HEADER
            || bytes.len() > MAX_SAMPLE + SAMPLE_HEADER
            || bytes[0] > AUDIO
        {
            bail!("Invalid share sample");
        }
        let video = bytes[0] == VIDEO;
        let duration = u32::from_le_bytes(bytes[1..SAMPLE_HEADER].try_into()?);
        if !(1..=250_000).contains(&duration) {
            bail!("Invalid share sample duration");
        }
        let tracks = self
            .0
            .lock()
            .map_err(|_| anyhow::anyhow!("Share connection lock poisoned"))?
            .values()
            .filter(|peer| peer.source == Some(source))
            .filter_map(|peer| {
                if video {
                    peer.video.clone()
                } else {
                    peer.audio.clone()
                }
            })
            .collect::<Vec<_>>();
        let sample = Sample {
            data: bytes[SAMPLE_HEADER..].to_vec().into(),
            duration: Duration::from_micros(duration.into()),
            ..Default::default()
        };
        for track in tracks {
            // One viewer leaving must not interrupt another.
            let _ = track.write_sample(&sample).await;
        }
        Ok(())
    }
}

fn main_window(webview: &Webview) -> std::result::Result<(), String> {
    if webview.label() == "main" {
        Ok(())
    } else {
        Err("Sharing is only available in the main window".into())
    }
}

#[tauri::command]
pub(crate) async fn share_peer(
    webview: Webview,
    peers: State<'_, Peers>,
    id: Uuid,
    operation: Operation,
) -> std::result::Result<Value, String> {
    main_window(&webview)?;
    peers
        .call(id, operation, webview)
        .await
        .map_err(super::failure)
}

#[tauri::command]
pub(crate) async fn share_sample(
    webview: Webview,
    peers: State<'_, Peers>,
    request: Request<'_>,
) -> std::result::Result<(), String> {
    main_window(&webview)?;
    let source = request
        .headers()
        .get("mumh5-share")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| Uuid::parse_str(v).ok())
        .ok_or("Missing share source")?;
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("Expected raw bytes".into());
    };
    peers.send(source, bytes).await.map_err(super::failure)
}

#[tauri::command]
pub(crate) async fn share_receive(
    webview: Webview,
    peers: State<'_, Peers>,
    id: Uuid,
) -> std::result::Result<Response, String> {
    main_window(&webview)?;
    let peer = peers.get(id).map_err(super::failure)?;
    let mut incoming = peer
        .incoming
        .try_lock()
        .map_err(|_| "A share read is pending")?;
    let bytes = tokio::select! {
        _ = peer.cancel.cancelled() => Vec::new(),
        bytes = incoming.recv() => bytes.unwrap_or_default(),
    };
    Ok(Response::new(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    use mumh5_platform::turn::{Options, TurnServer, VirtualBridge};
    use tokio::sync::broadcast;

    /// Offer, answer, connect, and a video sample from the sharer arrives at the viewer.
    async fn carry_video(sharer_config: RTCConfiguration, viewer_config: RTCConfiguration) {
        let states = Arc::new(Mutex::new(Vec::<String>::new()));
        let log = |side: &'static str| {
            let states = states.clone();
            move |event: String| states.lock().unwrap().push(format!("{side}:{event}"))
        };
        let source = Some(Uuid::new_v4());
        let sharer = Peer::open(sharer_config, source, false, log("sharer"))
            .await
            .unwrap();
        let viewer = Peer::open(viewer_config, None, false, log("viewer"))
            .await
            .unwrap();
        let offer = sharer.local_sdp(None).await.unwrap();
        let answer = viewer.local_sdp(Some(offer.clone())).await.unwrap();
        sharer
            .connection
            .set_remote_description(RTCSessionDescription::answer(answer.clone()).unwrap())
            .await
            .unwrap();
        // A VP8 keyframe (bit 0 of the first byte clear) of filler, sent repeatedly
        let mut frame = vec![0x10u8, 0x02, 0x00, 0x9d, 0x01, 0x2a];
        frame.resize(1200, 0x55);
        let video = sharer.video.clone().unwrap();
        let mut got = None;
        for _ in 0..200 {
            let _ = video
                .write_sample(&Sample {
                    data: frame.clone().into(),
                    duration: Duration::from_millis(33),
                    ..Default::default()
                })
                .await;
            if let Ok(mut incoming) = viewer.incoming.try_lock()
                && let Ok(Ok(Some(bytes))) =
                    tokio::time::timeout(Duration::from_millis(50), incoming.recv())
                        .await
                        .map(Ok::<_, ()>)
            {
                got = Some(bytes);
                break;
            }
        }
        let states = states.lock().unwrap().clone();
        let candidates = |sdp: &str| {
            sdp.lines()
                .filter(|l| l.starts_with("a=candidate"))
                .map(str::to_owned)
                .collect::<Vec<_>>()
        };
        assert!(
            got.is_some(),
            "no sample arrived; states {states:?}\noffer candidates: {:?}\nanswer candidates: {:?}",
            candidates(&offer),
            candidates(&answer)
        );
        assert_eq!(got.unwrap()[0], VIDEO);
        sharer.close().await;
        viewer.close().await;
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn native_peers_connect_and_carry_video() {
        carry_video(RTCConfiguration::default(), RTCConfiguration::default()).await;
    }

    /// The mumpeer route as the Linux app uses it: each side relay-only through its own
    /// loopback TURN server, whose allocation is a virtual address bridged to the other side
    /// (in the app over the pinned TLS link to the other client, here directly).
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn native_peers_connect_through_mumpeer_lanes() {
        let (low_out, mut low_rx) = mpsc::channel::<Vec<u8>>(64);
        let (high_out, mut high_rx) = mpsc::channel::<Vec<u8>>(64);
        let (low_in, _) = broadcast::channel(64);
        let (high_in, _) = broadcast::channel(64);
        let cancel = CancellationToken::new();
        let (to_high, to_low, stop) = (high_in.clone(), low_in.clone(), cancel.clone());
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = stop.cancelled() => break,
                    Some(p) = low_rx.recv() => { let _ = to_high.send(p); }
                    Some(p) = high_rx.recv() => { let _ = to_low.send(p); }
                }
            }
        });
        let low = "192.0.2.1:40000".parse().unwrap();
        let high = "192.0.2.2:40000".parse().unwrap();
        let options = Options {
            bind: "127.0.0.1:0".parse().unwrap(),
            max_allocations: 1,
            max_per_address: 1,
            ..Default::default()
        };
        let mut servers = Vec::new();
        let mut configs = Vec::new();
        for (local, remote, outgoing, incoming) in
            [(low, high, low_out, low_in), (high, low, high_out, high_in)]
        {
            let bridge = VirtualBridge {
                local,
                remote,
                outgoing,
                incoming,
                cancel: cancel.clone(),
            };
            let server = TurnServer::start(options.clone(), Some(bridge))
                .await
                .unwrap();
            let (username, credential) = server.credentials().unwrap();
            // What mumpeer hands the page on Linux: UDP first, TCP for WebViews that prefer it
            configs.push(RTCConfiguration {
                ice_servers: vec![RTCIceServer {
                    urls: vec![
                        format!("turn:127.0.0.1:{}?transport=udp", server.port),
                        format!("turn:127.0.0.1:{}?transport=tcp", server.port),
                    ],
                    username,
                    credential,
                }],
                ice_transport_policy: RTCIceTransportPolicy::Relay,
                ..Default::default()
            });
            servers.push(server);
        }
        let viewer = configs.pop().unwrap();
        let sharer = configs.pop().unwrap();
        tokio::time::timeout(Duration::from_secs(30), carry_video(sharer, viewer))
            .await
            .expect("timed out");
        cancel.cancel();
        for mut server in servers {
            server.close().await;
        }
    }
}
