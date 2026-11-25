//! Native PipeWire graph control. No shell or application audio is routed back into itself.
use anyhow::{Context, Result, bail};
use serde_json::Value;
use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
    time::Duration,
};
use tokio::{
    io::{AsyncBufReadExt, BufReader},
    process::Command,
    sync::Mutex,
    task::JoinHandle,
};
use tokio_util::sync::CancellationToken;
const LABEL: &str = "mumh5 screen share audio";
fn props(v: &Value) -> &Value {
    &v["info"]["props"]
}
fn number(v: &Value) -> Option<u64> {
    v.as_u64().or_else(|| v.as_str()?.parse().ok())
}
pub(crate) fn own_pids() -> HashSet<u64> {
    let mut all = HashSet::new();
    let mut todo = vec![std::process::id() as u64];
    while let Some(pid) = todo.pop() {
        if !all.insert(pid) {
            continue;
        }
        if let Ok(children) = std::fs::read_to_string(format!("/proc/{pid}/task/{pid}/children")) {
            todo.extend(
                children
                    .split_whitespace()
                    .filter_map(|p| p.parse::<u64>().ok()),
            );
        }
    }
    all
}
fn description(node: &Value, by_id: &HashMap<u64, &Value>) -> (String, Option<u64>) {
    let p = props(node);
    let client = number(&p["client.id"]).and_then(|id| by_id.get(&id));
    let cp = client.map(|c| props(c));
    let get = |k: &str| p[k].as_str().or_else(|| cp.and_then(|c| c[k].as_str()));
    let name = get("application.name")
        .or_else(|| get("node.name"))
        .unwrap_or("")
        .to_owned();
    let pid = number(&p["application.process.id"])
        .or_else(|| cp.and_then(|c| number(&c["application.process.id"])));
    (name, pid)
}
pub fn apps(objects: &[Value], pids: &HashSet<u64>) -> Vec<String> {
    let by_id = objects
        .iter()
        .filter_map(|o| Some((o["id"].as_u64()?, o)))
        .collect();
    let mut names = HashSet::new();
    for o in objects {
        if props(o)["media.class"] != "Stream/Output/Audio" {
            continue;
        }
        let (name, pid) = description(o, &by_id);
        if !name.is_empty() && !pid.is_some_and(|p| pids.contains(&p)) {
            names.insert(name);
        }
    }
    let mut names: Vec<_> = names.into_iter().collect();
    names.sort();
    names
}
pub fn plan(
    objects: &[Value],
    target: &Value,
    pids: &HashSet<u64>,
    mic_name: &str,
) -> (Vec<(u64, u64)>, Vec<u64>) {
    let by_id = objects
        .iter()
        .filter_map(|o| Some((o["id"].as_u64()?, o)))
        .collect();
    let Some(mic) = objects
        .iter()
        .find(|o| props(o)["node.name"] == mic_name)
        .and_then(|o| o["id"].as_u64())
    else {
        return Default::default();
    };
    let input = |channel: &str| {
        objects
            .iter()
            .find(|o| {
                number(&props(o)["node.id"]) == Some(mic)
                    && o["info"]["direction"] == "input"
                    && props(o)["audio.channel"] == channel
            })
            .and_then(|o| o["id"].as_u64())
    };
    let (Some(left), Some(right)) = (input("FL"), input("FR")) else {
        return Default::default();
    };
    let mut wanted = HashSet::new();
    for node in objects {
        if props(node)["media.class"] != "Stream/Output/Audio" {
            continue;
        }
        let (name, pid) = description(node, &by_id);
        if pid.is_some_and(|p| pids.contains(&p))
            || target["kind"] == "app" && target["name"] != name
        {
            continue;
        }
        for port in objects {
            if number(&props(port)["node.id"]) != node["id"].as_u64()
                || port["info"]["direction"] != "output"
            {
                continue;
            }
            let Some(id) = port["id"].as_u64() else {
                continue;
            };
            let ch = props(port)["audio.channel"].as_str().unwrap_or("");
            if ch == "FL" || ch == "MONO" {
                wanted.insert((id, left));
            }
            if ch == "FR" || ch == "MONO" {
                wanted.insert((id, right));
            }
        }
    }
    let mut remove = vec![];
    for o in objects {
        if o["type"] != "PipeWire:Interface:Link"
            || number(&o["info"]["input-node-id"]) != Some(mic)
        {
            continue;
        }
        if let (Some(out), Some(input), Some(id)) = (
            number(&o["info"]["output-port-id"]),
            number(&o["info"]["input-port-id"]),
            o["id"].as_u64(),
        ) && !wanted.remove(&(out, input))
        {
            remove.push(id);
        }
    }
    (wanted.into_iter().collect(), remove)
}
/// Virtual microphones left by an earlier mumh5 process that is gone (a crash; the node lingers).
pub fn stale(objects: &[Value], alive: impl Fn(u64) -> bool) -> Vec<u64> {
    objects
        .iter()
        .filter_map(|o| {
            let name = props(o)["node.name"].as_str()?;
            let pid = name
                .strip_prefix("mumh5-share-audio-")?
                .parse::<u64>()
                .ok()?;
            (!alive(pid)).then_some(o["id"].as_u64()?)
        })
        .collect()
}
fn process_alive(pid: u64) -> bool {
    pid == std::process::id() as u64 || std::path::Path::new(&format!("/proc/{pid}")).exists()
}
async fn run(cmd: &str, args: &[String]) -> Result<Vec<u8>> {
    let out = tokio::time::timeout(
        Duration::from_secs(5),
        Command::new(cmd).args(args).kill_on_drop(true).output(),
    )
    .await??;
    if !out.status.success() {
        bail!("{cmd} failed: {}", String::from_utf8_lossy(&out.stderr));
    }
    if out.stdout.len() > 64 * 1024 * 1024 {
        bail!("PipeWire graph too large");
    }
    Ok(out.stdout)
}
async fn dump() -> Result<Vec<Value>> {
    Ok(serde_json::from_slice(&run("pw-dump", &[]).await?)?)
}
async fn relink(target: &Value, name: &str) -> Result<()> {
    let (add, remove) = plan(&dump().await?, target, &own_pids(), name);
    for id in remove {
        let _ = run("pw-link", &["-d".into(), id.to_string()]).await;
    }
    for (a, b) in add {
        let _ = run("pw-link", &[a.to_string(), b.to_string()]).await;
    }
    Ok(())
}
struct Session {
    cancel: CancellationToken,
    task: JoinHandle<()>,
}
#[derive(Clone, Default)]
pub struct ShareAudio {
    session: Arc<Mutex<Option<Session>>>,
}
impl ShareAudio {
    pub fn label() -> String {
        format!("{LABEL} {}", std::process::id())
    }
    fn name() -> String {
        format!("mumh5-share-audio-{}", std::process::id())
    }
    pub async fn available() -> bool {
        cfg!(target_os = "linux")
            && dump().await.is_ok()
            && run("pw-link", &["--version".into()]).await.is_ok()
            && run("pw-cli", &["--version".into()]).await.is_ok()
    }
    pub async fn apps(&self) -> Result<Vec<String>> {
        Ok(apps(&dump().await?, &own_pids()))
    }
    pub async fn start(&self, target: Value) -> Result<()> {
        if target["kind"] != "all"
            && !(target["kind"] == "app"
                && target["name"]
                    .as_str()
                    .is_some_and(|s| !s.is_empty() && s.len() < 1024))
        {
            bail!("Invalid audio target");
        }
        self.stop().await?;
        if let Ok(objects) = dump().await {
            for id in stale(&objects, process_alive) {
                let _ = run("pw-cli", &["destroy".into(), id.to_string()]).await;
            }
        }
        let name = Self::name();
        let properties = format!(
            "{{ factory.name=support.null-audio-sink node.name={name} node.description=\"{}\" media.class=Audio/Source/Virtual object.linger=1 audio.position=[FL,FR] audio.rate=48000 audio.channels=2 }}",
            Self::label()
        );
        run(
            "pw-cli",
            &["create-node".into(), "adapter".into(), properties],
        )
        .await?;
        let monitor = async {
            // Give PipeWire a moment to publish the node and its ports.
            for _ in 0..20 {
                let objects = dump().await?;
                let mic = objects
                    .iter()
                    .find(|o| props(o)["node.name"] == name)
                    .and_then(|o| o["id"].as_u64());
                if mic.is_some_and(|mic| {
                    objects
                        .iter()
                        .any(|o| number(&props(o)["node.id"]) == Some(mic))
                }) {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
            relink(&target, &name).await?;
            let mut child = Command::new("pw-mon")
                .arg("--color=never")
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::null())
                .kill_on_drop(true)
                .spawn()?;
            let lines =
                BufReader::new(child.stdout.take().context("No PipeWire monitor output")?).lines();
            anyhow::Ok((child, lines))
        }
        .await;
        let (mut child, mut lines) = match monitor {
            Ok(monitor) => monitor,
            Err(error) => {
                // Do not leave a half-configured virtual microphone behind.
                let _ = self.stop().await;
                return Err(error);
            }
        };
        let cancel = CancellationToken::new();
        let stop = cancel.clone();
        let task = tokio::spawn(async move {
            let mut pending = false;
            let timer = tokio::time::sleep(Duration::from_secs(1));
            tokio::pin!(timer);
            loop {
                tokio::select! {_=stop.cancelled()=>break,line=lines.next_line()=>match line{Ok(Some(line))=>if line.contains("added")||line.contains("removed"){pending=true;timer.as_mut().reset(tokio::time::Instant::now()+Duration::from_millis(400));},_=>break},_=timer.as_mut(),if pending=>{pending=false;let _=relink(&target,&name).await;}}
            }
            let _ = child.kill().await;
            let _ = child.wait().await;
        });
        *self.session.lock().await = Some(Session { cancel, task });
        Ok(())
    }
    pub async fn stop(&self) -> Result<()> {
        if let Some(s) = self.session.lock().await.take() {
            s.cancel.cancel();
            let _ = s.task.await;
        }
        if cfg!(target_os = "linux")
            && let Ok(objects) = dump().await
        {
            for o in objects {
                if props(&o)["node.name"] == Self::name()
                    && let Some(id) = o["id"].as_u64()
                {
                    let _ = run("pw-cli", &["destroy".into(), id.to_string()]).await;
                }
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    // Ported from upstream test/pipewire.test.ts: a cut-down pw-dump with the virtual
    // microphone (10), this app (20, process 500), a browser whose stream is named by its
    // client (30), a mono game (40) and a music player with surround channels (50).
    use super::*;
    use serde_json::json;
    const MIC: &str = "mumh5-share-audio-test";
    fn node(id: u64, props: Value) -> Value {
        json!({"id": id, "type": "PipeWire:Interface:Node", "info": {"props": props}})
    }
    fn client(id: u64, name: &str, pid: u64) -> Value {
        json!({"id": id, "type": "PipeWire:Interface:Client", "info": {"props": {"application.name": name, "application.process.id": pid}}})
    }
    fn port(id: u64, node: u64, direction: &str, channel: &str) -> Value {
        json!({"id": id, "type": "PipeWire:Interface:Port", "info": {"direction": direction, "props": {"node.id": node, "audio.channel": channel}}})
    }
    fn link(id: u64, out: u64, input: u64, node: u64) -> Value {
        json!({"id": id, "type": "PipeWire:Interface:Link", "info": {"output-port-id": out, "input-port-id": input, "input-node-id": node}})
    }
    fn graph() -> Vec<Value> {
        vec![
            node(
                10,
                json!({"node.name": MIC, "media.class": "Audio/Source/Virtual"}),
            ),
            port(11, 10, "input", "FL"),
            port(12, 10, "input", "FR"),
            port(13, 10, "output", "FL"),
            port(14, 10, "output", "FR"),
            client(2, "mumh5", 500),
            node(
                20,
                json!({"media.class": "Stream/Output/Audio", "node.name": "mumh5", "client.id": 2}),
            ),
            port(21, 20, "output", "FL"),
            port(22, 20, "output", "FR"),
            client(3, "Firefox", 600),
            node(
                30,
                json!({"media.class": "Stream/Output/Audio", "node.name": "Firefox", "client.id": 3}),
            ),
            port(31, 30, "output", "FL"),
            port(32, 30, "output", "FR"),
            node(
                40,
                json!({"media.class": "Stream/Output/Audio", "application.name": "Game", "application.process.id": 700}),
            ),
            port(41, 40, "output", "MONO"),
            node(
                50,
                json!({"media.class": "Stream/Output/Audio", "application.name": "Spotify"}),
            ),
            port(51, 50, "output", "FL"),
            port(52, 50, "output", "FR"),
            port(53, 50, "output", "LFE"),
            node(
                60,
                json!({"media.class": "Audio/Sink", "node.name": "speakers"}),
            ),
        ]
    }
    fn own() -> HashSet<u64> {
        HashSet::from([500])
    }
    fn sorted(mut v: Vec<(u64, u64)>) -> Vec<(u64, u64)> {
        v.sort();
        v
    }
    #[test]
    fn lists_programs_without_this_app() {
        assert_eq!(apps(&graph(), &own()), ["Firefox", "Game", "Spotify"]);
    }
    #[test]
    fn whole_system_links_every_program_but_this_app() {
        let (add, remove) = plan(&graph(), &json!({"kind": "all"}), &own(), MIC);
        assert_eq!(
            sorted(add),
            [(31, 11), (32, 12), (41, 11), (41, 12), (51, 11), (52, 12)]
        );
        assert!(remove.is_empty());
    }
    #[test]
    fn one_program_links_only_that_program() {
        let (add, _) = plan(
            &graph(),
            &json!({"kind": "app", "name": "Firefox"}),
            &own(),
            MIC,
        );
        assert_eq!(sorted(add), [(31, 11), (32, 12)]);
    }
    #[test]
    fn existing_links_are_kept_and_stale_ones_removed() {
        let mut linked = graph();
        linked.extend([
            link(90, 31, 11, 10),
            link(91, 51, 11, 10),
            link(92, 21, 60, 60),
        ]);
        let (add, remove) = plan(
            &linked,
            &json!({"kind": "app", "name": "Firefox"}),
            &own(),
            MIC,
        );
        assert_eq!(add, [(32, 12)]);
        // Spotify's link goes; the link to the speakers is none of our business.
        assert_eq!(remove, [91]);
    }
    #[test]
    fn this_app_and_its_webview_children_are_never_linked() {
        let mut g = graph();
        g.push(node(70, json!({"media.class": "Stream/Output/Audio", "application.name": "WebKitWebProcess", "application.process.id": 501})));
        g.push(port(71, 70, "output", "FL"));
        let pids = HashSet::from([500, 501]);
        let (add, _) = plan(&g, &json!({"kind": "all"}), &pids, MIC);
        assert!(add.iter().all(|(out, _)| ![21, 22, 71].contains(out)));
        assert!(!apps(&g, &pids).contains(&"WebKitWebProcess".to_owned()));
    }
    #[test]
    fn nothing_without_the_virtual_microphone() {
        let (add, remove) = plan(&graph()[5..], &json!({"kind": "all"}), &HashSet::new(), MIC);
        assert!(add.is_empty() && remove.is_empty());
    }
    #[test]
    fn stale_microphones_of_gone_processes_are_found() {
        let objects = vec![
            node(1, json!({"node.name": "mumh5-share-audio-111"})),
            node(2, json!({"node.name": "mumh5-share-audio-222"})),
            node(3, json!({"node.name": "mumh5-share-audio"})),
            node(4, json!({"node.name": "speakers"})),
        ];
        assert_eq!(stale(&objects, |pid| pid == 222), [1]);
    }
    #[test]
    fn own_process_tree_contains_this_process() {
        assert!(own_pids().contains(&(std::process::id() as u64)));
    }
}
