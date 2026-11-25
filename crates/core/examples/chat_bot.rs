use anyhow::{Context, Result};
use mumh5_core::{Client, Options, bot};
use std::collections::HashSet;
use std::time::{Duration, Instant};

#[tokio::main(worker_threads = 2)]
async fn main() -> Result<()> {
    let host = std::env::var("MUMH5_HOST").context("Set MUMH5_HOST")?;
    let directory = std::env::var("MUMH5_STATE_DIR")
        .context("Set MUMH5_STATE_DIR to a persistent bot profile directory")?;
    let mut options = Options::new(host, "rust-helper", directory);
    options.port = std::env::var("MUMH5_PORT")
        .unwrap_or_else(|_| "64738".into())
        .parse()?;
    options.password = std::env::var("MUMH5_PASSWORD").ok();
    options.trust_new = std::env::var("MUMH5_TRUST_NEW").as_deref() == Ok("1");
    options.server_fingerprint = std::env::var("MUMH5_SERVER_FINGERPRINT").ok();
    let admins: HashSet<u32> = std::env::var("MUMH5_ADMIN_USER_IDS")
        .unwrap_or_default()
        .split(',')
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.trim().parse())
        .collect::<Result<_, _>>()?;
    let mut connection = Client::connect(options).await?;
    let client = connection.client.clone();
    let mut next_command = Instant::now();
    let result = async {
        loop {
            tokio::select! {
                _ = tokio::signal::ctrl_c() => break,
                event = connection.events.recv() => {
                    let Some(event) = event else { break; };
                    if event["event"] == "closed" { anyhow::bail!("Server disconnected: {}", event["reason"]); }
                    if event["event"] == "warning" || event["event"] == "mediaError" { eprintln!("{event}"); }
                    if Instant::now() >= next_command && bot::handle(&client, &event, &admins).await? { break; }
                    if event["event"] == "text" { next_command = Instant::now() + Duration::from_millis(1500); }
                }
            }
        }
        Ok(())
    }.await;
    client.close().await?;
    result
}
