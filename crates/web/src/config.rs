use anyhow::{Context, Result, bail};
use mumh5_platform::turn;
use serde::Serialize;
use std::{
    net::{IpAddr, SocketAddr},
    path::PathBuf,
};
#[derive(Clone, Serialize)]
pub struct Server {
    pub host: String,
    pub port: u16,
    pub label: String,
}
pub fn servers(raw: &str) -> Result<Vec<Server>> {
    raw.split(',')
        .filter(|s| !s.trim().is_empty())
        .map(|s| {
            let (addr, label) = s.trim().split_once('=').unwrap_or((s.trim(), ""));
            let (host, port) = if addr.starts_with('[') {
                let end = addr.find(']').context("Unclosed IPv6 server")?;
                let port = addr[end + 1..].strip_prefix(':').unwrap_or("64738");
                (&addr[1..end], port)
            } else {
                addr.split_once(':').unwrap_or((addr, "64738"))
            };
            let host = host.trim().to_lowercase();
            let port = port.parse::<u16>()?;
            if host.is_empty() || host.len() > 253 || port == 0 {
                bail!("Invalid Mumble target");
            }
            Ok(Server {
                label: if label.trim().is_empty() {
                    host.clone()
                } else {
                    label.trim().into()
                },
                host,
                port,
            })
        })
        .collect()
}
#[derive(Clone)]
pub struct Config {
    pub bind: SocketAddr,
    pub servers: Vec<Server>,
    pub default: Option<Server>,
    pub allow_any: bool,
    pub allow_private: bool,
    pub origins: Vec<String>,
    pub trust_proxy: bool,
    pub send_proxy: bool,
    pub assets: PathBuf,
    pub turn: Option<turn::Options>,
    pub turn_urls: Vec<String>,
    pub max_connections: usize,
    pub max_per_address: usize,
    pub audio_limits: serde_json::Value,
    /// TLS ports the gateway dials for a mumpeer relay. Browsers name the port, so without this
    /// list a listed private server would make the gateway a port scanner of its own host.
    pub mumpeer_ports: Vec<u16>,
    pub debug: bool,
}
impl Config {
    pub fn from_env() -> Result<Self> {
        Self::from(|k| std::env::var(k).ok().filter(|v| !v.is_empty()))
    }
    fn from(env: impl Fn(&str) -> Option<String>) -> Result<Self> {
        let value = |k: &str, default: &str| env(k).unwrap_or(default.into());
        let on = |k: &str| matches!(env(k).as_deref(), Some("1" | "true"));
        let count = |k: &str, n: usize| -> Result<usize> {
            let n = value(k, &n.to_string()).parse::<usize>()?;
            if n == 0 {
                bail!("{k} must be positive");
            }
            Ok(n)
        };
        let mut servers = servers(&value("MUMH5_SERVERS", ""))?;
        let default = servers::parse_default(&value("MUMH5_DEFAULT_SERVER", ""), &mut servers)?;
        let port = value("MUMH5_PORT", "8080").parse::<u16>()?;
        let ip = value("MUMH5_BIND", "127.0.0.1").parse::<IpAddr>()?;
        let stun = value("MUMH5_STUN_PORT", "3478").parse::<u16>()?;
        let (min, max) = value("MUMH5_TURN_PORTS", "49160-49659")
            .split_once('-')
            .map(|(a, b)| (a.to_owned(), b.to_owned()))
            .context("Use MUMH5_TURN_PORTS=MIN-MAX")?;
        let turn = if stun == 0 {
            None
        } else {
            Some(turn::Options {
                bind: SocketAddr::new(value("MUMH5_STUN_BIND", "0.0.0.0").parse()?, stun),
                relay: !matches!(env("MUMH5_TURN").as_deref(), Some("0" | "false")),
                public_ip: env("MUMH5_TURN_IP").map(|v| v.parse()).transpose()?,
                min_port: min.parse()?,
                max_port: max.parse()?,
                max_allocations: count("MUMH5_TURN_MAX", 500)?,
                max_per_address: count("MUMH5_TURN_PER_ADDRESS", 64)?,
                allow_private: false,
            })
        };
        Ok(Self {
            bind: SocketAddr::new(ip, port),
            servers,
            default,
            allow_any: on("MUMH5_ALLOW_ANY"),
            allow_private: on("MUMH5_ALLOW_PRIVATE"),
            origins: value("MUMH5_ORIGINS", "")
                .split(',')
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_owned)
                .collect(),
            trust_proxy: on("MUMH5_TRUST_PROXY"),
            send_proxy: on("MUMH5_SEND_PROXY"),
            assets: value("MUMH5_STATIC", "frontend/dist").into(),
            turn,
            turn_urls: value("MUMH5_TURN_URLS", "")
                .split(',')
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_owned)
                .collect(),
            max_connections: count("MUMH5_MAX_CONNECTIONS", 200)?,
            max_per_address: count("MUMH5_MAX_PER_ADDRESS", 8)?,
            audio_limits: serde_json::json!({"file":count("MUMH5_MAX_AUDIO_FILE_MB",4)?.checked_mul(1048576).context("Audio file limit overflow")?,"pack":count("MUMH5_MAX_AUDIO_PACK_MB",32)?.checked_mul(1048576).context("Audio pack limit overflow")?,"unpacked":count("MUMH5_MAX_AUDIO_UNPACKED_MB",64)?.checked_mul(1048576).context("Audio unpacked limit overflow")?}),
            debug: on("MUMH5_DEBUG"),
            mumpeer_ports: match env("MUMH5_MUMPEER_PORTS") {
                Some(raw) => raw
                    .split(',')
                    .filter_map(|p| p.trim().parse::<u16>().ok())
                    .filter(|p| *p > 0)
                    .collect(),
                None => vec![443],
            },
        })
    }
    pub fn listed(&self, host: &str, port: u16) -> bool {
        self.servers
            .iter()
            .any(|s| s.host.eq_ignore_ascii_case(host) && s.port == port)
    }
    pub async fn address(&self, host: &str, port: u16) -> Result<SocketAddr> {
        if port == 0 || (!self.allow_any && !self.listed(host, port)) {
            bail!("Server is not permitted by this gateway");
        }
        let addresses: Vec<_> = tokio::time::timeout(
            std::time::Duration::from_secs(10),
            tokio::net::lookup_host((host, port)),
        )
        .await??
        .collect();
        if addresses.is_empty() {
            bail!("Server has no addresses");
        }
        if !self.allow_private
            && !self.listed(host, port)
            && addresses.iter().any(|a| turn::private(a.ip()))
        {
            bail!("Private server address is not permitted");
        }
        Ok(addresses[0])
    }
}
mod servers {
    use super::*;
    pub fn parse_default(raw: &str, list: &mut Vec<Server>) -> Result<Option<Server>> {
        let mut d = super::servers(raw)?;
        if d.len() > 1 {
            bail!("MUMH5_DEFAULT_SERVER takes one server");
        }
        let Some(mut d) = d.pop() else {
            return Ok(None);
        };
        if let Some(s) = list
            .iter_mut()
            .find(|s| s.host == d.host && s.port == d.port)
        {
            if d.label == d.host {
                d.label = s.label.clone();
            } else {
                *s = d.clone();
            }
        } else {
            list.push(d.clone());
        }
        Ok(Some(d))
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preserves_operator_config() {
        let c = Config::from(|k| match k {
            "MUMH5_SERVERS" => Some("voice.example=Main,[::1]:64739=Local".into()),
            "MUMH5_DEFAULT_SERVER" => Some("voice.example".into()),
            _ => None,
        })
        .unwrap();
        assert_eq!(c.servers.len(), 2);
        assert_eq!(c.default.unwrap().label, "Main");
        assert!(!c.allow_private);
        assert!(c.turn.unwrap().relay);
        assert!(Config::from(|k| (k == "MUMH5_MAX_AUDIO_FILE_MB").then(|| "0".into())).is_err());
        assert_eq!(c.mumpeer_ports, [443]);
        let ports = Config::from(|k| (k == "MUMH5_MUMPEER_PORTS").then(|| "8443, x,0,443".into()));
        assert_eq!(ports.unwrap().mumpeer_ports, [8443, 443]);
    }
}
