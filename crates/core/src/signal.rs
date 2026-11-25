use anyhow::{Result, bail};
use flate2::{Compression, read::DeflateDecoder, write::DeflateEncoder};
use std::{
    collections::HashMap,
    io::{Read, Write},
    time::{Duration, Instant},
};
const MAX_TEXT: u64 = 256 * 1024;
pub fn encode(kind: u8, text: Option<&str>) -> Result<Vec<Vec<u8>>> {
    let Some(text) = text else {
        return Ok(vec![vec![kind]]);
    };
    if text.len() > MAX_TEXT as usize {
        bail!("Signal too large");
    }
    let mut writer = DeflateEncoder::new(Vec::new(), Compression::fast());
    writer.write_all(text.as_bytes())?;
    let bytes = writer.finish()?;
    let total = bytes.len().div_ceil(900).max(1);
    if total > 32 {
        bail!("Signal too large");
    }
    let id = uuid::Uuid::new_v4().as_bytes()[0];
    Ok((0..total)
        .map(|index| {
            let mut packet = vec![kind, id, index as u8, total as u8];
            packet.extend_from_slice(&bytes[index * 900..bytes.len().min((index + 1) * 900)]);
            packet
        })
        .collect())
}
struct Partial {
    at: Instant,
    parts: Vec<Option<Vec<u8>>>,
}
#[derive(Default)]
pub struct Assembler {
    pending: HashMap<(u32, u8, u8), Partial>,
}
impl Assembler {
    pub fn push(&mut self, sender: u32, packet: &[u8]) -> Option<(u8, Option<String>)> {
        let kind = *packet.first()?;
        if !(1..=7).contains(&kind) {
            return None;
        }
        if packet.len() == 1 {
            return Some((kind, None));
        }
        if packet.len() < 4
            || packet.len() > 904
            || packet[3] == 0
            || packet[3] > 32
            || packet[2] >= packet[3]
        {
            return None;
        }
        self.pending
            .retain(|_, p| p.at.elapsed() < Duration::from_secs(15));
        if self.pending.len() >= 64 {
            self.pending.clear();
        }
        let key = (sender, kind, packet[1]);
        let entry = self.pending.entry(key).or_insert_with(|| Partial {
            at: Instant::now(),
            parts: vec![None; packet[3] as usize],
        });
        if entry.parts.len() != packet[3] as usize {
            self.pending.remove(&key);
            return None;
        }
        entry.parts[packet[2] as usize] = Some(packet[4..].to_vec());
        if entry.parts.iter().any(Option::is_none) {
            return None;
        }
        let entry = self.pending.remove(&key)?;
        let compressed: Vec<u8> = entry.parts.into_iter().flatten().flatten().collect();
        let mut plain = Vec::new();
        DeflateDecoder::new(&compressed[..])
            .take(MAX_TEXT + 1)
            .read_to_end(&mut plain)
            .ok()?;
        if plain.len() > MAX_TEXT as usize {
            return None;
        }
        Some((kind, Some(String::from_utf8(plain).ok()?)))
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reassembles_out_of_order_and_bounds_inflation() {
        let text = "hello 🌍".repeat(100);
        let packets = encode(6, Some(&text)).unwrap();
        let mut a = Assembler::default();
        let mut result = None;
        for p in packets.into_iter().rev() {
            result = a.push(7, &p).or(result);
        }
        assert_eq!(result, Some((6, Some(text))));
        assert!(encode(1, Some(&"a".repeat(262145))).is_err());
    }
}
