//! Certificate presentation shared by the native shell and web gateway.
use anyhow::Result;
use openssl::{
    hash::MessageDigest,
    x509::{X509NameRef, X509Ref},
};
use serde_json::{Value, json};
fn name(n: &X509NameRef) -> String {
    n.entries()
        .map(|e| {
            format!(
                "{}={}",
                e.object().nid().short_name().unwrap_or("?"),
                e.data().to_string().unwrap_or_default()
            )
        })
        .collect::<Vec<_>>()
        .join(", ")
}
pub fn digest(cert: &X509Ref, algorithm: MessageDigest) -> Result<String> {
    Ok(cert
        .digest(algorithm)?
        .iter()
        .map(|b| format!("{b:02X}"))
        .collect::<Vec<_>>()
        .join(":"))
}
pub fn describe(cert: &X509Ref) -> Result<Value> {
    let key = cert.public_key()?;
    let self_signed = cert.subject_name().to_der()? == cert.issuer_name().to_der()?
        && cert.verify(&key).unwrap_or(false);
    let key_type = match key.id() {
        openssl::pkey::Id::RSA => "RSA",
        openssl::pkey::Id::EC => "EC",
        openssl::pkey::Id::ED25519 => "Ed25519",
        _ => "Other",
    };
    Ok(
        json!({"subject":name(cert.subject_name()),"issuer":name(cert.issuer_name()),"validFrom":cert.not_before().to_string(),"validTo":cert.not_after().to_string(),"serialNumber":cert.serial_number().to_bn()?.to_hex_str()?.to_string(),"fingerprint":digest(cert,MessageDigest::sha1())?,"fingerprint256":digest(cert,MessageDigest::sha256())?,"subjectAltName":cert.subject_alt_names().map(|names| names.iter().map(|n| n.dnsname().map(String::from).or_else(|| n.ipaddress().map(|v| format!("{v:?}"))).unwrap_or_default()).collect::<Vec<_>>().join(", ")).unwrap_or_default(),"keyType":key_type,"keyBits":key.bits(),"ca":String::from_utf8_lossy(&cert.to_text()?).contains("CA:TRUE"),"selfSigned":self_signed,"pem":String::from_utf8(cert.to_pem()?)?}),
    )
}
