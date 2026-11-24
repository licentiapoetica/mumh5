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
fn own_pids() -> HashSet<u64> {
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
        for _ in 0..20 {
            if dump().await?.iter().any(|o| props(o)["node.name"] == name) {
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
        let mut lines =
            BufReader::new(child.stdout.take().context("No PipeWire monitor output")?).lines();
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
