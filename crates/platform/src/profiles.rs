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
        let file = directory.join("profile.json");
        let mut fresh = !file.exists();
        let mut p: Self = match std::fs::read(&file) {
            Ok(v) => match serde_json::from_slice(&v) {
                Ok(p) => p,
                Err(e) => {
                    // Never refuse to start: keep the damaged file for recovery and begin anew.
                    let aside = directory.join(format!(
                        "profile.json.damaged-{}",
                        uuid::Uuid::new_v4().simple()
                    ));
                    std::fs::rename(&file, &aside)?;
                    eprintln!(
                        "mumh5: profile.json is damaged ({e}); kept as {} and starting a new profile",
                        aside.display()
                    );
                    fresh = true;
                    Self::default()
                }
            },
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Self::default(),
            Err(e) => return Err(e.into()),
        };
        p.directory = directory;
        if fresh {
            let source = p.directory.clone();
            if has_legacy(&source) {
                p.import_logged(&source);
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
                if source != p.directory && has_legacy(&source) {
                    p.import_logged(&source);
                }
            }
            // Written even when nothing could be imported, so a bad legacy file is read only once.
            p.save()?;
        }
        Ok(p)
    }
    fn import_logged(&mut self, source: &Path) {
        for problem in self.import_legacy(source) {
            eprintln!("mumh5: legacy profile {}: {problem}", source.display());
        }
    }
    /// Copy the previous desktop profile without changing its files or identity IDs. Damaged
    /// pieces are skipped and reported; whatever is readable is still imported.
    pub fn import_legacy(&mut self, source: &Path) -> Vec<String> {
        let mut problems = vec![];
        if let Err(e) = self.import_identities(source, &mut problems) {
            problems.push(format!("identities skipped: {e:#}"));
        }
        // The previous app kept a backup of saved-state.json and read it when the file was damaged.
        let state = [
            source.join("saved-state.json"),
            source.join("saved-state.json.bak"),
        ]
        .into_iter()
        .filter(|f| f.is_file())
        .find_map(|f| match read_saved_state(&f) {
            Ok(values) => Some(values),
            Err(e) => {
                problems.push(format!("{} skipped: {e:#}", f.display()));
                None
            }
        });
        for (k, v) in state.unwrap_or_default() {
            self.state.entry(k).or_insert(v);
        }
        if let Err(e) = self.import_sounds(source, &mut problems) {
            problems.push(format!("sounds skipped: {e:#}"));
        }
        problems
    }
    fn import_identities(&mut self, source: &Path, problems: &mut Vec<String>) -> Result<()> {
        let path = source.join("identities.json");
        if path.is_file() {
            let data = serde_json::from_slice::<Value>(&std::fs::read(&path)?)
                .with_context(|| format!("Invalid identity store: {}", path.display()))?;
            for (n, entry) in data["identities"]
                .as_array()
                .context("Invalid identity list")?
                .iter()
                .enumerate()
            {
                let parsed = (|| -> Result<(String, Identity)> {
                    let identity: Identity = serde_json::from_value(entry.clone())?;
                    certificates::fresh(&identity)?;
                    let id = entry["id"]
                        .as_str()
                        .context("Missing identity ID")?
                        .to_owned();
                    Ok((id, identity))
                })();
                match parsed {
                    Ok((id, identity)) => {
                        if !self.identities.iter().any(|e| e.id == id) {
                            self.identities.push(Entry {
                                id,
                                name: entry["name"].as_str().unwrap_or("My identity").into(),
                                identity,
                            });
                        }
                    }
                    Err(e) => problems.push(format!("identity {n} skipped: {e:#}")),
                }
            }
            if self.default_id.is_none() {
                self.default_id = data["defaultId"]
                    .as_str()
                    .filter(|d| self.identities.iter().any(|e| e.id == *d))
                    .map(str::to_owned)
                    .or_else(|| self.identities.first().map(|e| e.id.clone()));
            }
            self.setup_done |= data["setupDone"].as_bool().unwrap_or(false);
        } else if source.join("identity.json").is_file() && self.identities.is_empty() {
            let identity: Identity =
                serde_json::from_slice(&std::fs::read(source.join("identity.json"))?)?;
            certificates::fresh(&identity)?;
            self.add("My identity".into(), identity)?;
        }
        Ok(())
    }
    fn import_sounds(&mut self, source: &Path, problems: &mut Vec<String>) -> Result<()> {
        let target = self.directory.join("sounds");
        std::fs::create_dir_all(&target)?;
        if source.join("sounds.json").is_file() && !target.join("settings.json").exists() {
            let raw = std::fs::read(source.join("sounds.json"))?;
            if serde_json::from_slice::<Value>(&raw).is_ok() {
                private_write(&target.join("settings.json"), &raw)?;
            } else {
                // The previous app rebuilt the list from the files on disk; so does this one.
                problems.push("sounds.json is damaged; sound files are still copied".into());
            }
        }
        use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
        let mut files = Vec::new();
        let dir = source.join("sounds");
        if dir.is_dir() {
            for entry in std::fs::read_dir(&dir)?.flatten() {
                let name = entry.file_name().to_string_lossy().into_owned();
                if name == "pack.zip" {
                    files.push(("pack".into(), entry.path()));
                } else if let Some(stem) = name.strip_suffix(".audio") {
                    files.push((format!("sound:{stem}"), entry.path()));
                }
            }
        }
        if dir.join("packs").is_dir() {
            for entry in std::fs::read_dir(dir.join("packs"))?.flatten() {
                let name = entry.file_name().to_string_lossy().into_owned();
                if let Some(stem) = name.strip_suffix(".zip") {
                    files.push((format!("pack:{stem}"), entry.path()));
                }
            }
        }
        for (key, path) in files {
            let dest = target.join(format!("{}.bin", URL_SAFE_NO_PAD.encode(&key)));
            if !dest.exists()
                && let Err(e) = std::fs::read(&path)
                    .map_err(anyhow::Error::from)
                    .and_then(|b| private_write(&dest, &b))
            {
                problems.push(format!("{} skipped: {e:#}", path.display()));
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
fn has_legacy(source: &Path) -> bool {
    [
        "identities.json",
        "identity.json",
        "saved-state.json",
        "saved-state.json.bak",
        "sounds.json",
        "sounds",
    ]
    .iter()
    .any(|f| source.join(f).exists())
}
/// Reads the previous app's `{"version":1,"values":{key: raw}}` saved state.
fn read_saved_state(file: &Path) -> Result<BTreeMap<String, String>> {
    let data: Value = serde_json::from_slice(&std::fs::read(file)?)?;
    let values = data["values"].as_object().context("No saved values")?;
    Ok(values
        .iter()
        .filter_map(|(k, v)| Some((k.clone(), v.as_str()?.to_owned())))
        .collect())
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
        // Exactly what electron/identity-store.ts wrote (StoredIdentity entries in a StoreFile).
        let entry = json!({"id":"registered-identity-id","name":"Registered","certPem":identity.cert_pem,"keyPem":identity.key_pem,"fingerprint":"00","createdAt":"2026-01-01T00:00:00.000Z"});
        let identities = serde_json::to_vec(
            &json!({"identities":[entry],"defaultId":"registered-identity-id","setupDone":true}),
        )?;
        private_write(&old.join("identities.json"), &identities)?;
        private_write(
            &old.join("saved-state.json"),
            br#"{"version":1,"values":{"mumh5.servers":"[{\"host\":\"voice.example\"}]","mumh5.pins":"{}"}}"#,
        )?;
        private_write(&old.join("sounds.json"), br#"{"volume":0.5}"#)?;
        private_write(&old.join("sounds/message.audio"), b"custom audio")?;
        let mut profile = Profile::open(new.clone())?;
        assert!(profile.import_legacy(&old).is_empty());
        profile.save()?;
        assert!(profile.import_legacy(&old).is_empty());
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
    #[test]
    fn damaged_legacy_files_are_skipped_and_startup_continues() -> Result<()> {
        let dir = std::env::temp_dir().join(format!("mumh5-damaged-{}", uuid::Uuid::new_v4()));
        let old = dir.join("old");
        std::fs::create_dir_all(old.join("sounds"))?;
        let good = certificates::create("Good", "")?;
        let identities = json!({"identities":[
            {"id":"broken","name":"Broken","certPem":"not a certificate","keyPem":"nope"},
            {"name":"No id","certPem":good.cert_pem,"keyPem":good.key_pem},
            {"id":"good","name":"Good","certPem":good.cert_pem,"keyPem":good.key_pem}
        ],"defaultId":"broken","setupDone":true});
        private_write(
            &old.join("identities.json"),
            &serde_json::to_vec(&identities)?,
        )?;
        // A damaged main file falls back to the backup, as the previous app did.
        private_write(&old.join("saved-state.json"), b"{truncated")?;
        private_write(
            &old.join("saved-state.json.bak"),
            br#"{"version":1,"values":{"mumh5.tokens":"{}"}}"#,
        )?;
        private_write(&old.join("sounds.json"), b"[[[")?;
        private_write(&old.join("sounds/join.audio"), b"join")?;
        let mut profile = Profile::open(dir.join("new"))?;
        let problems = profile.import_legacy(&old);
        assert_eq!(problems.len(), 4, "{problems:?}");
        assert_eq!(profile.identities.len(), 1);
        assert_eq!(profile.default_id.as_deref(), Some("good"));
        assert_eq!(profile.state["mumh5.tokens"], "{}");
        assert!(!dir.join("new/sounds/settings.json").exists());
        // A damaged profile.json no longer stops the app; it is kept beside the new one.
        std::fs::write(dir.join("new/profile.json"), b"{oops")?;
        let reopened = Profile::open(dir.join("new"))?;
        assert!(reopened.identities.is_empty());
        assert!(std::fs::read_dir(dir.join("new"))?.flatten().any(|e| {
            e.file_name()
                .to_string_lossy()
                .starts_with("profile.json.damaged-")
        }));
        std::fs::remove_dir_all(dir)?;
        Ok(())
    }
}
