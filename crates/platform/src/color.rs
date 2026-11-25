use anyhow::Result;
pub fn hex(rgb: [f64; 3]) -> Option<String> {
    if !rgb.iter().all(|c| c.is_finite()) {
        return None;
    }
    Some(format!(
        "#{:02x}{:02x}{:02x}",
        (rgb[0].clamp(0., 1.) * 255.).round() as u8,
        (rgb[1].clamp(0., 1.) * 255.).round() as u8,
        (rgb[2].clamp(0., 1.) * 255.).round() as u8
    ))
}
pub fn available() -> bool {
    cfg!(target_os = "linux") && std::env::var_os("WAYLAND_DISPLAY").is_some()
}
#[cfg(target_os = "linux")]
pub async fn pick() -> Result<Option<String>> {
    use futures_util::StreamExt;
    use std::{collections::HashMap, time::Duration};
    use zbus::{
        Connection, Proxy,
        zvariant::{OwnedObjectPath, OwnedValue, Value},
    };
    let bus = Connection::session().await?;
    let token = format!("mumh5_{}", uuid::Uuid::new_v4().simple());
    let name = bus
        .unique_name()
        .unwrap()
        .as_str()
        .trim_start_matches(':')
        .replace('.', "_");
    let path = format!("/org/freedesktop/portal/desktop/request/{name}/{token}");
    let request = Proxy::new(
        &bus,
        "org.freedesktop.portal.Desktop",
        path.as_str(),
        "org.freedesktop.portal.Request",
    )
    .await?;
    let mut response = request.receive_signal("Response").await?;
    let portal = Proxy::new(
        &bus,
        "org.freedesktop.portal.Desktop",
        "/org/freedesktop/portal/desktop",
        "org.freedesktop.portal.Screenshot",
    )
    .await?;
    let mut options = HashMap::new();
    options.insert("handle_token", Value::from(token.as_str()));
    let _: OwnedObjectPath = portal.call("PickColor", &("", options)).await?;
    let signal = tokio::time::timeout(Duration::from_secs(300), response.next())
        .await?
        .ok_or_else(|| anyhow::anyhow!("Color picker closed without a response"))?;
    let (code, mut data): (u32, HashMap<String, OwnedValue>) = signal.body().deserialize()?;
    if code != 0 {
        return Ok(None);
    }
    let rgb: (f64, f64, f64) = data
        .remove("color")
        .ok_or_else(|| anyhow::anyhow!("Color picker returned no color"))?
        .try_into()?;
    Ok(hex([rgb.0, rgb.1, rgb.2]))
}
#[cfg(not(target_os = "linux"))]
pub async fn pick() -> Result<Option<String>> {
    anyhow::bail!("Use the platform color picker")
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn clamps_and_rejects_invalid_colors() {
        assert_eq!(hex([-1., 0.5, 2.]).as_deref(), Some("#0080ff"));
        assert!(hex([f64::NAN, 0., 0.]).is_none());
    }
}
