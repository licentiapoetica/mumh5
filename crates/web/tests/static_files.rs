//! Static files: cache headers by path, and no Nagle stall on keep-alive connections.
//! Needs no Mumble server.
use anyhow::{Context, Result};
use std::{process::Stdio, time::Duration, time::Instant};
use tokio::io::{AsyncBufReadExt, BufReader};

#[tokio::test]
async fn static_files_are_cached_by_path_and_answer_without_delay() -> Result<()> {
    let assets = std::env::temp_dir().join(format!("mumh5-static-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(assets.join("assets"))?;
    std::fs::write(assets.join("index.html"), "<!doctype html><title>t</title>")?;
    std::fs::write(assets.join("sw.js"), "// sw")?;
    std::fs::write(
        assets.join("assets/app-0123456789abcdef.js"),
        "x".repeat(20_000),
    )?;
    let mut gateway = tokio::process::Command::new(env!("CARGO_BIN_EXE_mumh5-web"))
        .env_clear()
        .env("MUMH5_PORT", "0")
        .env("MUMH5_SERVERS", "127.0.0.1:1")
        .env("MUMH5_STUN_PORT", "0")
        .env("MUMH5_STATIC", &assets)
        .stdout(Stdio::piped())
        .kill_on_drop(true)
        .spawn()?;
    let mut lines = BufReader::new(gateway.stdout.take().context("stdout")?).lines();
    let line = tokio::time::timeout(Duration::from_secs(10), lines.next_line())
        .await??
        .context("no banner")?;
    let base = line.trim_start_matches("mumh5: ").trim_end_matches('/');
    let client = reqwest::Client::new();
    let cache = |res: &reqwest::Response| {
        res.headers()
            .get("cache-control")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_owned()
    };

    let asset = client
        .get(format!("{base}/assets/app-0123456789abcdef.js"))
        .send()
        .await?;
    assert_eq!(asset.status(), 200);
    assert_eq!(cache(&asset), "public, max-age=31536000, immutable");
    for path in [
        "/",
        "/index.html",
        "/sw.js",
        "/some/route",
        "/assets/missing.js",
    ] {
        let res = client.get(format!("{base}{path}")).send().await?;
        assert_eq!(cache(&res), "no-cache", "{path}");
    }

    // One pooled connection; with Nagle on, each response after the first waited ~40 ms.
    client
        .get(format!("{base}/sw.js"))
        .send()
        .await?
        .bytes()
        .await?;
    let start = Instant::now();
    for _ in 0..10 {
        let res = client
            .get(format!("{base}/assets/app-0123456789abcdef.js"))
            .send()
            .await?;
        res.bytes().await?;
    }
    let spent = start.elapsed();
    assert!(
        spent < Duration::from_millis(150),
        "10 requests took {spent:?}"
    );
    let _ = std::fs::remove_dir_all(&assets);
    Ok(())
}
