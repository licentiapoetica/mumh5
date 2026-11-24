use anyhow::{Context, Result, bail};
use clap::Parser;
use mumh5_core::{
    Client, Options, Target,
    video::{VideoFrame, frame_bytes},
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    io::{BufRead, Write},
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    time::{Duration, Instant},
};
use tokio::{
    fs::{File, OpenOptions},
    io::{AsyncReadExt, AsyncWriteExt},
    sync::{mpsc, oneshot},
    time::{MissedTickBehavior, interval},
};
use tokio_util::sync::CancellationToken;
#[derive(Parser, Debug)]
#[command(
    name = "mumh5-cli",
    version,
    about = "Native Rust headless Mumble client and bot (no browser or Node)"
)]
struct Args {
    #[arg(long)]
    server: String,
    #[arg(long, default_value_t = 64738)]
    port: u16,
    #[arg(long)]
    name: String,
    #[arg(long)]
    state_dir: Option<PathBuf>,
    #[arg(long)]
    channel: Option<String>,
    #[arg(long)]
    trust_new: bool,
    #[arg(long)]
    server_fingerprint: Option<String>,
    #[arg(long, default_value = "MUMH5_PASSWORD")]
    password_env: String,
    #[arg(long)]
    token: Vec<String>,
    #[arg(long)]
    tcp_only: bool,
    #[arg(long)]
    audio_in: Option<PathBuf>,
    #[arg(long)]
    audio_out: Option<PathBuf>,
    #[arg(long,default_value_t=40000,value_parser=clap::value_parser!(u32).range(6000..=128000))]
    bitrate: u32,
    #[arg(long)]
    video_in: Option<PathBuf>,
    #[arg(long)]
    video_out: Option<PathBuf>,
    #[arg(long, default_value_t = 640)]
    width: u32,
    #[arg(long, default_value_t = 360)]
    height: u32,
    #[arg(long,default_value_t=15,value_parser=clap::value_parser!(u32).range(1..=60))]
    fps: u32,
    #[arg(long)]
    watch: Option<String>,
    #[arg(long)]
    stun: Vec<String>,
    #[arg(long)]
    ice_config: Option<PathBuf>,
    #[arg(long)]
    exit_on_eof: bool,
    #[arg(
        long,
        help = "Enable !help/!ping/!status/!whoami and allowlisted admin chat controls"
    )]
    bot: bool,
    #[arg(long, value_delimiter = ',')]
    admin_user_ids: Vec<u32>,
}
fn target(text: String) -> Target {
    if let Ok(id) = text.parse::<u32>() {
        Target::Id(id)
    } else {
        Target::Name(text)
    }
}
enum Output {
    Json(Vec<u8>),
    Flush(oneshot::Sender<()>),
}
#[derive(Clone)]
struct Out {
    tx: mpsc::Sender<Output>,
    queued: Arc<AtomicUsize>,
}
impl Out {
    fn new(cancel: CancellationToken) -> Self {
        let (tx, mut rx) = mpsc::channel::<Output>(128);
        let queued = Arc::new(AtomicUsize::new(0));
        let count = queued.clone();
        std::thread::spawn(move || {
            let mut output = std::io::stdout().lock();
            while let Some(message) = rx.blocking_recv() {
                match message {
                    Output::Json(bytes) => {
                        let result = output.write_all(&bytes).and_then(|_| output.flush());
                        count.fetch_sub(bytes.len(), Ordering::Relaxed);
                        if result.is_err() {
                            cancel.cancel();
                            break;
                        }
                    }
                    Output::Flush(done) => {
                        let _ = output.flush();
                        let _ = done.send(());
                    }
                }
            }
        });
        Self { tx, queued }
    }
    fn emit(&self, value: Value) -> Result<()> {
        let mut bytes = serde_json::to_vec(&value)?;
        bytes.push(b'\n');
        let len = bytes.len();
        if self.queued.fetch_add(len, Ordering::Relaxed) + len > 1024 * 1024 {
            self.queued.fetch_sub(len, Ordering::Relaxed);
            bail!("stdout consumer is too slow");
        }
        if self.tx.try_send(Output::Json(bytes)).is_err() {
            self.queued.fetch_sub(len, Ordering::Relaxed);
            bail!("stdout queue is full or closed");
        }
        Ok(())
    }
    async fn flush(&self) {
        let (tx, rx) = oneshot::channel();
        if self.tx.send(Output::Flush(tx)).await.is_ok() {
            let _ = tokio::time::timeout(Duration::from_secs(2), rx).await;
        }
    }
}
fn input() -> mpsc::Receiver<Result<String>> {
    let (tx, rx) = mpsc::channel(1);
    std::thread::spawn(move || {
        let mut reader = std::io::stdin().lock();
        loop {
            let mut line = Vec::new();
            let result =
                std::io::Read::take(&mut reader, 8 * 1024 * 1024 + 1).read_until(b'\n', &mut line);
            let result = match result {
                Ok(0) => break,
                Ok(_) if line.len() > 8 * 1024 * 1024 => {
                    Err(anyhow::anyhow!("Command exceeds 8 MiB"))
                }
                Ok(_) => String::from_utf8(line).map_err(Into::into),
                Err(error) => Err(error.into()),
            };
            let failed = result.is_err();
            if tx.blocking_send(result).is_err() || failed {
                break;
            }
        }
    });
    rx
}
async fn audio_output(
    mut stream: mpsc::Receiver<Vec<i16>>,
    file: Option<PathBuf>,
    cancel: CancellationToken,
) -> Result<()> {
    let mut output = if let Some(file) = file {
        let mut options = OpenOptions::new();
        options.write(true);
        let metadata = tokio::fs::metadata(&file).await;
        #[cfg(unix)]
        let fifo = metadata.as_ref().is_ok_and(|m| {
            use std::os::unix::fs::FileTypeExt;
            m.file_type().is_fifo()
        });
        #[cfg(not(unix))]
        let fifo = false;
        if !fifo {
            options.create_new(true);
        }
        Some(options.open(file).await?)
    } else {
        None
    };
    loop {
        tokio::select! {_=cancel.cancelled()=>break,pcm=stream.recv()=>{let Some(pcm)=pcm else{break};if let Some(output)=&mut output{let bytes:Vec<u8>=pcm.iter().flat_map(|n|n.to_le_bytes()).collect();output.write_all(&bytes).await?;}}}
    }
    if let Some(output) = &mut output {
        output.flush().await?;
    }
    Ok(())
}
async fn video_output(
    mut stream: mpsc::Receiver<VideoFrame>,
    directory: Option<PathBuf>,
    fps: u32,
    out: Out,
    cancel: CancellationToken,
) -> Result<()> {
    let mut current = None;
    let mut shape = (0, 0, 0);
    let mut serial = 0u64;
    if let Some(dir) = &directory {
        tokio::fs::create_dir_all(dir).await?;
    }
    loop {
        tokio::select! {_=cancel.cancelled()=>break,frame=stream.recv()=>{let Some(frame)=frame else{break};if let Some(dir)=&directory{let next=(frame.session,frame.width,frame.height);if next!=shape{if let Some(output)=&mut current{let output:&mut File=output;output.flush().await?;}let file=dir.join(format!("video-{}-{}-{serial}.y4m",frame.session,mumh5_core::client::now()));serial+=1;let mut output=OpenOptions::new().write(true).create_new(true).open(&file).await?;output.write_all(format!("YUV4MPEG2 W{} H{} F{fps}:1 Ip A1:1 C420jpeg\n",frame.width,frame.height).as_bytes()).await?;current=Some(output);shape=next;out.emit(json!({"event":"video","session":frame.session,"width":frame.width,"height":frame.height,"file":file}))?;}let output=current.as_mut().unwrap();output.write_all(b"FRAME\n").await?;output.write_all(&frame.data).await?;}}}
    }
    if let Some(output) = &mut current {
        output.flush().await?;
    }
    Ok(())
}
async fn read_frame(file: &mut File, size: usize) -> Result<Option<Vec<u8>>> {
    let mut buffer = vec![0; size];
    let mut pos = 0;
    while pos < size {
        let count = file.read(&mut buffer[pos..]).await?;
        if count == 0 {
            if pos == 0 {
                return Ok(None);
            }
            buffer.truncate(pos);
            return Ok(Some(buffer));
        }
        pos += count;
    }
    Ok(Some(buffer))
}
async fn audio_input(client: Client, path: PathBuf, cancel: CancellationToken) -> Result<()> {
    let mut input = File::open(path).await?;
    let mut clock = interval(Duration::from_millis(10));
    clock.set_missed_tick_behavior(MissedTickBehavior::Skip);
    loop {
        let frame =
            tokio::select! {_=cancel.cancelled()=>break,result=read_frame(&mut input,960)=>result?};
        let Some(frame) = frame else { break };
        if frame.len() % 2 != 0 {
            bail!("PCM input ends with an incomplete 16-bit sample");
        }
        tokio::select! {_=cancel.cancelled()=>break,_=clock.tick()=>{}}
        client
            .send_audio(
                frame
                    .as_chunks::<2>()
                    .0
                    .iter()
                    .map(|b| i16::from_le_bytes([b[0], b[1]]))
                    .collect(),
            )
            .await?;
    }
    Ok(())
}
async fn video_input(
    client: Client,
    path: PathBuf,
    size: usize,
    fps: u32,
    cancel: CancellationToken,
) -> Result<()> {
    let mut input = File::open(path).await?;
    let mut clock = interval(Duration::from_secs_f64(1.0 / fps as f64));
    clock.set_missed_tick_behavior(MissedTickBehavior::Skip);
    loop {
        let frame = tokio::select! {_=cancel.cancelled()=>return Ok(()),result=read_frame(&mut input,size)=>result?};
        let Some(frame) = frame else { break };
        if frame.len() != size {
            bail!("Incomplete raw video frame at EOF");
        }
        tokio::select! {_=cancel.cancelled()=>return Ok(()),_=clock.tick()=>{}}
        client.push_video(frame)?;
    }
    client.video_command(json!({"op":"stop-video"})).await?;
    Ok(())
}
async fn signal() {
    #[cfg(unix)]
    {
        let mut term =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()).unwrap();
        tokio::select! {_=tokio::signal::ctrl_c()=>{},_=term.recv()=>{}}
    }
    #[cfg(not(unix))]
    {
        let _ = tokio::signal::ctrl_c().await;
    }
}
async fn main_async(mut args: Args) -> Result<()> {
    if args.admin_user_ids.is_empty() {
        args.admin_user_ids = std::env::var("MUMH5_ADMIN_USER_IDS")
            .unwrap_or_default()
            .split(',')
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::parse)
            .collect::<std::result::Result<_, _>>()
            .context("MUMH5_ADMIN_USER_IDS must contain nonnegative registered user IDs")?;
    }
    let size = frame_bytes(args.width, args.height)?;
    for path in [&args.audio_in, &args.audio_out, &args.video_in]
        .into_iter()
        .flatten()
    {
        if path.as_os_str() == "-" {
            bail!("stdin/stdout are reserved for JSON; use a separate media path");
        }
    }
    if let (Some(input), Some(output)) = (&args.audio_in, &args.audio_out) {
        let input = tokio::fs::canonicalize(input).await?;
        let output = tokio::fs::canonicalize(output)
            .await
            .unwrap_or_else(|_| std::env::current_dir().unwrap().join(output));
        if input == output {
            bail!("Audio input and output must use different files");
        }
    }
    let directory = if let Some(dir) = args.state_dir {
        dir
    } else {
        let base = std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|d| PathBuf::from(d).join(".config")))
            .context("Specify --state-dir when no configuration directory is available")?;
        let key =
            serde_json::to_string(&(args.server.to_ascii_lowercase(), args.port, &args.name))?;
        base.join("mumh5-cli")
            .join(&hex::encode(Sha256::digest(key))[..16])
    };
    let mut options = Options::new(args.server, args.name.clone(), directory);
    options.port = args.port;
    options.password = std::env::var(args.password_env).ok();
    options.trust_new = args.trust_new;
    options.server_fingerprint = args.server_fingerprint;
    options.tokens = args.token;
    options.tcp_only = args.tcp_only;
    let mut ice = if let Some(file) = args.ice_config {
        serde_json::from_slice::<Value>(&tokio::fs::read(file).await?)?
    } else {
        json!([])
    };
    let servers = ice
        .as_array_mut()
        .context("--ice-config must be RTCIceServer[]")?;
    for url in args.stun {
        servers.push(json!({"urls":url}));
    }
    for server in servers.iter() {
        if !(server["urls"].is_string()
            || server["urls"]
                .as_array()
                .is_some_and(|a| a.iter().all(Value::is_string)))
        {
            bail!("ICE entries need urls strings or arrays");
        }
    }
    options.ice_servers = ice;
    let connection = Client::connect(options).await?;
    let client = connection.client;
    let cancel = CancellationToken::new();
    let output = Out::new(cancel.clone());
    let mut events = connection.events;
    let mut commands = input();
    let mut tasks = tokio::task::JoinSet::new();
    let mut video_source = CancellationToken::new();
    let result = async {
        if let Some(channel) = args.channel { client.join(target(channel)).await?; }
        let audio_enabled = args.audio_in.is_some() || args.audio_out.is_some();
        if audio_enabled { client.enable_audio(args.bitrate).await?; }
        tasks.spawn(audio_output(connection.audio, args.audio_out.clone(), cancel.clone()));
        tasks.spawn(video_output(connection.video, args.video_out.clone(), args.fps, output.clone(), cancel.clone()));
        if let Some(file) = args.audio_in { tasks.spawn(audio_input(client.clone(), file, cancel.clone())); }
        if let Some(user) = args.watch { client.video_command(json!({"op":"watch","user":target(user)})).await?; }
        else if args.video_out.is_some() { client.video_command(json!({"op":"auto-watch","enabled":true})).await?; }
        if let Some(file) = args.video_in {
            client.video_command(json!({"op":"share","width":args.width,"height":args.height,"fps":args.fps})).await?;
            tasks.spawn(video_input(client.clone(), file, size, args.fps, video_source.clone()));
        }
        output.emit(json!({"event":"ready","session":client.state().session,"channel":client.state().own().map(|u|u.channel_id),"name":args.name,"audio":{"format":"s16le","rate":48000,"channels":1,"enabled":audio_enabled}}))?;
        let mut stdin_open = true;
        let admin: HashSet<_> = args.admin_user_ids.into_iter().collect();
        let mut next_command = Instant::now();
        let signal_future = signal(); tokio::pin!(signal_future);
        loop {
            tokio::select! {
                _ = cancel.cancelled() => bail!("Output or media consumer stopped"),
                _ = &mut signal_future => break,
                event = events.recv() => {
                    let Some(event) = event else { bail!("Server connection closed"); };
                    let closed = event["event"] == "closed";
                    output.emit(event.clone())?;
                    if closed { bail!("{}", event["reason"].as_str().unwrap_or("Disconnected")); }
                    if args.bot && Instant::now() >= next_command {
                        let shutdown = mumh5_core::bot::handle(&client, &event, &admin).await?;
                        if event["event"] == "text" && event["html"].as_str().is_some_and(|s| s.starts_with('!')) {
                            next_command = Instant::now() + Duration::from_millis(1500);
                        }
                        if shutdown { break; }
                    }
                }
                command = commands.recv(), if stdin_open => {
                    let Some(command) = command else { stdin_open = false; if args.exit_on_eof { break; } continue; };
                    let line = command?;
                    let mut id = Value::Null;
                    let result = async {
                        let mut command: Value = serde_json::from_str(&line)?;
                        id = command["id"].clone();
                        if command["op"] == "share" || command["op"] == "stop-video" {
                            video_source.cancel(); video_source = CancellationToken::new();
                            if command["op"] == "share" {
                                if command["width"].is_null() { command["width"] = args.width.into(); }
                                if command["height"].is_null() { command["height"] = args.height.into(); }
                                if command["fps"].is_null() { command["fps"] = args.fps.into(); }
                            }
                        }
                        let quit = command["op"] == "quit";
                        let result = client.command(command).await?;
                        Ok::<_, anyhow::Error>((result, quit))
                    }.await;
                    match result {
                        Ok((value, quit)) => { output.emit(json!({"id":id,"ok":true,"result":value}))?; if quit { break; } },
                        Err(error) => output.emit(json!({"id":id,"ok":false,"error":error.to_string()}))?,
                    }
                }
                result = tasks.join_next(), if !tasks.is_empty() => { if let Some(result) = result { result??; } }
            }
        }
        Ok(())
    }.await;
    video_source.cancel();
    let _ = client.close().await;
    cancel.cancel();
    let _ = tokio::time::timeout(Duration::from_secs(2), async {
        while tasks.join_next().await.is_some() {}
    })
    .await;
    tasks.abort_all();
    output.flush().await;
    result
}
fn main() {
    let args = Args::parse();
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .unwrap();
    let result = runtime.block_on(main_async(args));
    runtime.shutdown_timeout(Duration::from_secs(1));
    if let Err(error) = result {
        eprintln!("{}", json!({"event":"error","message":error.to_string()}));
        std::process::exit(1);
    }
}
