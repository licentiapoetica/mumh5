//! Opt-in integration against a disposable stock Mumble server. No external hosts by default.
use anyhow::{Context, Result};
use mumh5_core::{Client, Options, Target};
use serde_json::Value;
use std::time::Duration;
use tokio::time::timeout;
async fn next_text(events: &mut tokio::sync::mpsc::Receiver<Value>, expected: &str) -> Result<()> {
    timeout(Duration::from_secs(8), async {
        while let Some(e) = events.recv().await {
            if e["event"] == "text" && e["html"] == expected {
                return Ok(());
            }
        }
        anyhow::bail!("Disconnected")
    })
    .await?
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn native_text_audio_and_independent_streams() -> Result<()> {
    let Ok(host) = std::env::var("MUMH5_TEST_HOST") else {
        return Ok(());
    };
    let port = std::env::var("MUMH5_TEST_PORT")
        .unwrap_or_else(|_| "64750".into())
        .parse()?;
    for tcp_only in [true, false] {
        let directory = std::env::temp_dir().join(format!("dream-live-{}", uuid::Uuid::new_v4()));
        let mut options = Options::new(
            &host,
            format!("source-{}", uuid::Uuid::new_v4().simple()),
            directory.join("a"),
        );
        options.port = port;
        options.trust_new = true;
        options.tcp_only = tcp_only;
        let mut a = Client::connect(options).await?;
        let mut options = Options::new(
            &host,
            format!("listener-{}", uuid::Uuid::new_v4().simple()),
            directory.join("b"),
        );
        options.port = port;
        options.trust_new = true;
        options.tcp_only = tcp_only;
        let mut b = Client::connect(options).await?;
        let sid = a.client.state().session;
        a.client
            .send_text("channel text from Rust", None, None)
            .await?;
        next_text(&mut b.events, "channel text from Rust").await?;
        b.client
            .send_text("private text from Rust", Some(Target::Id(sid)), None)
            .await?;
        next_text(&mut a.events, "private text from Rust").await?;
        a.client.enable_audio(40000).await?;
        b.client.enable_audio(40000).await?;
        if !tcp_only {
            timeout(Duration::from_secs(8), async {
                while !a.client.state().udp || !b.client.state().udp {
                    tokio::time::sleep(Duration::from_millis(50)).await;
                }
            })
            .await?;
        }
        let sender = a.client.clone();
        let producer = tokio::spawn(async move {
            for frame in 0..100 {
                let pcm = (0..480)
                    .map(|n| {
                        (((frame * 480 + n) as f64 * 440.0 * std::f64::consts::TAU / 48000.0).sin()
                            * 8000.0) as i16
                    })
                    .collect();
                sender.send_audio(pcm).await?;
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
            anyhow::Ok(())
        });
        timeout(Duration::from_secs(8), async {
            let mut heard = 0;
            while heard < 10000 {
                let pcm = b.audio.recv().await.context("Audio stream closed")?;
                heard += pcm.iter().filter(|s| s.abs() > 100).count();
            }
            anyhow::Ok(())
        })
        .await??;
        producer.await??;
        // The listener sent no audio. The source must not receive its own outgoing audio.
        while let Ok(pcm) = a.audio.try_recv() {
            assert!(
                pcm.iter().all(|s| s.abs() < 100),
                "Outgoing audio looped into incoming stream"
            );
        }
        a.client.close().await?;
        b.client.close().await?;
        tokio::fs::remove_dir_all(directory).await?;
    }
    Ok(())
}

#[cfg(feature = "video")]
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn native_video_round_trip() -> Result<()> {
    let Ok(host) = std::env::var("MUMH5_TEST_HOST") else {
        return Ok(());
    };
    let port = std::env::var("MUMH5_TEST_PORT")
        .unwrap_or_else(|_| "64750".into())
        .parse()?;
    let dir = std::env::temp_dir().join(format!("dream-video-live-{}", uuid::Uuid::new_v4()));
    let mut opts = Options::new(
        &host,
        format!("camera-{}", uuid::Uuid::new_v4().simple()),
        dir.join("a"),
    );
    opts.port = port;
    opts.trust_new = true;
    let mut a = Client::connect(opts).await?;
    let mut opts = Options::new(
        &host,
        format!("watcher-{}", uuid::Uuid::new_v4().simple()),
        dir.join("b"),
    );
    opts.port = port;
    opts.trust_new = true;
    let mut b = Client::connect(opts).await?;
    a.client
        .video_command(
            serde_json::json!({"op":"share","width":160,"height":120,"fps":10,"kind":"camera"}),
        )
        .await?;
    b.client
        .video_command(serde_json::json!({"op":"watch","user":a.client.state().session}))
        .await?;
    let sender = a.client.clone();
    let producer = tokio::spawn(async move {
        for _ in 0..150 {
            sender.push_video(vec![128; 160 * 120 * 3 / 2])?;
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        anyhow::Ok(())
    });
    let frame = timeout(Duration::from_secs(15), b.video.recv())
        .await?
        .context("No incoming video")?;
    assert_eq!(
        (frame.width, frame.height, frame.data.len()),
        (160, 120, 160 * 120 * 3 / 2)
    );
    assert_eq!(frame.session, a.client.state().session);
    assert!(
        a.video.try_recv().is_err(),
        "Outgoing video unexpectedly looped into incoming stream"
    );
    producer.abort();
    let _ = producer.await;
    b.client
        .video_command(serde_json::json!({"op":"unwatch"}))
        .await?;
    a.client
        .video_command(serde_json::json!({"op":"stop-video"}))
        .await?;
    a.client.close().await?;
    b.client.close().await?;
    tokio::fs::remove_dir_all(dir).await?;
    Ok(())
}
