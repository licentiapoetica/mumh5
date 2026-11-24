use crate::voice;
use anyhow::{Result, bail};
use opus::{Application, Bitrate, Channels, Decoder, Encoder};
use std::{
    collections::{HashMap, VecDeque},
    time::{Duration, Instant},
};
struct Speaker {
    decoder: Decoder,
    samples: VecDeque<i16>,
    sequence: Option<u64>,
    heard: Instant,
}
pub struct Audio {
    encoder: Encoder,
    speakers: HashMap<u32, Speaker>,
    input: VecDeque<i16>,
    sequence: u64,
    active: bool,
    idle: u8,
    half: Vec<i16>,
}
impl Audio {
    pub fn new(bitrate: i32) -> Result<Self> {
        let mut encoder = Encoder::new(48000, Channels::Mono, Application::Voip)?;
        encoder.set_bitrate(Bitrate::Bits(bitrate))?;
        encoder.set_complexity(3)?;
        Ok(Self {
            encoder,
            speakers: HashMap::new(),
            input: VecDeque::new(),
            sequence: 0,
            active: false,
            idle: 0,
            half: Vec::with_capacity(960),
        })
    }
    pub fn input(&mut self, samples: &[i16]) -> Result<()> {
        if samples.is_empty() || self.input.len() + samples.len() > 96000 {
            bail!("Audio input queue is full or empty; pace PCM input");
        }
        self.input.extend(samples);
        Ok(())
    }
    pub fn receive(&mut self, data: &[u8], own: u32) {
        let Some(packet) = voice::decode(data) else {
            return;
        };
        if packet.session == own {
            return;
        }
        if packet.opus.is_empty() {
            if packet.last
                && let Some(speaker) = self.speakers.get_mut(&packet.session)
            {
                speaker.sequence = None;
            }
            return;
        }
        if !self.speakers.contains_key(&packet.session) {
            if self.speakers.len() >= 64
                && let Some(id) = self
                    .speakers
                    .iter()
                    .min_by_key(|(_, s)| s.heard)
                    .map(|(id, _)| *id)
            {
                self.speakers.remove(&id);
            }
            let Ok(decoder) = Decoder::new(48000, Channels::Mono) else {
                return;
            };
            self.speakers.insert(
                packet.session,
                Speaker {
                    decoder,
                    samples: VecDeque::new(),
                    sequence: None,
                    heard: Instant::now(),
                },
            );
        }
        let s = self.speakers.get_mut(&packet.session).unwrap();
        if s.sequence.is_some_and(|v| packet.sequence <= v)
            && s.heard.elapsed() < Duration::from_secs(1)
        {
            return;
        }
        s.sequence = if packet.last {
            None
        } else {
            Some(packet.sequence)
        };
        s.heard = Instant::now();
        let mut pcm = [0i16; 5760];
        if let Ok(count) = s.decoder.decode(&packet.opus, &mut pcm, false) {
            s.samples.extend(&pcm[..count]);
            while s.samples.len() > 24000 {
                s.samples.pop_front();
            }
        }
    }
    pub fn remove(&mut self, id: u32) {
        self.speakers.remove(&id);
    }
    pub fn tick(&mut self, muted: bool, protobuf: bool) -> (Option<Vec<u8>>, Vec<i16>) {
        let mut outgoing = None;
        if muted {
            self.half.clear();
            if self.active {
                outgoing = Some(voice::encode(self.sequence, &[], true, protobuf));
                self.sequence += 2;
                self.active = false;
            }
        }
        if self.input.len() >= 480 {
            let chunk: Vec<i16> = self.input.drain(..480).collect();
            if !muted {
                self.half.extend(chunk);
                self.active = true;
                self.idle = 0;
                if self.half.len() == 960 {
                    let mut encoded = [0; 4000];
                    if let Ok(n) = self.encoder.encode(&self.half, &mut encoded) {
                        outgoing =
                            Some(voice::encode(self.sequence, &encoded[..n], false, protobuf));
                        self.sequence += 2;
                    }
                    self.half.clear();
                }
            }
        } else if self.active {
            self.idle += 1;
            if self.idle >= 3 {
                if !self.half.is_empty() {
                    self.half.resize(960, 0);
                    let mut encoded = [0; 4000];
                    if let Ok(n) = self.encoder.encode(&self.half, &mut encoded) {
                        outgoing =
                            Some(voice::encode(self.sequence, &encoded[..n], true, protobuf));
                        self.sequence += 2;
                    }
                    self.half.clear();
                } else {
                    outgoing = Some(voice::encode(self.sequence, &[], true, protobuf));
                    self.sequence += 2;
                }
                self.active = false;
            }
        }
        let mut mixed = [0i32; 480];
        for speaker in self.speakers.values_mut() {
            for value in &mut mixed {
                *value += speaker.samples.pop_front().unwrap_or(0) as i32;
            }
        }
        self.speakers
            .retain(|_, s| !s.samples.is_empty() || s.heard.elapsed() < Duration::from_secs(2));
        (
            outgoing,
            mixed
                .iter()
                .map(|n| (*n).clamp(i16::MIN as i32, i16::MAX as i32) as i16)
                .collect(),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::proto::udp;
    use prost::Message;
    fn tone(hz: f64, offset: usize, count: usize) -> Vec<i16> {
        (offset..offset + count)
            .map(|n| (9000.0 * (2.0 * std::f64::consts::PI * hz * n as f64 / 48000.0).sin()) as i16)
            .collect()
    }
    fn packet(encoder: &mut Encoder, sequence: u64, samples: &[i16]) -> Vec<u8> {
        let mut encoded = [0; 4000];
        let count = encoder.encode(samples, &mut encoded).unwrap();
        let mut packet = vec![0];
        udp::Audio {
            sender_session: 2,
            frame_number: sequence,
            opus_data: encoded[..count].to_vec(),
            ..Default::default()
        }
        .encode(&mut packet)
        .unwrap();
        packet
    }
    fn frequency(samples: &[i16]) -> f64 {
        samples
            .windows(2)
            .filter(|p| (p[0] < 0) != (p[1] < 0))
            .count() as f64
            / 2.0
            / (samples.len() as f64 / 48000.0)
    }
    #[test]
    fn incoming_does_not_transmit_and_directions_keep_distinct_tones() {
        let mut audio = Audio::new(40000).unwrap();
        let mut remote = Encoder::new(48000, Channels::Mono, Application::Voip).unwrap();
        for n in 0..100 {
            if n % 2 == 0 {
                audio.receive(
                    &packet(&mut remote, n as u64, &tone(440.0, n * 480, 960)),
                    1,
                );
            }
            assert!(audio.tick(false, true).0.is_none());
        }
        let mut received = vec![];
        let mut outgoing = vec![];
        let mut decoder = Decoder::new(48000, Channels::Mono).unwrap();
        for n in 0..100 {
            audio.input(&tone(880.0, n * 480, 480)).unwrap();
            if n % 2 == 0 {
                audio.receive(
                    &packet(&mut remote, 100 + n as u64, &tone(440.0, n * 480, 960)),
                    1,
                );
            }
            let (encoded, mixed) = audio.tick(false, true);
            received.extend(mixed);
            if let Some(encoded) = encoded {
                let voice = voice::decode(&encoded).unwrap();
                let mut pcm = [0; 5760];
                let count = decoder.decode(&voice.opus, &mut pcm, false).unwrap();
                outgoing.extend_from_slice(&pcm[..count]);
            }
        }
        assert!((frequency(&received[24000..]) - 440.0).abs() < 20.0);
        assert!((frequency(&outgoing[24000..]) - 880.0).abs() < 20.0);
        audio.tick(true, true);
        assert!(audio.half.is_empty());
    }
}
