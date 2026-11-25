//! Static files: cache headers by path, precompressed variants, and no Nagle stall on
//! keep-alive connections. Needs no Mumble server.
use anyhow::{Context, Result};
use std::{path::Path, process::Stdio, time::Duration, time::Instant};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};

/// The gateway on a free port serving `assets`; killed when the child is dropped.
async fn gateway(assets: &Path) -> Result<(tokio::process::Child, String)> {
    let mut gateway = tokio::process::Command::new(env!("CARGO_BIN_EXE_mumh5-web"))
        .env_clear()
        .env("MUMH5_PORT", "0")
        .env("MUMH5_SERVERS", "127.0.0.1:1")
        .env("MUMH5_STUN_PORT", "0")
        .env("MUMH5_STATIC", assets)
        .stdout(Stdio::piped())
        .kill_on_drop(true)
        .spawn()?;
    let mut lines = BufReader::new(gateway.stdout.take().context("stdout")?).lines();
    let line = tokio::time::timeout(Duration::from_secs(10), lines.next_line())
        .await??
        .context("no banner")?;
    let base = line
        .trim_start_matches("mumh5: ")
        .trim_end_matches('/')
        .to_owned();
    Ok((gateway, base))
}

fn header(res: &reqwest::Response, name: &str) -> String {
    res.headers()
        .get(name)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_owned()
}

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
    let (_gateway, base) = gateway(&assets).await?;
    let base = base.as_str();
    let client = reqwest::Client::new();

    let asset = client
        .get(format!("{base}/assets/app-0123456789abcdef.js"))
        .send()
        .await?;
    assert_eq!(asset.status(), 200);
    assert_eq!(
        header(&asset, "cache-control"),
        "public, max-age=31536000, immutable"
    );
    for path in [
        "/",
        "/index.html",
        "/sw.js",
        "/some/route",
        "/assets/missing.js",
    ] {
        let res = client.get(format!("{base}{path}")).send().await?;
        assert_eq!(header(&res, "cache-control"), "no-cache", "{path}");
    }

    // Raw paths fetch clients would normalize; `//` once took the Node proxy down (#117)
    let addr = base.trim_start_matches("http://");
    for path in ["//", "//x/../..", "/\\\\"] {
        let mut tcp = tokio::net::TcpStream::connect(addr).await?;
        tcp.write_all(
            format!("GET {path} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n").as_bytes(),
        )
        .await?;
        let mut answer = String::new();
        tcp.read_to_string(&mut answer).await?;
        let status = answer.split(' ').nth(1).unwrap_or("");
        assert!(
            matches!(status.as_bytes().first(), Some(b'2'..=b'4')),
            "{path}: {status}"
        );
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

#[tokio::test]
async fn precompressed_variants_are_negotiated() -> Result<()> {
    let assets = std::env::temp_dir().join(format!("mumh5-encoded-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(assets.join("assets"))?;
    // Distinct fake bodies, so each answer shows which file was sent
    let page = "<!doctype html><title>t</title>";
    std::fs::write(assets.join("index.html"), page)?;
    std::fs::write(assets.join("index.html.br"), "page-br")?;
    std::fs::write(assets.join("index.html.gz"), "page-gz")?;
    let js = "assets/app-0123456789abcdef.js";
    std::fs::write(assets.join(js), "plain-js")?;
    std::fs::write(assets.join(format!("{js}.br")), "br-js")?;
    std::fs::write(assets.join(format!("{js}.gz")), "gz-js")?;
    let font = "assets/font-0123456789abcdef.woff2";
    std::fs::write(assets.join(font), "font")?;
    let (_gateway, base) = gateway(&assets).await?;
    let client = reqwest::Client::new();

    for (accept, body, encoding) in [
        (Some("gzip, deflate, br"), "br-js", "br"),
        (Some("br;q=0.5, gzip"), "gz-js", "gzip"),
        (Some("gzip"), "gz-js", "gzip"),
        (Some("br;q=0, gzip;q=0"), "plain-js", ""),
        (Some("identity"), "plain-js", ""),
        (None, "plain-js", ""),
    ] {
        let mut req = client.get(format!("{base}/{js}"));
        if let Some(accept) = accept {
            req = req.header("accept-encoding", accept);
        }
        let res = req.send().await?;
        let label = accept.unwrap_or("none");
        assert_eq!(res.status(), 200, "{label}");
        assert_eq!(header(&res, "content-encoding"), encoding, "{label}");
        assert_eq!(header(&res, "content-type"), "text/javascript", "{label}");
        assert_eq!(header(&res, "vary"), "accept-encoding", "{label}");
        assert_eq!(
            header(&res, "cache-control"),
            "public, max-age=31536000, immutable",
            "{label}"
        );
        assert_eq!(res.text().await?, body, "{label}");
    }

    // The page, directly and as the fallback for routes and missing assets, stays uncached
    for path in ["/", "/index.html", "/some/route", "/assets/missing.js"] {
        let res = client
            .get(format!("{base}{path}"))
            .header("accept-encoding", "br")
            .send()
            .await?;
        assert_eq!(header(&res, "content-encoding"), "br", "{path}");
        assert!(
            header(&res, "content-type").starts_with("text/html"),
            "{path}"
        );
        assert_eq!(header(&res, "cache-control"), "no-cache", "{path}");
        assert_eq!(header(&res, "vary"), "accept-encoding", "{path}");
        assert_eq!(res.text().await?, "page-br", "{path}");
        let res = client.get(format!("{base}{path}")).send().await?;
        assert_eq!(header(&res, "content-encoding"), "", "{path}");
        assert_eq!(res.text().await?, page, "{path}");
    }

    // A file without variants goes out plain
    let res = client
        .get(format!("{base}/{font}"))
        .header("accept-encoding", "br, gzip")
        .send()
        .await?;
    assert_eq!(header(&res, "content-encoding"), "");
    assert_eq!(header(&res, "content-type"), "font/woff2");
    assert_eq!(res.text().await?, "font");

    // Ranges apply to the plain file when no encoding is accepted
    let res = client
        .get(format!("{base}/{js}"))
        .header("range", "bytes=2-4")
        .send()
        .await?;
    assert_eq!(res.status(), 206);
    assert_eq!(header(&res, "content-encoding"), "");
    assert_eq!(header(&res, "content-range"), "bytes 2-4/8");
    assert_eq!(res.text().await?, "ain");
    let _ = std::fs::remove_dir_all(&assets);
    Ok(())
}
