use anyhow::{Context, Result, bail};
use futures_util::StreamExt;
use scraper::{Html, Selector};
use serde::Deserialize;
use serde_json::{Value, json};
use std::time::{Duration, Instant};
use tokio::{net::UdpSocket, time::timeout};
pub async fn ping(host: &str, port: u16) -> Result<Value> {
    let address = tokio::net::lookup_host((host, port))
        .await?
        .next()
        .context("No address")?;
    let socket = UdpSocket::bind(if address.is_ipv4() {
        "0.0.0.0:0"
    } else {
        "[::]:0"
    })
    .await?;
    socket.connect(address).await?;
    let mut request = [0; 12];
    request[4..].copy_from_slice(&uuid::Uuid::new_v4().as_bytes()[..8]);
    let at = Instant::now();
    socket.send(&request).await?;
    let mut response = [0; 64];
    let n = timeout(Duration::from_secs(2), socket.recv(&mut response)).await??;
    if n != 24 || request[4..] != response[4..12] {
        bail!("Invalid server ping response");
    }
    let u = |i| u32::from_be_bytes(response[i..i + 4].try_into().unwrap());
    let version = u(0);
    Ok(
        json!({"ping":at.elapsed().as_secs_f64()*1000.0,"users":u(12),"maxUsers":u(16),"bandwidth":u(20),"version":format!("{}.{}.{}",version>>16,(version>>8)&255,version&255)}),
    )
}
pub async fn fetch(url: &str, max: usize) -> Result<(reqwest::Url, Vec<u8>)> {
    let url = reqwest::Url::parse(url)?;
    if !matches!(url.scheme(), "http" | "https") {
        bail!("Only HTTP(S) URLs are supported");
    }
    let client = reqwest::Client::builder()
        .user_agent("mumh5/0.2")
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()?;
    let response = client.get(url).send().await?.error_for_status()?;
    let url = response.url().clone();
    if response.content_length().is_some_and(|n| n > max as u64) {
        bail!("Response is too large");
    }
    let mut bytes = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        if bytes.len() + chunk.len() > max {
            bail!("Response is too large");
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok((url, bytes))
}
pub async fn link_preview(url: &str) -> Result<Value> {
    let (url, bytes) = fetch(url, 1024 * 1024).await?;
    let html = Html::parse_document(&String::from_utf8_lossy(&bytes));
    let meta = |key: &str| {
        let selector =
            Selector::parse(&format!("meta[property=\"{key}\"],meta[name=\"{key}\"]")).unwrap();
        html.select(&selector)
            .next()
            .and_then(|e| e.value().attr("content"))
            .unwrap_or("")
            .chars()
            .take(2048)
            .collect::<String>()
    };
    let title = meta("og:title");
    let image = meta("og:image");
    let image = url
        .join(&image)
        .ok()
        .filter(|u| !image.is_empty() && matches!(u.scheme(), "http" | "https"))
        .map(|u| u.to_string())
        .unwrap_or_default();
    let title = if title.is_empty() {
        html.select(&Selector::parse("title").unwrap())
            .next()
            .map(|e| e.text().collect::<String>())
            .unwrap_or_default()
    } else {
        title
    };
    let description = meta("og:description");
    let description = if description.is_empty() {
        meta("description")
    } else {
        description
    };
    Ok(
        json!({"url":url.as_str(),"title":title,"description":description,"site":meta("og:site_name"),"image":image,"large":meta("twitter:card")=="summary_large_image","color":meta("theme-color")}),
    )
}
#[derive(Deserialize, Default)]
struct ServerList {
    #[serde(rename = "server", default)]
    servers: Vec<Server>,
}
#[derive(Deserialize, Default)]
struct Server {
    #[serde(rename = "@name", default)]
    name: String,
    #[serde(rename = "@ip", default)]
    ip: String,
    #[serde(rename = "@port", default)]
    port: u16,
    #[serde(rename = "@url", default)]
    url: String,
    #[serde(rename = "@country", default)]
    country: String,
    #[serde(rename = "@country_code", default)]
    country_code: String,
    #[serde(rename = "@continent_code", default)]
    continent: String,
    #[serde(rename = "@ca", default)]
    ca: String,
}
pub async fn public_servers(url: &str) -> Result<Value> {
    let (_, bytes) = fetch(url, 4 * 1024 * 1024).await?;
    let list: ServerList = quick_xml::de::from_reader(bytes.as_slice())?;
    Ok(Value::Array(list.servers.into_iter().filter(|s|!s.ip.is_empty()).map(|s|json!({"name":s.name,"host":s.ip,"port":if s.port==0{64738}else{s.port},"url":s.url,"country":s.country,"countryCode":s.country_code,"continent":s.continent,"ca":s.ca=="1"})).collect()))
}
