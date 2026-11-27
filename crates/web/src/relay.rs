//! Mumpeer links the gateway keeps for browsers. After the connection handshake, text frames of
//! type `relay-open`, `relay-turn`, `relay-lane-close` and `relay-close` (each with a call number
//! `n`) open a pinned TLS link to the relay with the connection's own identity, and hand out each
//! lane as a credential on the gateway's public TURN relay. Answers are `relay-ok`/`relay-fail`;
//! a ready link that ends is reported as `relay-closed`.
use crate::config::Config;
use anyhow::{Result, anyhow, bail};
use mumh5_core::identity::Identity;
use mumh5_platform::{
    mumpeer::{Endpoint, Lanes, Link, LinkOptions},
    turn::{self, LaneIssuer},
};
use serde_json::{Value, json};
use std::{
    collections::{HashMap, VecDeque},
    net::{IpAddr, Ipv6Addr, SocketAddr},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

/// At most this many links per Mumble connection, as in the desktop app.
const MAX_RELAYS: usize = 9;
/// Each relay-open dials out, failed ones included, so a connection gets a budget per minute.
const RELAY_OPENS: usize = 20;
const RELAY_WINDOW: Duration = Duration::from_secs(60);
/// The one answer for every way of not getting through, so errors cannot probe a host.
const UNREACHABLE: &str = "Could not connect to mumpeer";

pub fn is_request_id(v: &Value) -> bool {
    v.as_str()
        .is_some_and(|s| s.len() == 16 && s.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')))
}
pub fn is_relay_token(v: &Value) -> bool {
    v.as_str().is_some_and(|s| {
        s.len() == 43
            && s.bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    })
}
fn dns_name(host: &str) -> bool {
    let host = host.strip_suffix('.').unwrap_or(host);
    !host.is_empty()
        && host.split('.').all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && label
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-')
                && !label.starts_with('-')
                && !label.ends_with('-')
        })
}
fn valid_host(host: &str) -> bool {
    host.len() <= 253
        && if host.contains(':') {
            host.parse::<Ipv6Addr>().is_ok()
        } else {
            dns_name(host)
        }
}
/// Hosts compare without resolving DNS aliases; IPv6 in canonical form.
fn host_key(value: &str) -> Option<String> {
    let host = value.to_ascii_lowercase();
    let host = host.strip_suffix('.').unwrap_or(&host);
    if host.contains(':') {
        let inner = host
            .strip_prefix('[')
            .and_then(|h| h.strip_suffix(']'))
            .unwrap_or(host);
        return inner.parse::<Ipv6Addr>().ok().map(|a| a.to_string());
    }
    valid_host(host).then(|| host.to_owned())
}
pub fn same_relay_host(server: &str, relay: &str) -> bool {
    host_key(server).is_some_and(|h| Some(h) == host_key(relay))
}
pub fn relay_endpoint(v: &Value) -> Option<Endpoint> {
    let host = v["host"].as_str().filter(|h| valid_host(h))?;
    let tcp = v["tcp"].as_u64().filter(|p| (1..=65535).contains(p))? as u16;
    let fp = v["fp"]
        .as_str()
        .filter(|f| f.len() == 64 && f.bytes().all(|b| b.is_ascii_hexdigit()))?;
    Some(Endpoint {
        host: host.into(),
        tcp,
        fp: fp.to_ascii_lowercase(),
    })
}

/// What the gateway knows about the Mumble connection the links belong to.
pub struct Target {
    pub host: String,
    /// Whether the Mumble connection itself was held to public addresses.
    pub guard: bool,
    pub identity: Identity,
}

type Entry = (u64, Option<Arc<Link>>);

/// The links of one Mumble connection. Dropping it (with its token) ends them all.
pub struct Relays {
    config: Arc<Config>,
    issuer: LaneIssuer,
    target: Arc<Target>,
    links: Arc<Mutex<HashMap<String, Entry>>>,
    opens: Mutex<VecDeque<Instant>>,
    next: std::sync::atomic::AtomicU64,
    cancel: CancellationToken,
    events: mpsc::Sender<Value>,
}
impl Relays {
    pub fn new(
        config: Arc<Config>,
        issuer: LaneIssuer,
        target: Target,
        events: mpsc::Sender<Value>,
    ) -> Arc<Self> {
        Arc::new(Self {
            config,
            issuer,
            target: Arc::new(target),
            links: Default::default(),
            opens: Default::default(),
            next: Default::default(),
            cancel: CancellationToken::new(),
            events,
        })
    }
    /// Handles one request frame and answers it on the event channel.
    pub async fn handle(self: Arc<Self>, msg: Value) {
        let n = msg["n"].as_u64();
        let answer = match self.request(&msg).await {
            Ok(result) => json!({"type":"relay-ok","n":n,"result":result}),
            Err(e) => json!({"type":"relay-fail","n":n,"reason":e.to_string()}),
        };
        if n.is_some() {
            let _ = self.events.send(answer).await;
        }
    }
    fn link(&self, rid: &Value) -> Result<Arc<Link>> {
        let links = self
            .links
            .lock()
            .map_err(|_| anyhow!("Relay lock poisoned"))?;
        rid.as_str()
            .filter(|_| is_request_id(rid))
            .and_then(|rid| links.get(rid))
            .and_then(|(_, link)| link.clone())
            .ok_or_else(|| anyhow!("The mumpeer link is unavailable"))
    }
    async fn request(&self, msg: &Value) -> Result<Value> {
        match msg["type"].as_str() {
            Some("relay-open") => self.open(msg).await.map(|_| Value::Null),
            Some("relay-turn") => {
                let link = self.link(&msg["rid"])?;
                let lane = msg["lane"]
                    .as_u64()
                    .filter(|l| *l <= 1)
                    .ok_or_else(|| anyhow!("The mumpeer allocation is unavailable"))?;
                link.turn(lane as u8).await
            }
            Some("relay-lane-close") => {
                let link = self.link(&msg["rid"])?;
                if let Some(lane) = msg["lane"].as_u64().filter(|l| *l <= 1) {
                    link.close_lane(lane as u8).await;
                }
                Ok(Value::Null)
            }
            Some("relay-close") => {
                let link = self.link(&msg["rid"])?;
                if let Ok(mut links) = self.links.lock() {
                    links.remove(msg["rid"].as_str().unwrap_or_default());
                }
                link.close().await;
                Ok(Value::Null)
            }
            _ => bail!("Unknown mumpeer request"),
        }
    }
    async fn open(&self, msg: &Value) -> Result<()> {
        let endpoint = relay_endpoint(&msg["address"]);
        let low = msg["lowSide"].as_bool();
        let (Some(endpoint), Some(low), true, true) = (
            endpoint,
            low,
            is_request_id(&msg["rid"]),
            is_relay_token(&msg["token"]),
        ) else {
            bail!("Invalid mumpeer connection");
        };
        let rid = msg["rid"].as_str().unwrap_or_default().to_owned();
        let same_host = same_relay_host(&self.target.host, &endpoint.host);
        if !same_host && !self.config.allow_any {
            bail!("This proxy only allows a relay on the Mumble server host");
        }
        if !self.config.mumpeer_ports.contains(&endpoint.tcp) {
            bail!("This proxy does not allow that relay port");
        }
        // The relay is the Mumble server's own host, or any host this gateway would reach for a user.
        let guard = if same_host {
            self.target.guard
        } else {
            !self.config.allow_private
        };
        if guard && endpoint.host.parse::<IpAddr>().is_ok_and(turn::private) {
            bail!("This proxy does not connect to private addresses");
        }
        let id = self.next.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        {
            let mut links = self
                .links
                .lock()
                .map_err(|_| anyhow!("Relay lock poisoned"))?;
            if links.contains_key(&rid) {
                bail!("That mumpeer connection is already open");
            }
            if links.len() >= MAX_RELAYS {
                bail!("Too many mumpeer connections");
            }
            let mut opens = self
                .opens
                .lock()
                .map_err(|_| anyhow!("Relay lock poisoned"))?;
            while opens.front().is_some_and(|t| t.elapsed() >= RELAY_WINDOW) {
                opens.pop_front();
            }
            if opens.len() >= RELAY_OPENS {
                bail!("Too many mumpeer connections, try again in a minute");
            }
            opens.push_back(Instant::now());
            links.insert(rid.clone(), (id, None));
        }
        let result = self.dial(&rid, id, endpoint, guard, low, msg).await;
        let mut links = self
            .links
            .lock()
            .map_err(|_| anyhow!("Relay lock poisoned"))?;
        match result {
            Ok(link)
                if !link.cancel.is_cancelled() && links.get(&rid).is_some_and(|e| e.0 == id) =>
            {
                links.insert(rid, (id, Some(link)));
                Ok(())
            }
            Ok(link) => {
                if links.get(&rid).is_some_and(|e| e.0 == id) {
                    links.remove(&rid);
                }
                link.cancel.cancel();
                bail!(UNREACHABLE)
            }
            Err(e) => {
                if links.get(&rid).is_some_and(|e| e.0 == id) {
                    links.remove(&rid);
                }
                Err(e)
            }
        }
    }
    async fn dial(
        &self,
        rid: &str,
        id: u64,
        endpoint: Endpoint,
        guard: bool,
        low: bool,
        msg: &Value,
    ) -> Result<Arc<Link>> {
        let addresses: Vec<SocketAddr> = match tokio::time::timeout(
            Duration::from_secs(10),
            tokio::net::lookup_host((endpoint.host.as_str(), endpoint.tcp)),
        )
        .await
        {
            Ok(Ok(a)) => a.collect(),
            _ => bail!(UNREACHABLE),
        };
        let Some(address) = addresses.first().copied() else {
            bail!(UNREACHABLE);
        };
        if guard && addresses.iter().any(|a| turn::private(a.ip())) {
            bail!(UNREACHABLE);
        }
        let links = self.links.clone();
        let events = self.events.clone();
        let closed_rid = rid.to_owned();
        let link = Link::open_with(
            endpoint,
            msg["token"].as_str().unwrap_or_default().to_owned(),
            self.target.identity.clone(),
            low,
            self.cancel.clone(),
            move |reason| {
                // Only a link that became ready says that it closed; before that, open answers.
                let ready = links.lock().is_ok_and(|mut links| {
                    let mine = links
                        .get(&closed_rid)
                        .is_some_and(|(e, link)| *e == id && link.is_some());
                    if links.get(&closed_rid).is_some_and(|(e, _)| *e == id) {
                        links.remove(&closed_rid);
                    }
                    mine
                });
                if ready {
                    let _ = events
                        .try_send(json!({"type":"relay-closed","rid":closed_rid,"reason":reason}));
                }
            },
            LinkOptions {
                lanes: Lanes::Public {
                    issuer: self.issuer.clone(),
                    extra: self.config.turn_urls.clone(),
                },
                address: Some(address),
            },
        )
        .await;
        // A relay that identified itself (a pinned certificate) and refused is the user's to see.
        link.map_err(|e| {
            let reason = e.to_string();
            if reason.starts_with("Mumpeer refused the link") {
                e
            } else {
                anyhow!(UNREACHABLE)
            }
        })
    }
}
impl Drop for Relays {
    fn drop(&mut self) {
        // Links are dropped first so their close sends nothing.
        if let Ok(mut links) = self.links.lock() {
            links.clear();
        }
        self.cancel.cancel();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_requests_like_the_frontend() {
        assert!(is_request_id(&json!("0123456789abcdef")));
        assert!(!is_request_id(&json!("0123456789ABCDEF")));
        assert!(!is_request_id(&json!(12)));
        assert!(is_relay_token(&json!("a".repeat(43))));
        assert!(!is_relay_token(&json!("a".repeat(42))));
        assert!(!is_relay_token(&json!(format!("{}=", "a".repeat(42)))));
        let fp = "AB".repeat(32);
        let e = relay_endpoint(&json!({"host":"relay.example","tcp":443,"fp":fp})).unwrap();
        assert_eq!(
            (e.host.as_str(), e.tcp, e.fp),
            ("relay.example", 443, "ab".repeat(32))
        );
        assert!(relay_endpoint(&json!({"host":"::1","tcp":443,"fp":"ab".repeat(32)})).is_some());
        for bad in [
            json!({"host":"-bad.example","tcp":443,"fp":"ab".repeat(32)}),
            json!({"host":"relay.example","tcp":0,"fp":"ab".repeat(32)}),
            json!({"host":"relay.example","tcp":443,"fp":"ab"}),
            json!({"host":"a b","tcp":443,"fp":"ab".repeat(32)}),
        ] {
            assert!(relay_endpoint(&bad).is_none(), "{bad}");
        }
    }
    #[test]
    fn same_host_ignores_case_trailing_dots_and_ipv6_spelling() {
        assert!(same_relay_host("Voice.Example.", "voice.example"));
        assert!(same_relay_host("[2001:db8::1]", "2001:db8:0:0::1"));
        assert!(!same_relay_host("voice.example", "relay.voice.example"));
        assert!(!same_relay_host("", ""));
    }
}
