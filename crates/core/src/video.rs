use crate::client::{Inner, State};
use anyhow::{Result, bail};
use serde_json::Value;
use std::sync::{Arc, RwLock, Weak};
use tokio::sync::{mpsc, oneshot};
use tokio_util::sync::CancellationToken;
#[derive(Clone, Debug)]
pub struct VideoFrame {
    pub session: u32,
    pub width: u32,
    pub height: u32,
    pub data: Vec<u8>,
}
pub fn frame_bytes(width: u32, height: u32) -> Result<usize> {
    if width < 2
        || height < 2
        || !width.is_multiple_of(2)
        || !height.is_multiple_of(2)
        || width > 4096
        || height > 2160
    {
        bail!("I420 dimensions must be even integers, 2..4096 wide and 2..2160 high");
    }
    Ok(width as usize * height as usize * 3 / 2)
}
pub(crate) enum VideoCommand {
    Request(Value, oneshot::Sender<Result<Value>>),
    Signal(u32, Vec<u8>),
    UserChanged,
    Entered,
    Frame(Vec<u8>),
}
pub(crate) fn spawn(
    client: Weak<Inner>,
    state: Arc<RwLock<State>>,
    commands: mpsc::Receiver<VideoCommand>,
    frames: mpsc::Sender<VideoFrame>,
    events: mpsc::Sender<Value>,
    ice: Value,
    cancel: CancellationToken,
) {
    #[cfg(feature = "video")]
    tokio::spawn(native::run(
        client, state, commands, frames, events, ice, cancel,
    ));
    #[cfg(not(feature = "video"))]
    {
        let _ = (client, state, frames, events, ice);
        let mut commands = commands;
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = cancel.cancelled() => break,
                    command = commands.recv() => {
                        match command {
                            Some(VideoCommand::Request(command, reply)) => { drop(command); let _ = reply.send(Err(anyhow::anyhow!("Video was disabled at build time"))); },
                            Some(VideoCommand::Signal(sender, data)) => { let _ = (sender, data); },
                            Some(VideoCommand::Frame(data)) => { drop(data); },
                            None => break,
                            _ => {}
                        }
                    }
                }
            }
        });
    }
}
#[cfg(feature = "video")]
mod native {
    use super::*;
    use anyhow::Context;
    use base64::{Engine, engine::general_purpose::STANDARD};
    use bytes::Bytes;
    use serde_json::json;
    use std::{
        collections::{HashMap, HashSet},
        ffi::c_void,
        time::{Duration, Instant},
    };
    use tokio::time::{interval, timeout};
    use webrtc::{
        api::{
            API, APIBuilder,
            interceptor_registry::register_default_interceptors,
            media_engine::{MIME_TYPE_OPUS, MIME_TYPE_VP8, MediaEngine},
        },
        ice_transport::ice_server::RTCIceServer,
        interceptor::registry::Registry,
        media::Sample,
        peer_connection::{
            RTCPeerConnection, configuration::RTCConfiguration,
            sdp::session_description::RTCSessionDescription,
        },
        rtcp::payload_feedbacks::picture_loss_indication::PictureLossIndication,
        rtp::{codecs::vp8::Vp8Packet, packetizer::Depacketizer},
        rtp_transceiver::rtp_codec::{RTCRtpCodecCapability, RTCRtpCodecParameters, RTPCodecType},
        track::track_local::track_local_static_sample::TrackLocalStaticSample,
    };
    fn number(value: &Value, key: &str, default: u32) -> Result<u32> {
        if value[key].is_null() {
            return Ok(default);
        }
        u32::try_from(
            value[key]
                .as_u64()
                .with_context(|| format!("{key} must be a nonnegative integer"))?,
        )
        .with_context(|| format!("{key} is too large"))
    }
    unsafe extern "C" {
        fn mumh5_encoder_new(w: u32, h: u32, fps: u32) -> *mut c_void;
        fn mumh5_encode(
            ptr: *mut c_void,
            input: *const u8,
            len: usize,
            output: *mut u8,
            cap: usize,
        ) -> i32;
        fn mumh5_encoder_free(ptr: *mut c_void);
        fn mumh5_decoder_new() -> *mut c_void;
        fn mumh5_decode(
            ptr: *mut c_void,
            input: *const u8,
            len: usize,
            output: *mut u8,
            cap: usize,
            w: *mut u32,
            h: *mut u32,
        ) -> i32;
        fn mumh5_decoder_free(ptr: *mut c_void);
    }
    struct Encoder {
        ptr: *mut c_void,
        width: u32,
        height: u32,
        output: Vec<u8>,
    }
    // The pointer is owned here and accessed by one serialized video task only.
    unsafe impl Send for Encoder {}
    impl Drop for Encoder {
        fn drop(&mut self) {
            unsafe {
                mumh5_encoder_free(self.ptr);
            }
        }
    }
    impl Encoder {
        fn new(w: u32, h: u32, fps: u32) -> Result<Self> {
            let size = frame_bytes(w, h)?;
            let ptr = unsafe { mumh5_encoder_new(w, h, fps) };
            if ptr.is_null() {
                bail!("Could not initialize native VP8 encoder");
            }
            Ok(Self {
                ptr,
                width: w,
                height: h,
                output: vec![0; size + 65536],
            })
        }
        fn encode(&mut self, bytes: &[u8]) -> Result<Bytes> {
            if bytes.len() != frame_bytes(self.width, self.height)? {
                bail!("Video frame has the wrong I420 byte length");
            }
            let n = unsafe {
                mumh5_encode(
                    self.ptr,
                    bytes.as_ptr(),
                    bytes.len(),
                    self.output.as_mut_ptr(),
                    self.output.len(),
                )
            };
            if n < 0 {
                bail!("VP8 encoding failed");
            }
            Ok(Bytes::copy_from_slice(&self.output[..n as usize]))
        }
    }
    struct Decoder {
        ptr: *mut c_void,
        output: Vec<u8>,
    }
    // Each receiver owns one decoder, with all calls on its single receiving task.
    unsafe impl Send for Decoder {}
    impl Drop for Decoder {
        fn drop(&mut self) {
            unsafe {
                mumh5_decoder_free(self.ptr);
            }
        }
    }
    impl Decoder {
        fn new() -> Result<Self> {
            let ptr = unsafe { mumh5_decoder_new() };
            if ptr.is_null() {
                bail!("Could not initialize VP8 decoder");
            }
            Ok(Self {
                ptr,
                output: vec![0; 4096 * 2160 * 3 / 2],
            })
        }
        fn decode(&mut self, session: u32, bytes: &[u8]) -> Result<Option<VideoFrame>> {
            if bytes.len() > 4 * 1024 * 1024 {
                bail!("Encoded video frame exceeds limit");
            }
            if bytes.first().is_some_and(|b| b & 1 == 0) {
                if bytes.len() < 10 || bytes[3..6] != [0x9d, 1, 0x2a] {
                    return Ok(None);
                }
                let w = u16::from_le_bytes([bytes[6], bytes[7]]) as u32 & 0x3fff;
                let h = u16::from_le_bytes([bytes[8], bytes[9]]) as u32 & 0x3fff;
                frame_bytes(w, h)?;
            }
            let (mut w, mut h) = (0, 0);
            let n = unsafe {
                mumh5_decode(
                    self.ptr,
                    bytes.as_ptr(),
                    bytes.len(),
                    self.output.as_mut_ptr(),
                    self.output.len(),
                    &mut w,
                    &mut h,
                )
            };
            if n < 0 {
                return Ok(None);
            }
            if n == 0 {
                return Ok(None);
            }
            Ok(Some(VideoFrame {
                session,
                width: w,
                height: h,
                data: self.output[..n as usize].to_vec(),
            }))
        }
    }
    #[derive(Default)]
    struct Vp8Frames {
        expected: Option<u16>,
        timestamp: Option<u32>,
        queued: HashMap<u16, webrtc::rtp::packet::Packet>,
        partial: Vec<u8>,
        waited: Option<Instant>,
    }
    impl Vp8Frames {
        fn push(&mut self, packet: webrtc::rtp::packet::Packet) -> Vec<Vec<u8>> {
            let seq = packet.header.sequence_number;
            if self.expected.is_none() {
                self.expected = Some(seq);
            }
            if seq.wrapping_sub(self.expected.unwrap()) >= 0x8000 {
                return vec![];
            }
            if self.queued.len() >= 32
                || self
                    .waited
                    .is_some_and(|at| at.elapsed() > Duration::from_millis(150))
            {
                self.queued.clear();
                self.partial.clear();
                self.timestamp = None;
                self.expected = Some(seq);
            }
            self.queued.insert(seq, packet);
            let mut complete = vec![];
            while let Some(packet) = self.queued.remove(&self.expected.unwrap()) {
                self.expected = Some(self.expected.unwrap().wrapping_add(1));
                self.waited = Some(Instant::now());
                let mut vp8 = Vp8Packet::default();
                let Ok(payload) = vp8.depacketize(&packet.payload) else {
                    self.partial.clear();
                    self.timestamp = None;
                    continue;
                };
                if vp8.s == 1 && vp8.pid == 0 {
                    self.partial.clear();
                    self.timestamp = Some(packet.header.timestamp);
                }
                if self.timestamp != Some(packet.header.timestamp) {
                    continue;
                }
                if self.partial.len() + payload.len() > 4 * 1024 * 1024 {
                    self.partial.clear();
                    self.timestamp = None;
                    continue;
                }
                self.partial.extend_from_slice(&payload);
                if packet.header.marker {
                    complete.push(std::mem::take(&mut self.partial));
                    self.timestamp = None;
                }
            }
            complete
        }
    }
    async fn receive_track(
        track: Arc<webrtc::track::track_remote::TrackRemote>,
        peer: Weak<RTCPeerConnection>,
        frames: mpsc::Sender<VideoFrame>,
        events: mpsc::Sender<Value>,
        cancel: CancellationToken,
        session: u32,
    ) {
        let Ok(mut decoder) = Decoder::new() else {
            return;
        };
        let mut assembler = Vp8Frames::default();
        let mut pli = interval(Duration::from_secs(2));
        loop {
            tokio::select! {
                _ = cancel.cancelled() => break,
                _ = pli.tick() => {
                    if let Some(pc) = peer.upgrade() {
                        let _ = pc.write_rtcp(&[Box::new(PictureLossIndication { sender_ssrc: 0, media_ssrc: track.ssrc() })]).await;
                    } else { break; }
                }
                packet = track.read_rtp() => {
                    let Ok((packet, _)) = packet else { break; };
                    for sample in assembler.push(packet) {
                        let decoded = tokio::task::spawn_blocking(move || { let result = decoder.decode(session, &sample); (decoder, result) }).await;
                        let Ok((owned, result)) = decoded else { return; }; decoder = owned;
                        match result {
                            Ok(Some(frame)) => { let _ = frames.try_send(frame); },
                            Err(error) => { let _ = events.try_send(json!({"event":"mediaError","message":error.to_string()})); },
                            _ => {}
                        }
                    }
                }
            }
        }
    }
    struct Sending {
        encoder: Option<Encoder>,
        track: Arc<TrackLocalStaticSample>,
        kind: String,
        fps: u32,
    }
    struct Receiving {
        session: u32,
        pc: Option<Arc<RTCPeerConnection>>,
        cancel: CancellationToken,
        started: Instant,
    }
    struct Manager {
        client: Weak<Inner>,
        state: Arc<RwLock<State>>,
        events: mpsc::Sender<Value>,
        frames: mpsc::Sender<VideoFrame>,
        ice: Vec<RTCIceServer>,
        api: Option<API>,
        sending: Option<Sending>,
        peers: HashMap<u32, Arc<RTCPeerConnection>>,
        receiving: Option<Receiving>,
        announced: HashSet<u32>,
        assembler: crate::signal::Assembler,
        auto_watch: bool,
    }
    impl Manager {
        fn event(&self, value: Value) {
            let _ = self.events.try_send(value);
        }
        fn signal(
            &self,
            to: Vec<u32>,
            kind: u8,
            text: Option<&str>,
        ) -> impl std::future::Future<Output = Result<()>> + Send + 'static {
            let client = self.client.clone();
            let packets = crate::signal::encode(kind, text);
            async move {
                let Some(inner) = client.upgrade() else {
                    return Ok(());
                };
                if inner.cancel.is_cancelled() {
                    return Ok(());
                }
                crate::Client(inner)
                    .plugins(to, "mumh5.share", packets?)
                    .await
            }
        }
        fn same_channel(&self, id: u32) -> bool {
            let state = self.state.read().unwrap();
            id != state.session
                && state
                    .own()
                    .zip(state.users.get(&id))
                    .is_some_and(|(a, b)| a.channel_id == b.channel_id)
        }
        fn others(&self) -> Vec<u32> {
            let state = self.state.read().unwrap();
            state
                .users
                .values()
                .filter(|u| {
                    u.session != state.session
                        && state
                            .own()
                            .is_some_and(|own| own.channel_id == u.channel_id)
                })
                .map(|u| u.session)
                .collect()
        }
        async fn pc(
            &mut self,
            session: u32,
            direction: &'static str,
        ) -> Result<Arc<RTCPeerConnection>> {
            if self.api.is_none() {
                let mut engine = MediaEngine::default();
                engine.register_codec(
                    RTCRtpCodecParameters {
                        capability: RTCRtpCodecCapability {
                            mime_type: MIME_TYPE_VP8.into(),
                            clock_rate: 90000,
                            ..Default::default()
                        },
                        payload_type: 96,
                        ..Default::default()
                    },
                    RTPCodecType::Video,
                )?;
                engine.register_codec(
                    RTCRtpCodecParameters {
                        capability: RTCRtpCodecCapability {
                            mime_type: MIME_TYPE_OPUS.into(),
                            clock_rate: 48000,
                            channels: 2,
                            sdp_fmtp_line: "minptime=10;useinbandfec=1".into(),
                            ..Default::default()
                        },
                        payload_type: 111,
                        ..Default::default()
                    },
                    RTPCodecType::Audio,
                )?;
                let registry = register_default_interceptors(Registry::new(), &mut engine)?;
                self.api = Some(
                    APIBuilder::new()
                        .with_media_engine(engine)
                        .with_interceptor_registry(registry)
                        .build(),
                );
            }
            let pc = Arc::new(
                self.api
                    .as_ref()
                    .unwrap()
                    .new_peer_connection(RTCConfiguration {
                        ice_servers: self.ice.clone(),
                        ..Default::default()
                    })
                    .await?,
            );
            let events = self.events.clone();
            pc.on_peer_connection_state_change(Box::new(move|state|{let events=events.clone();Box::pin(async move{let _=events.try_send(json!({"event":"videoConnection","session":session,"direction":direction,"state":state.to_string()}));})}));
            Ok(pc)
        }

        async fn start(&mut self, w: u32, h: u32, fps: u32, kind: String) -> Result<()> {
            frame_bytes(w, h)?;
            if !(1..=60).contains(&fps) {
                bail!("fps must be 1..60");
            }
            if kind != "screen" && kind != "camera" {
                bail!("kind must be screen or camera");
            }
            if self.state.read().unwrap().server_version < ((1u64 << 48) | (4u64 << 32)) {
                bail!("Video needs Mumble 1.4 or newer");
            }
            self.stop().await?;
            let encoder = Encoder::new(w, h, fps)?;
            let track = Arc::new(TrackLocalStaticSample::new(
                RTCRtpCodecCapability {
                    mime_type: MIME_TYPE_VP8.into(),
                    clock_rate: 90000,
                    ..Default::default()
                },
                "video".into(),
                "mumh5".into(),
            ));
            self.sending = Some(Sending {
                encoder: Some(encoder),
                track,
                kind: kind.clone(),
                fps,
            });
            self.state.write().unwrap().video_shape = Some((w, h));
            let to = self.others();
            self.announced = to.iter().copied().collect();
            self.signal(to, 1, Some(&kind)).await?;
            self.event(json!({"event":"sharing","session":self.state.read().unwrap().session,"kind":kind,"active":true}));
            Ok(())
        }
        async fn push(&mut self, bytes: &[u8]) -> Result<()> {
            let sending = self
                .sending
                .as_mut()
                .context("Start video sharing before pushing frames")?;
            let mut encoder = sending.encoder.take().context("Video encoder stopped")?;
            let input = bytes.to_vec();
            // Codec work must not hold a Tokio worker needed for voice and network I/O.
            let (encoder, encoded) = tokio::task::spawn_blocking(move || {
                let result = encoder.encode(&input);
                (encoder, result)
            })
            .await
            .context("Video encoder task failed")?;
            sending.encoder = Some(encoder);
            let encoded = encoded?;
            if !encoded.is_empty() {
                sending
                    .track
                    .write_sample(&Sample {
                        data: encoded,
                        duration: Duration::from_secs_f64(1.0 / sending.fps as f64),
                        ..Default::default()
                    })
                    .await?;
            }
            Ok(())
        }
        async fn stop(&mut self) -> Result<()> {
            self.state.write().unwrap().video_shape = None;
            if self.sending.take().is_none() {
                return Ok(());
            }
            for (_, pc) in self.peers.drain() {
                let _ = pc.close().await;
            }
            self.announced.clear();
            self.signal(self.others(), 2, None).await?;
            self.event(json!({"event":"sharing","session":self.state.read().unwrap().session,"active":false}));
            Ok(())
        }
        async fn unwatch(&mut self) -> Result<()> {
            if let Some(receiver) = self.receiving.take() {
                receiver.cancel.cancel();
                if let Some(pc) = receiver.pc {
                    let _ = pc.close().await;
                }
                self.signal(vec![receiver.session], 5, None).await?;
            }
            Ok(())
        }
        async fn watch(&mut self, session: u32) -> Result<()> {
            if !self.same_channel(session) {
                bail!("Video peer must be another user in your voice channel");
            }
            self.unwatch().await?;
            self.receiving = Some(Receiving {
                session,
                pc: None,
                cancel: CancellationToken::new(),
                started: Instant::now(),
            });
            self.signal(vec![session], 4, None).await
        }
        async fn offer(&mut self, session: u32) -> Result<()> {
            let Some(track) = self.sending.as_ref().map(|s| s.track.clone()) else {
                return Ok(());
            };
            if !self.peers.contains_key(&session) && self.peers.len() >= 8 {
                return Ok(());
            }
            if let Some(pc) = self.peers.remove(&session) {
                let _ = pc.close().await;
            }
            let pc = self.pc(session, "out").await?;
            let sender = pc.add_track(track).await?;
            tokio::spawn(async move {
                let mut buffer = [0u8; 1500];
                while sender.read(&mut buffer).await.is_ok() {}
            });
            let mut gathered = pc.gathering_complete_promise().await;
            let offer = pc.create_offer(None).await?;
            pc.set_local_description(offer).await?;
            let _ = timeout(Duration::from_secs(3), gathered.recv()).await;
            let text = pc.local_description().await.context("No offer")?.sdp;
            self.peers.insert(session, pc);
            self.signal(vec![session], 6, Some(&text)).await
        }
        async fn answer(&mut self, session: u32, sdp: String) -> Result<()> {
            if self.receiving.as_ref().is_none_or(|r| r.session != session) {
                return Ok(());
            }
            if let Some(receiver) = &mut self.receiving {
                receiver.cancel.cancel();
                if let Some(pc) = receiver.pc.take() {
                    let _ = pc.close().await;
                }
                receiver.cancel = CancellationToken::new();
            }
            let pc = self.pc(session, "in").await?;
            let frames = self.frames.clone();
            let token = self.receiving.as_ref().unwrap().cancel.clone();
            let weak = Arc::downgrade(&pc);
            let events = self.events.clone();
            pc.on_track(Box::new(move |track, _, _| {
                let frames = frames.clone();
                let cancel = token.clone();
                let peer = weak.clone();
                let events = events.clone();
                Box::pin(async move {
                    if track.kind() != RTPCodecType::Video
                        || !track
                            .codec()
                            .capability
                            .mime_type
                            .eq_ignore_ascii_case("video/vp8")
                    {
                        return;
                    }
                    tokio::spawn(receive_track(track, peer, frames, events, cancel, session));
                })
            }));
            pc.set_remote_description(RTCSessionDescription::offer(sdp)?)
                .await?;
            let mut gathered = pc.gathering_complete_promise().await;
            let answer = pc.create_answer(None).await?;
            pc.set_local_description(answer).await?;
            let _ = timeout(Duration::from_secs(3), gathered.recv()).await;
            let text = pc.local_description().await.context("No answer")?.sdp;
            self.receiving.as_mut().unwrap().pc = Some(pc);
            self.signal(vec![session], 7, Some(&text)).await
        }
        async fn receive(&mut self, sender: u32, data: Vec<u8>) -> Result<()> {
            if !self.same_channel(sender) {
                return Ok(());
            }
            let Some((kind, text)) = self.assembler.push(sender, &data) else {
                return Ok(());
            };
            match kind {
                1 => {
                    self.event(json!({"event":"sharing","session":sender,"kind":text.as_deref().unwrap_or("screen"),"active":true}));
                    if self.auto_watch && self.receiving.is_none() {
                        self.watch(sender).await?;
                    }
                }
                2 => {
                    self.event(json!({"event":"sharing","session":sender,"active":false}));
                    if self.receiving.as_ref().is_some_and(|r| r.session == sender) {
                        self.unwatch().await?;
                    }
                }
                3 => {
                    if let Some(s) = &self.sending {
                        self.signal(vec![sender], 1, Some(&s.kind)).await?;
                    }
                }
                4 => self.offer(sender).await?,
                5 => {
                    if let Some(pc) = self.peers.remove(&sender) {
                        let _ = pc.close().await;
                    }
                }
                6 => {
                    if let Some(text) = text {
                        self.answer(sender, text).await?;
                    }
                }
                7 => {
                    if let (Some(text), Some(pc)) = (text, self.peers.get(&sender)) {
                        pc.set_remote_description(RTCSessionDescription::answer(text)?)
                            .await?;
                    }
                }
                _ => {}
            }
            Ok(())
        }
        async fn changed(&mut self, entered: bool) -> Result<()> {
            let peers: Vec<_> = self
                .peers
                .keys()
                .filter(|id| entered || !self.same_channel(**id))
                .copied()
                .collect();
            for id in peers {
                if let Some(pc) = self.peers.remove(&id) {
                    let _ = pc.close().await;
                }
            }
            if self
                .receiving
                .as_ref()
                .is_some_and(|r| entered || !self.same_channel(r.session))
            {
                self.unwatch().await?;
            }
            if entered {
                self.announced.clear();
            }
            let others = self.others();
            let unseen: Vec<_> = others
                .iter()
                .filter(|id| !self.announced.contains(id))
                .copied()
                .collect();
            if let Some(s) = &self.sending {
                self.signal(unseen, 1, Some(&s.kind)).await?;
                self.announced = others.iter().copied().collect();
            }
            if entered {
                self.signal(others, 3, None).await?;
            }
            Ok(())
        }
        async fn request(&mut self, v: Value) -> Result<Value> {
            match v["op"].as_str().unwrap_or("") {
                "share" => {
                    self.start(
                        number(&v, "width", 640)?,
                        number(&v, "height", 360)?,
                        number(&v, "fps", 15)?,
                        v["kind"].as_str().unwrap_or("camera").into(),
                    )
                    .await?;
                }
                "video" => {
                    let encoded = v["data"].as_str().context("Expected base64 I420 frame")?;
                    if encoded.len() > 18 * 1024 * 1024 {
                        bail!("Video frame too large");
                    }
                    self.push(&STANDARD.decode(encoded)?).await?;
                }
                "stop-video" => self.stop().await?,
                "unwatch" => self.unwatch().await?,
                "watch" => {
                    let target = serde_json::from_value(v["user"].clone())?;
                    let id = self.state.read().unwrap().user(&target)?;
                    self.watch(id).await?;
                }
                "auto-watch" => {
                    self.auto_watch = v["enabled"].as_bool().unwrap_or(false);
                    self.changed(true).await?;
                }
                _ => bail!("Unknown video operation"),
            }
            Ok(Value::Null)
        }
    }
    pub async fn run(
        client: Weak<Inner>,
        state: Arc<RwLock<State>>,
        mut commands: mpsc::Receiver<VideoCommand>,
        frames: mpsc::Sender<VideoFrame>,
        events: mpsc::Sender<Value>,
        ice: Value,
        cancel: CancellationToken,
    ) {
        let mut servers = vec![];
        if let Some(entries) = ice.as_array() {
            for entry in entries {
                let urls = if let Some(s) = entry["urls"].as_str() {
                    vec![s.into()]
                } else {
                    entry["urls"]
                        .as_array()
                        .map(|a| {
                            a.iter()
                                .filter_map(|s| s.as_str().map(str::to_owned))
                                .collect()
                        })
                        .unwrap_or_default()
                };
                servers.push(RTCIceServer {
                    urls,
                    username: entry["username"].as_str().unwrap_or("").into(),
                    credential: entry["credential"].as_str().unwrap_or("").into(),
                });
            }
        }
        let mut manager = Manager {
            client,
            state,
            events,
            frames,
            ice: servers,
            api: None,
            sending: None,
            peers: HashMap::new(),
            receiving: None,
            announced: HashSet::new(),
            assembler: crate::signal::Assembler::default(),
            auto_watch: false,
        };
        let mut timer = interval(Duration::from_secs(1));
        loop {
            let result = tokio::select! {
                _ = cancel.cancelled() => break,
                command = commands.recv() => {
                    match command {
                        Some(VideoCommand::Request(value, reply)) => { let result = manager.request(value).await; let _ = reply.send(result); Ok(()) },
                        Some(VideoCommand::Signal(sender, data)) => manager.receive(sender, data).await,
                        Some(VideoCommand::UserChanged) => manager.changed(false).await,
                        Some(VideoCommand::Entered) => manager.changed(true).await,
                        Some(VideoCommand::Frame(data)) => manager.push(&data).await,
                        None => break,
                    }
                }
                _ = timer.tick(), if manager.receiving.is_some() => {
                    if manager.receiving.as_ref().is_some_and(|r| r.pc.is_none() && r.started.elapsed() > Duration::from_secs(20)) {
                        manager.event(json!({"event":"mediaError","message":"Video negotiation timed out"}));
                        let _ = manager.unwatch().await;
                    }
                    Ok(())
                }
            };
            if let Err(error) = result {
                manager.event(json!({"event":"mediaError","message":error.to_string()}));
            }
        }
        let _ = manager.stop().await;
        let _ = manager.unwatch().await;
    }
    #[cfg(test)]
    mod tests {
        use super::*;
        #[test]
        fn native_roundtrip() {
            let mut encoder = Encoder::new(160, 120, 15).unwrap();
            let mut pixels = vec![128; frame_bytes(160, 120).unwrap()];
            pixels[..160 * 120].fill(60);
            let bytes = encoder.encode(&pixels).unwrap();
            let mut decoder = Decoder::new().unwrap();
            let decoded = decoder.decode(1, &bytes).unwrap().unwrap();
            assert_eq!((decoded.width, decoded.height), (160, 120));
            assert!((decoded.data[0] as i32 - 60).abs() < 10);
        }
    }
}
