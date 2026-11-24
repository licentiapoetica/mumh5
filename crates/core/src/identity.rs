use anyhow::{Context, Result, bail};
use openssl::{
    asn1::Asn1Time,
    bn::{BigNum, MsbOption},
    hash::MessageDigest,
    pkey::PKey,
    rsa::Rsa,
    ssl::{SslConnector, SslMethod, SslVerifyMode},
    x509::{X509, X509NameBuilder},
};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, path::Path};
use tokio::fs;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Identity {
    pub cert_pem: String,
    pub key_pem: String,
}
async fn private_write(path: &Path, data: &[u8], create_new: bool) -> Result<()> {
    let mut options = fs::OpenOptions::new();
    options.write(true).create(true).create_new(create_new);
    if !create_new {
        options.truncate(true);
    }
    #[cfg(unix)]
    options.mode(0o600);
    use tokio::io::AsyncWriteExt;
    let mut file = options.open(path).await?;
    file.write_all(data).await?;
    file.sync_all().await?;
    Ok(())
}
pub async fn load(directory: &Path, name: &str) -> Result<Identity> {
    let mut builder = tokio::fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    builder.mode(0o700);
    builder.create(directory).await?;
    let file = directory.join("identity.json");
    match fs::read(&file).await {
        Ok(data) => {
            let identity: Identity =
                serde_json::from_slice(&data).context("Invalid identity.json")?;
            X509::from_pem(identity.cert_pem.as_bytes())?;
            PKey::private_key_from_pem(identity.key_pem.as_bytes())?;
            return Ok(identity);
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.into()),
    }
    let name = name.to_owned();
    let identity = tokio::task::spawn_blocking(move || generate(&name, "")).await??;
    match private_write(&file, &serde_json::to_vec(&identity)?, true).await {
        Ok(()) => Ok(identity),
        Err(error)
            if error
                .downcast_ref::<std::io::Error>()
                .is_some_and(|e| e.kind() == std::io::ErrorKind::AlreadyExists) =>
        {
            Ok(serde_json::from_slice(&fs::read(file).await?)?)
        }
        Err(error) => Err(error),
    }
}
pub fn connector(identity: &Identity) -> Result<SslConnector> {
    let mut builder = SslConnector::builder(SslMethod::tls_client())?;
    let cert = X509::from_pem(identity.cert_pem.as_bytes())?;
    builder.set_certificate(&cert)?;
    let key = PKey::private_key_from_pem(identity.key_pem.as_bytes())?;
    builder.set_private_key(&key)?;
    builder.check_private_key()?;
    // Continue the TLS handshake for pinned/self-signed servers. The verification
    // result is checked together with the SHA-256 pin before sending Authenticate.
    builder.set_verify_callback(SslVerifyMode::PEER, |_, _| true);
    Ok(builder.build())
}
pub fn fingerprint(value: &str) -> Result<String> {
    let normalized = value.replace(':', "").to_ascii_lowercase();
    if normalized.len() != 64 || !normalized.bytes().all(|c| c.is_ascii_hexdigit()) {
        bail!("Expected a SHA-256 server certificate fingerprint");
    }
    Ok(normalized)
}
pub async fn trust(
    directory: &Path,
    host: &str,
    port: u16,
    actual: &str,
    authorized: bool,
    trust_new: bool,
    expected: Option<&str>,
) -> Result<()> {
    let file = directory.join("known-servers.json");
    let key = serde_json::to_string(&(host.to_ascii_lowercase(), port))?;
    let mut pins: BTreeMap<String, String> = match fs::read(&file).await {
        Ok(bytes) => serde_json::from_slice(&bytes)?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => BTreeMap::new(),
        Err(e) => return Err(e.into()),
    };
    let actual = fingerprint(actual)?;
    if let Some(expected) = expected {
        if fingerprint(expected)? != actual {
            bail!("Server certificate does not match expected fingerprint: {actual}");
        }
    } else if let Some(saved) = pins.get(&key) {
        if saved != &actual {
            bail!(
                "Server certificate changed: {actual}. Verify and supply --server-fingerprint to replace the pin"
            );
        }
    } else if !authorized && !trust_new {
        bail!(
            "Untrusted server certificate: {actual}. Verify and supply --server-fingerprint or --trust-new"
        );
    }
    if pins.get(&key) == Some(&actual) {
        return Ok(());
    }
    pins.insert(key, actual);
    let temporary = directory.join(format!("pins-{}.tmp", uuid::Uuid::new_v4()));
    private_write(&temporary, &serde_json::to_vec(&pins)?, true).await?;
    fs::rename(temporary, file).await?;
    Ok(())
}

/// Generate a Mumble-compatible self-signed client identity without writing it to disk.
pub fn generate(name: &str, email: &str) -> Result<Identity> {
    let key = PKey::from_rsa(Rsa::generate(2048)?)?;
    let mut subject = X509NameBuilder::new()?;
    subject.append_entry_by_text("CN", name)?;
    if !email.is_empty() {
        subject.append_entry_by_text("emailAddress", email)?;
    }
    let subject = subject.build();
    let mut cert = X509::builder()?;
    cert.set_version(2)?;
    let mut serial = BigNum::new()?;
    serial.rand(128, MsbOption::MAYBE_ZERO, false)?;
    let serial = serial.to_asn1_integer()?;
    cert.set_serial_number(&serial)?;
    cert.set_subject_name(&subject)?;
    cert.set_issuer_name(&subject)?;
    cert.set_pubkey(&key)?;
    let before = Asn1Time::days_from_now(0)?;
    let after = Asn1Time::days_from_now(3650)?;
    cert.set_not_before(&before)?;
    cert.set_not_after(&after)?;
    cert.sign(&key, MessageDigest::sha256())?;
    Ok(Identity {
        cert_pem: String::from_utf8(cert.build().to_pem()?)?,
        key_pem: String::from_utf8(key.private_key_to_pem_pkcs8()?)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn identities_persist_and_changed_pins_need_verified_replacement() {
        let directory =
            std::env::temp_dir().join(format!("mumh5-rust-identity-{}", uuid::Uuid::new_v4()));
        let first = load(&directory, "bot").await.unwrap();
        let next = load(&directory, "renamed").await.unwrap();
        assert_eq!(first.cert_pem, next.cert_pem);
        assert_eq!(first.key_pem, next.key_pem);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(directory.join("identity.json"))
                    .await
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o077,
                0
            );
        }
        let original = "a".repeat(64);
        let changed = "b".repeat(64);
        assert!(
            trust(
                &directory,
                "localhost",
                64738,
                &original,
                false,
                false,
                None
            )
            .await
            .is_err()
        );
        trust(&directory, "localhost", 64738, &original, false, true, None)
            .await
            .unwrap();
        trust(
            &directory,
            "localhost",
            64738,
            &original,
            false,
            false,
            None,
        )
        .await
        .unwrap();
        assert!(
            trust(&directory, "localhost", 64738, &changed, true, true, None)
                .await
                .is_err()
        );
        assert!(
            trust(
                &directory,
                "localhost",
                64738,
                &changed,
                false,
                true,
                Some(&original)
            )
            .await
            .is_err()
        );
        trust(
            &directory,
            "localhost",
            64738,
            &changed,
            false,
            false,
            Some(&changed),
        )
        .await
        .unwrap();
        fs::remove_dir_all(directory).await.unwrap();
    }
}
