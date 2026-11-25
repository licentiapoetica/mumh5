//! Output device choice for the Linux desktop app. WebKitGTK lists no audio outputs and has no
//! `setSinkId`, so the sound server's outputs are listed here and this app's own playback streams
//! (its WebView processes included) are moved to the chosen one, also streams that start later.
use anyhow::{Result, bail};
use serde_json::{Value, json};
use std::{collections::HashSet, sync::Arc, time::Duration};
use tokio::{
    io::{AsyncBufReadExt, BufReader},
    process::Command,
    sync::Mutex,
    task::JoinHandle,
};

async fn pactl(args: &[&str]) -> Result<Vec<u8>> {
    let out = tokio::time::timeout(
        Duration::from_secs(5),
        Command::new("pactl").args(args).kill_on_drop(true).output(),
    )
    .await??;
    if !out.status.success() {
        bail!(
            "pactl failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        );
    }
    Ok(out.stdout)
}
async fn json(what: &str) -> Result<Value> {
    Ok(serde_json::from_slice(
        &pactl(&["-f", "json", "list", what]).await?,
    )?)
}

/// Named outputs: `{id, label}` with the sink name as id. Our own screen-share microphone is left out.
pub fn outputs(sinks: &Value) -> Vec<Value> {
    sinks
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|s| {
            let name = s["name"].as_str()?;
            if name.starts_with("mumh5-share-audio") {
                return None;
            }
            let label = s["description"]
                .as_str()
                .filter(|d| !d.is_empty())
                .unwrap_or(name);
            Some(json!({"id": name, "label": label}))
        })
        .collect()
}

/// Which of this app's streams to move where: `(sink-input index, sink name)`.
/// `target` None means back to the system default, for streams that are not on it.
pub fn plan(
    inputs: &Value,
    sinks: &Value,
    pids: &HashSet<u64>,
    target: Option<&str>,
    default: &str,
) -> Vec<(u64, String)> {
    let index_of = |name: &str| {
        sinks
            .as_array()
            .into_iter()
            .flatten()
            .find(|s| s["name"] == name)
            .and_then(|s| s["index"].as_u64())
    };
    let want = target.unwrap_or(default);
    let Some(want_index) = index_of(want) else {
        return vec![];
    };
    inputs
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|i| {
            let pid = i["properties"]["application.process.id"]
                .as_str()
                .and_then(|p| p.parse::<u64>().ok())
                .or_else(|| i["properties"]["application.process.id"].as_u64())?;
            (pids.contains(&pid) && i["sink"].as_u64() != Some(want_index))
                .then_some((i["index"].as_u64()?, want.to_owned()))
        })
        .collect()
}

#[derive(Clone, Default)]
pub struct OutputRouter {
    target: Arc<Mutex<Option<String>>>,
    watcher: Arc<Mutex<Option<JoinHandle<()>>>>,
}
impl OutputRouter {
    /// The outputs, or None where the sound server cannot be asked (no pactl).
    pub async fn devices() -> Option<Vec<Value>> {
        if !cfg!(target_os = "linux") {
            return None;
        }
        json("sinks").await.ok().map(|s| outputs(&s))
    }
    async fn apply(target: Option<&str>) -> Result<()> {
        let sinks = json("sinks").await?;
        let inputs = json("sink-inputs").await?;
        let info: Value = serde_json::from_slice(&pactl(&["-f", "json", "info"]).await?)?;
        let default = info["default_sink_name"].as_str().unwrap_or_default();
        for (index, sink) in plan(
            &inputs,
            &sinks,
            &crate::pipewire::own_pids(),
            target,
            default,
        ) {
            let _ = pactl(&["move-sink-input", &index.to_string(), &sink]).await;
        }
        Ok(())
    }
    /// Routes this app's playback to `sink` (a sink name), or back to the system default.
    /// An unknown name (a device id saved by another app version) counts as the default.
    pub async fn set(&self, sink: Option<String>) -> Result<()> {
        let known = match &sink {
            Some(name) => Self::devices()
                .await
                .unwrap_or_default()
                .iter()
                .any(|d| d["id"] == name.as_str()),
            None => false,
        };
        let sink = sink.filter(|_| known);
        let previous = std::mem::replace(&mut *self.target.lock().await, sink.clone());
        // Back to the default only undoes our own move, never a choice made in the system mixer.
        if sink.is_some() || previous.is_some() {
            Self::apply(sink.as_deref()).await?;
        }
        let mut watcher = self.watcher.lock().await;
        if let Some(task) = watcher.take() {
            task.abort();
        }
        if sink.is_some() {
            // New streams (a sound, a reconnect, a new WebView audio process) follow the choice.
            let target = self.target.clone();
            *watcher = Some(tokio::spawn(async move {
                let Ok(mut child) = Command::new("pactl")
                    .arg("subscribe")
                    .stdout(std::process::Stdio::piped())
                    .stderr(std::process::Stdio::null())
                    .kill_on_drop(true)
                    .spawn()
                else {
                    return;
                };
                let Some(stdout) = child.stdout.take() else {
                    return;
                };
                let mut lines = BufReader::new(stdout).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    if line.contains("'new' on sink-input")
                        || line.contains("'change' on sink-input")
                    {
                        let sink = target.lock().await.clone();
                        let _ = Self::apply(sink.as_deref()).await;
                    }
                }
            }));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn sinks() -> Value {
        json!([
            {"index": 56, "name": "alsa_output.hdmi", "description": "Monitor HDMI"},
            {"index": 57, "name": "alsa_output.usb-headset", "description": "PRO X Headset"},
            {"index": 60, "name": "mumh5-share-audio-123", "description": "mumh5 screen share audio"}
        ])
    }
    fn inputs() -> Value {
        json!([
            {"index": 1, "sink": 57, "properties": {"application.process.id": "500"}},
            {"index": 2, "sink": 56, "properties": {"application.process.id": "501"}},
            {"index": 3, "sink": 57, "properties": {"application.process.id": "900"}}
        ])
    }
    #[test]
    fn lists_named_outputs_without_our_virtual_microphone() {
        assert_eq!(
            outputs(&sinks()),
            vec![
                json!({"id": "alsa_output.hdmi", "label": "Monitor HDMI"}),
                json!({"id": "alsa_output.usb-headset", "label": "PRO X Headset"}),
            ]
        );
    }
    #[test]
    fn moves_only_this_apps_streams_that_are_elsewhere() {
        let pids = HashSet::from([500, 501]);
        assert_eq!(
            plan(
                &inputs(),
                &sinks(),
                &pids,
                Some("alsa_output.hdmi"),
                "alsa_output.usb-headset"
            ),
            [(1, "alsa_output.hdmi".to_owned())]
        );
        // Back to the default: the stream on HDMI returns; other programs are never touched.
        assert_eq!(
            plan(&inputs(), &sinks(), &pids, None, "alsa_output.usb-headset"),
            [(2, "alsa_output.usb-headset".to_owned())]
        );
        assert!(
            plan(
                &inputs(),
                &sinks(),
                &pids,
                Some("gone"),
                "alsa_output.usb-headset"
            )
            .is_empty()
        );
    }
}
