use anyhow::{Context, Result, bail};
use mumh5_core::{
    certificates,
    identity::{self, Identity},
};
use openssl::{hash::MessageDigest, pkcs12::Pkcs12, pkey::PKey, x509::X509};
use serde_json::{Value, json};
pub fn fresh(identity: &Identity) -> Result<Value> {
    let cert = X509::from_pem(identity.cert_pem.as_bytes())?;
    let fingerprint = hex_digest(&cert)?;
    let common = cert
        .subject_name()
        .entries_by_nid(openssl::nid::Nid::COMMONNAME)
        .next()
        .map(|e| e.data().to_string().unwrap_or_default())
        .unwrap_or_default();
    Ok(
        json!({"certPem":identity.cert_pem,"keyPem":identity.key_pem,"fingerprint":fingerprint,"cert":certificates::describe(&cert)?,"commonName":common}),
    )
}
pub fn hex_digest(cert: &X509) -> Result<String> {
    Ok(cert
        .digest(MessageDigest::sha1())?
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect())
}
pub fn create(name: &str, email: &str) -> Result<Identity> {
    if name.len() > 256 || email.len() > 256 {
        bail!("Identity name too long");
    }
    identity::generate(name, email)
}
pub fn import(bytes: &[u8], password: &str) -> Result<Identity> {
    let parsed = Pkcs12::from_der(bytes)?
        .parse2(password)
        .context("Cannot open PKCS#12 backup: check the password")?;
    let cert = parsed.cert.context("Backup contains no certificate")?;
    let key = parsed.pkey.context("Backup contains no private key")?;
    if !cert.public_key()?.public_eq(&key) {
        bail!("Certificate and key do not match");
    }
    Ok(Identity {
        cert_pem: String::from_utf8(cert.to_pem()?)?,
        key_pem: String::from_utf8(key.private_key_to_pem_pkcs8()?)?,
    })
}
pub fn export(identity: &Identity, password: &str, name: &str) -> Result<Vec<u8>> {
    let cert = X509::from_pem(identity.cert_pem.as_bytes())?;
    let key = PKey::private_key_from_pem(identity.key_pem.as_bytes())?;
    Ok(Pkcs12::builder()
        .name(name)
        .pkey(&key)
        .cert(&cert)
        .build2(password)?
        .to_der()?)
}
