//! Binary framing between the wire commands and `frontend/src/lib/tauri.ts`.
//!
//! To the page: one channel message holds records `[kind u8][length u32 LE][payload]`, in the
//! order they happened, so a batch of server data, voice and events costs one IPC message
//! instead of a JSON array of numbers per chunk. From the page: stream bytes as a raw request
//! body, and UDP datagrams as `[length u16 LE][datagram]` records.
use anyhow::{Result, bail};
use serde_json::Value;
use std::sync::atomic::{AtomicU64, Ordering};
use tokio::sync::Notify;

pub const DATA: u8 = 0;
pub const VOICE: u8 = 1;
pub const EVENT: u8 = 2;
/// A batch stops growing here; the next one is sent right after.
pub const BATCH_BYTES: usize = 256 * 1024;
/// Bytes the page may hold unacknowledged before the reader waits. The page acknowledges every
/// `WINDOW_BYTES / 4` (see `tauri.ts`), so a full window always leads to an ack.
pub const WINDOW_BYTES: u64 = 1024 * 1024;

pub fn push(batch: &mut Vec<u8>, kind: u8, payload: &[u8]) {
    batch.push(kind);
    batch.extend_from_slice(&(payload.len() as u32).to_le_bytes());
    batch.extend_from_slice(payload);
}

pub fn push_event(batch: &mut Vec<u8>, event: &Value) {
    push(batch, EVENT, event.to_string().as_bytes());
}

pub fn event(event: &Value) -> Vec<u8> {
    let mut batch = Vec::new();
    push_event(&mut batch, event);
    batch
}

pub fn datagrams(mut body: &[u8]) -> Result<Vec<Vec<u8>>> {
    let mut out = Vec::new();
    while !body.is_empty() {
        let Some((len, rest)) = body.split_first_chunk::<2>() else {
            bail!("Truncated UDP record");
        };
        let len = u16::from_le_bytes(*len) as usize;
        if rest.len() < len {
            bail!("Truncated UDP record");
        }
        out.push(rest[..len].to_vec());
        body = &rest[len..];
    }
    Ok(out)
}

/// Flow control: bytes handed to the page against bytes it has acknowledged.
#[derive(Default)]
pub struct Window {
    acked: AtomicU64,
    notify: Notify,
}

impl Window {
    pub fn ack(&self, bytes: u64) {
        self.acked.fetch_add(bytes, Ordering::AcqRel);
        self.notify.notify_one();
    }
    /// Waits until fewer than `WINDOW_BYTES` of `sent` are unacknowledged.
    pub async fn wait(&self, sent: u64) {
        loop {
            let notified = self.notify.notified();
            if sent.saturating_sub(self.acked.load(Ordering::Acquire)) < WINDOW_BYTES {
                return;
            }
            notified.await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{sync::Arc, time::Duration};

    #[test]
    fn records_and_datagrams_round_trip() {
        let mut batch = Vec::new();
        push(&mut batch, DATA, b"abc");
        push_event(
            &mut batch,
            &serde_json::json!({"event":"close","args":["x"]}),
        );
        assert_eq!(&batch[..8], &[0, 3, 0, 0, 0, b'a', b'b', b'c']);
        assert_eq!(batch[8], EVENT);
        let body = [&[2u8, 0, 7, 8][..], &[0, 0], &[1, 0, 9]].concat();
        assert_eq!(datagrams(&body).unwrap(), vec![vec![7, 8], vec![], vec![9]]);
        assert!(datagrams(&[3, 0, 1]).is_err());
        assert!(datagrams(&[3]).is_err());
    }

    #[tokio::test]
    async fn the_window_waits_for_acks() {
        let w = Arc::new(Window::default());
        tokio::time::timeout(Duration::from_millis(50), w.wait(WINDOW_BYTES - 1))
            .await
            .expect("under the window");
        let waiting = tokio::spawn({
            let w = w.clone();
            async move { w.wait(WINDOW_BYTES + 10).await }
        });
        tokio::time::sleep(Duration::from_millis(20)).await;
        assert!(!waiting.is_finished());
        w.ack(11);
        tokio::time::timeout(Duration::from_secs(1), waiting)
            .await
            .expect("released by the ack")
            .unwrap();
    }
}
