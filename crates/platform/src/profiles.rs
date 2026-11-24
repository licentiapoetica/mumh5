//! Private atomic profile storage. Callers serialize mutations with the profile mutex.
use crate::certificates;
use anyhow::{Context, Result, bail};
use mumh5_core::identity::Identity;
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
        let fresh = !directory.join("profile.json").exists();
        let mut p: Self = match std::fs::read(directory.join("profile.json")) {
            Ok(v) => {
                serde_json::from_slice(&v).context("Invalid profile.json; restore your backup")?
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Self::default(),
            Err(e) => return Err(e.into()),
        };
        p.directory = directory;
        if fresh {
            {
                let source = p.directory.clone();
                if source.join("identities.json").is_file()
                    || source.join("saved-state.json").is_file()
                    || source.join("identity.json").is_file()
                {
                    p.import_legacy(&source)?;
                }
            }
            if !p.identities.is_empty() || !p.state.is_empty() {
                p.save()?;
            }
        }
        Ok(p)
    }
    pub fn open_migrating(directory: PathBuf) -> Result<Self> {
        let fresh = !directory.join("profile.json").exists();
        let mut p = Self::open(directory)?;
        if fresh {
            for source in legacy_directories() {
                if source != p.directory
                    && (source.join("identities.json").is_file()
                        || source.join("identity.json").is_file()
                        || source.join("saved-state.json").is_file())
                {
                    p.import_legacy(&source)?;
                }
            }
            p.save()?;
        }
        Ok(p)
    }
    /// Copy the previous desktop profile without changing its files or identity IDs.
    pub fn import_legacy(&mut self, source: &Path) -> Result<()> {
        let path = source.join("identities.json");
        let data = if path.is_file() {
            Some(
                serde_json::from_slice::<Value>(&std::fs::read(&path)?)
                    .with_context(|| format!("Invalid identity store: {}", path.display()))?,
            )
        } else {
            None
        };
        if let Some(data) = data {
            for entry in data["identities"]
                .as_array()
                .context("Invalid identity list")?
            {
                let identity: Identity = serde_json::from_value(entry.clone())?;
                certificates::fresh(&identity)?;
                let id = entry["id"]
                    .as_str()
                    .context("Missing identity ID")?
                    .to_owned();
                if !self.identities.iter().any(|e| e.id == id) {
                    self.identities.push(Entry {
                        id,
                        name: entry["name"].as_str().unwrap_or("My identity").into(),
                        identity,
                    });
                }
            }
            if self.default_id.is_none() {
                self.default_id = data["defaultId"].as_str().map(str::to_owned);
            }
            self.setup_done |= data["setupDone"].as_bool().unwrap_or(false);
        } else if source.join("identity.json").is_file() && self.identities.is_empty() {
            let identity: Identity =
                serde_json::from_slice(&std::fs::read(source.join("identity.json"))?)?;
            self.add("My identity".into(), identity)?;
        }
        let state = source.join("saved-state.json");
        if state.is_file() {
            let data: Value = serde_json::from_slice(&std::fs::read(state)?)?;
            if let Some(values) = data["values"].as_object() {
                for (k, v) in values {
                    if let Some(raw) = v.as_str() {
                        self.state.entry(k.clone()).or_insert_with(|| raw.into());
                    }
                }
            }
        }
        let target = self.directory.join("sounds");
        std::fs::create_dir_all(&target)?;
        if source.join("sounds.json").is_file() && !target.join("settings.json").exists() {
            private_write(
                &target.join("settings.json"),
                &std::fs::read(source.join("sounds.json"))?,
            )?;
        }
        use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
        let mut files = Vec::new();
        let dir = source.join("sounds");
        if dir.is_dir() {
            for entry in std::fs::read_dir(&dir)? {
                let entry = entry?;
                let path = entry.path();
                let name = entry.file_name().to_string_lossy().into_owned();
                if name == "pack.zip" {
                    files.push(("pack".into(), path));
                } else if name.ends_with(".audio") {
                    files.push((format!("sound:{}", name.trim_end_matches(".audio")), path));
                }
            }
        }
        if dir.join("packs").is_dir() {
            for entry in std::fs::read_dir(dir.join("packs"))? {
                let entry = entry?;
                let name = entry.file_name().to_string_lossy().into_owned();
                if name.ends_with(".zip") {
                    files.push((
                        format!("pack:{}", name.trim_end_matches(".zip")),
                        entry.path(),
                    ));
                }
            }
        }
        for (key, path) in files {
            let dest = target.join(format!("{}.bin", URL_SAFE_NO_PAD.encode(key)));
            if !dest.exists() {
                private_write(&dest, &std::fs::read(path)?)?;
            }
        }
        Ok(())
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
                certificates::create("mumh5 user", "")?,
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
        if key.len() > 128 || raw.len() > 16 * 1024 * 1024 {
            bail!("Saved state is too large");
        }
        self.state.insert(key, raw);
        self.save()
    }
}
pub fn legacy_directories() -> Vec<PathBuf> {
    let mut paths = vec![];
    if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
        paths.push(home.join(".config/mumh5"));
        paths.push(home.join("Library/Application Support/mumh5"));
    }
    if let Some(config) = std::env::var_os("XDG_CONFIG_HOME").map(PathBuf::from) {
        paths.push(config.join("mumh5"));
    }
    if let Some(data) = std::env::var_os("APPDATA").map(PathBuf::from) {
        paths.push(data.join("mumh5"));
    }
    paths
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

#[cfg(test)]
mod migration_tests {
    use super::*;
    #[test]
    fn copies_identity_ids_default_servers_and_sounds_without_mutating_old_profile() -> Result<()> {
        let dir = std::env::temp_dir().join(format!("mumh5-migration-{}", uuid::Uuid::new_v4()));
        let old = dir.join("old");
        let new = dir.join("new");
        std::fs::create_dir_all(old.join("sounds/packs"))?;
        let identity = certificates::create("Existing user", "")?;
        let mut entry = serde_json::to_value(&identity)?;
        entry["id"] = json!("registered-identity-id");
        entry["name"] = json!("Registered");
        let identities = serde_json::to_vec(
            &json!({"identities":[entry],"defaultId":"registered-identity-id","setupDone":true}),
        )?;
        private_write(&old.join("identities.json"), &identities)?;
        private_write(
            &old.join("saved-state.json"),
            br#"{"values":{"mumh5.servers":"[{\"host\":\"voice.example\"}]","mumh5.pins":"{}"}}"#,
        )?;
        private_write(&old.join("sounds.json"), br#"{"volume":0.5}"#)?;
        private_write(&old.join("sounds/message.audio"), b"custom audio")?;
        let mut profile = Profile::open(new.clone())?;
        profile.import_legacy(&old)?;
        profile.save()?;
        profile.import_legacy(&old)?;
        assert_eq!(profile.identities.len(), 1);
        assert_eq!(
            profile.default_id.as_deref(),
            Some("registered-identity-id")
        );
        assert!(profile.setup_done);
        assert!(profile.state["mumh5.servers"].contains("voice.example"));
        assert_eq!(profile.identity(None)?.cert_pem, identity.cert_pem);
        assert_eq!(std::fs::read(old.join("identities.json"))?, identities);
        assert!(new.join("sounds/settings.json").is_file());
        use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
        assert_eq!(
            std::fs::read(
                new.join("sounds")
                    .join(format!("{}.bin", URL_SAFE_NO_PAD.encode("sound:message")))
            )?,
            b"custom audio"
        );
        std::fs::remove_dir_all(dir)?;
        Ok(())
    }
}
