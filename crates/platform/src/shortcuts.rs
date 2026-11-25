//! System-wide hotkeys through the desktop portal (org.freedesktop.portal.GlobalShortcuts).
//! Wayland lets no program grab keys itself; the portal asks the user to confirm the shortcuts and
//! reports presses and releases, also while the app is in the background. KDE Plasma and GNOME
//! implement it on Wayland and X11.
use anyhow::Result;
use serde_json::{Value, json};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

/// One hotkey: a stable id, what it does (shown by the desktop), and the preferred trigger in the
/// xdg shortcuts format ("CTRL+SHIFT+m"), which the desktop may change or the user may decline.
pub struct Shortcut {
    pub id: String,
    pub description: String,
    pub trigger: Option<String>,
}

/// A bound set of hotkeys; dropping it closes the portal session and releases the keys.
pub struct Bound {
    cancel: CancellationToken,
}
impl Drop for Bound {
    fn drop(&mut self) {
        self.cancel.cancel();
    }
}

#[cfg(target_os = "linux")]
mod portal {
    use super::*;
    use anyhow::{Context, bail};
    use futures_util::StreamExt;
    use std::{collections::HashMap, time::Duration};
    use zbus::{
        Connection, Proxy,
        zvariant::{ObjectPath, OwnedObjectPath, OwnedValue, Value as ZValue},
    };

    const DEST: &str = "org.freedesktop.portal.Desktop";
    const PATH: &str = "/org/freedesktop/portal/desktop";
    const IFACE: &str = "org.freedesktop.portal.GlobalShortcuts";

    fn token() -> String {
        format!("mumh5_{}", uuid::Uuid::new_v4().simple())
    }

    /// Calls a portal method that answers through a Request object, and returns its results.
    async fn request<F, Fut>(
        bus: &Connection,
        wait: Duration,
        call: F,
    ) -> Result<HashMap<String, OwnedValue>>
    where
        F: FnOnce(String) -> Fut,
        Fut: std::future::Future<Output = Result<OwnedObjectPath>>,
    {
        let handle = token();
        let sender = bus
            .unique_name()
            .context("No D-Bus name")?
            .as_str()
            .trim_start_matches(':')
            .replace('.', "_");
        let path = format!("/org/freedesktop/portal/desktop/request/{sender}/{handle}");
        // Subscribed before the call, so a quick answer is not missed
        let req = Proxy::new(bus, DEST, path.as_str(), "org.freedesktop.portal.Request").await?;
        let mut response = req.receive_signal("Response").await?;
        call(handle).await?;
        let signal = tokio::time::timeout(wait, response.next())
            .await
            .context("The desktop did not answer")?
            .context("The desktop closed the request")?;
        let (code, results): (u32, HashMap<String, OwnedValue>) = signal.body().deserialize()?;
        match code {
            0 => Ok(results),
            1 => bail!("Declined in the desktop's dialog"),
            _ => bail!("The desktop refused the hotkeys"),
        }
    }

    pub async fn bind(
        shortcuts: Vec<Shortcut>,
        events: mpsc::UnboundedSender<(String, bool)>,
    ) -> Result<(Bound, Vec<Value>)> {
        let bus = Connection::session().await?;
        let portal = Proxy::new(&bus, DEST, PATH, IFACE)
            .await
            .context("No GlobalShortcuts portal on this desktop")?;
        // Fails fast where the desktop has no implementation of this portal
        let _: u32 = portal
            .get_property("version")
            .await
            .context("No GlobalShortcuts portal on this desktop")?;

        let session_token = token();
        let results = request(&bus, Duration::from_secs(10), |handle| {
            let portal = portal.clone();
            async move {
                let mut options: HashMap<&str, ZValue> = HashMap::new();
                options.insert("handle_token", ZValue::from(handle));
                options.insert("session_handle_token", ZValue::from(session_token));
                Ok(portal.call("CreateSession", &(options,)).await?)
            }
        })
        .await?;
        let session: String = results
            .get("session_handle")
            .context("No session from the desktop")?
            .try_clone()?
            .try_into()?;
        let session_path = OwnedObjectPath::try_from(session.clone())?;

        let list: Vec<(String, HashMap<&str, ZValue>)> = shortcuts
            .iter()
            .map(|s| {
                let mut props: HashMap<&str, ZValue> = HashMap::new();
                props.insert("description", ZValue::from(s.description.clone()));
                if let Some(t) = &s.trigger {
                    props.insert("preferred_trigger", ZValue::from(t.clone()));
                }
                (s.id.clone(), props)
            })
            .collect();
        // The desktop may show a dialog: the user has time to answer
        let bound = request(&bus, Duration::from_secs(300), |handle| {
            let portal = portal.clone();
            let session = session_path.clone();
            async move {
                let mut options: HashMap<&str, ZValue> = HashMap::new();
                options.insert("handle_token", ZValue::from(handle));
                Ok(portal
                    .call(
                        "BindShortcuts",
                        &(ObjectPath::from(&session), list, "", options),
                    )
                    .await?)
            }
        })
        .await;
        let close = |bus: Connection, session: String| async move {
            if let Ok(s) = Proxy::new(
                &bus,
                DEST,
                session.as_str(),
                "org.freedesktop.portal.Session",
            )
            .await
            {
                let _: Result<(), _> = s.call("Close", &()).await;
            }
        };
        let bound = match bound {
            Ok(b) => b,
            Err(e) => {
                close(bus, session).await;
                return Err(e);
            }
        };
        let mut answer = vec![];
        if let Some(value) = bound.get("shortcuts") {
            let list: Vec<(String, HashMap<String, OwnedValue>)> = value.try_clone()?.try_into()?;
            for (id, props) in list {
                let trigger = props
                    .get("trigger_description")
                    .and_then(|v| v.try_clone().ok())
                    .and_then(|v| String::try_from(v).ok())
                    .unwrap_or_default();
                answer.push(json!({ "id": id, "trigger": trigger }));
            }
        }

        let mut activated = portal.receive_signal("Activated").await?;
        let mut deactivated = portal.receive_signal("Deactivated").await?;
        let cancel = CancellationToken::new();
        let stop = cancel.clone();
        tokio::spawn(async move {
            let ours = |msg: &zbus::Message| -> Option<String> {
                let (s, id, _ts, _opts): (
                    OwnedObjectPath,
                    String,
                    u64,
                    HashMap<String, OwnedValue>,
                ) = msg.body().deserialize().ok()?;
                (s.as_str() == session.as_str()).then_some(id)
            };
            loop {
                tokio::select! {
                    _ = stop.cancelled() => break,
                    m = activated.next() => match m { Some(m) => if let Some(id) = ours(&m) { let _ = events.send((id, true)); }, None => break },
                    m = deactivated.next() => match m { Some(m) => if let Some(id) = ours(&m) { let _ = events.send((id, false)); }, None => break },
                }
            }
            close(bus, session).await;
        });
        Ok((Bound { cancel }, answer))
    }
}

/// Binds the hotkeys system-wide. Returns the binding (keep it alive) and, per hotkey, the trigger
/// the desktop settled on (`{id, trigger}`). Presses and releases arrive on `events`.
#[cfg(target_os = "linux")]
pub async fn bind(
    shortcuts: Vec<Shortcut>,
    events: mpsc::UnboundedSender<(String, bool)>,
) -> Result<(Bound, Vec<Value>)> {
    portal::bind(shortcuts, events).await
}
#[cfg(not(target_os = "linux"))]
pub async fn bind(
    _shortcuts: Vec<Shortcut>,
    _events: mpsc::UnboundedSender<(String, bool)>,
) -> Result<(Bound, Vec<Value>)> {
    anyhow::bail!("System-wide hotkeys are not available on this system yet")
}
