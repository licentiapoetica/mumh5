//! Private atomic profile storage. Callers serialize mutations with the profile mutex.
use crate::certificates;
use anyhow::{Context, Result, bail};
use dream_cord_core::identity::Identity;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
};
#[derive(Serialize, Deserialize)]
struct Entry {
    id: String,
    name: String,
    identity: Identity,
}
#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    #[serde(skip)]
    pub directory: PathBuf,
    identities: Vec<Entry>,
    default_id: Option<String>,
    setup_done: bool,
    #[serde(default)]
    pub state: BTreeMap<String, String>,
}
impl Profile {
    pub fn open(directory: PathBuf) -> Result<Self> {
        std::fs::create_dir_all(&directory)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o700))?;
        }
        let mut p: Self = match std::fs::read(directory.join("profile.json")) {
            Ok(v) => {
                serde_json::from_slice(&v).context("Invalid profile.json; restore your backup")?
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Self::default(),
            Err(e) => return Err(e.into()),
        };
        p.directory = directory;
        Ok(p)
    }
    pub fn save(&self) -> Result<()> {
        private_write(
            &self.directory.join("profile.json"),
            &serde_json::to_vec(self)?,
        )
    }
    fn summary(&self, e: &Entry) -> Result<Value> {
        let f = certificates::fresh(&e.identity)?;
        Ok(
            json!({"id":e.id,"name":e.name,"fingerprint":f["fingerprint"],"cert":f["cert"],"isDefault":self.default_id.as_ref()==Some(&e.id)}),
        )
    }
    pub fn list(&self) -> Result<Value> {
        Ok(
            json!({"identities":self.identities.iter().map(|e|self.summary(e)).collect::<Result<Vec<_>>>()?,"setupDone":self.setup_done}),
        )
    }
    pub fn add(&mut self, name: String, identity: Identity) -> Result<Value> {
        let fp = certificates::fresh(&identity)?["fingerprint"].clone();
        for e in &self.identities {
            if certificates::fresh(&e.identity)?["fingerprint"] == fp {
                bail!("This identity is already stored as {}", e.name);
            }
        }
        let id = uuid::Uuid::new_v4().to_string();
        if self.default_id.is_none() {
            self.default_id = Some(id.clone());
        }
        self.identities.push(Entry { id, name, identity });
        self.save()?;
        self.summary(self.identities.last().unwrap())
    }
    pub fn identity(&mut self, id: Option<&str>) -> Result<Identity> {
        if self.identities.is_empty() {
            self.add(
                "My identity".into(),
                certificates::create("Dream Cord user", "")?,
            )?;
        }
        if let Some(id) = id {
            return Ok(self
                .identities
                .iter()
                .find(|e| e.id == id)
                .context("Unknown identity")?
                .identity
                .clone());
        }
        Ok(self
            .identities
            .iter()
            .find(|e| Some(&e.id) == self.default_id.as_ref())
            .unwrap_or(&self.identities[0])
            .identity
            .clone())
    }
    pub fn change(&mut self, action: &str, id: &str, name: &str) -> Result<Value> {
        if action == "finishSetup" {
            self.setup_done = true;
        } else {
            let n = self
                .identities
                .iter()
                .position(|e| e.id == id)
                .context("Unknown identity")?;
            match action {
                "setDefault" => self.default_id = Some(id.into()),
                "rename" => self.identities[n].name = name.trim().chars().take(256).collect(),
                "remove" => {
                    self.identities.remove(n);
                    if self.default_id.as_deref() == Some(id) {
                        self.default_id = self.identities.first().map(|e| e.id.clone());
                    }
                }
                _ => bail!("Unknown identity action"),
            }
        }
        self.save()?;
        Ok(Value::Null)
    }
    pub fn state_write(&mut self, key: String, raw: String) -> Result<()> {
        if key.len() > 128 || raw.len() > 4 * 1024 * 1024 {
            bail!("Saved state is too large");
        }
        self.state.insert(key, raw);
        self.save()
    }
}
pub fn private_write(path: &Path, bytes: &[u8]) -> Result<()> {
    use std::io::Write;
    let tmp = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    let mut o = std::fs::OpenOptions::new();
    o.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        o.mode(0o600);
    }
    let mut file = o.open(&tmp)?;
    let result = (|| -> Result<()> {
        file.write_all(bytes)?;
        file.sync_all()?;
        std::fs::rename(&tmp, path)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(tmp);
    }
    result
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn profile_and_backups_round_trip() {
        let dir = std::env::temp_dir().join(format!("dream-profile-{}", uuid::Uuid::new_v4()));
        let mut p = Profile::open(dir.clone()).unwrap();
        let i = certificates::create("Bot", "bot@example.com").unwrap();
        let backup = certificates::export(&i, "secret", "Bot").unwrap();
        assert!(certificates::import(&backup, "wrong").is_err());
        let imported = certificates::import(&backup, "secret").unwrap();
        let s = p.add("Bot".into(), imported).unwrap();
        assert!(p.add("Duplicate".into(), i).is_err());
        p.state_write("servers".into(), "[]".into()).unwrap();
        let mut p = Profile::open(dir.clone()).unwrap();
        assert_eq!(
            p.list().unwrap()["identities"][0]["fingerprint"],
            s["fingerprint"]
        );
        p.change("remove", s["id"].as_str().unwrap(), "").unwrap();
        assert_eq!(p.list().unwrap()["identities"].as_array().unwrap().len(), 0);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
