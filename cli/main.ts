import { createReadStream, type ReadStream, type WriteStream } from 'node:fs';
import { readFile, realpath } from 'node:fs/promises';
import { finished } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';
import { HeadlessClient } from './client.ts';
import { HELP, options } from './options.ts';
import { frameBytes } from './video.ts';
import { pumpVideo, VideoFiles, binaryOutput } from './media-files.ts';
import { commandLines } from './control.ts';

export async function main(args = process.argv.slice(2)): Promise<void> {
  const opts = options(args);
  if (opts.help) { process.stdout.write(HELP); return; }
  frameBytes(opts.width, opts.height);
  const iceServers: RTCIceServer[] = opts.stun.map(urls => ({ urls }));
  if (opts.iceConfig) {
    const entries = JSON.parse(await readFile(opts.iceConfig, 'utf8'));
    if (!Array.isArray(entries) || entries.some(s => !s || !(typeof s.urls === 'string' || (Array.isArray(s.urls) && s.urls.every((u: unknown) => typeof u === 'string'))))) throw new Error('--ice-config must contain an RTCIceServer[] JSON array');
    iceServers.push(...entries);
  }
  if (opts.audioIn && opts.audioOut) {
    const input = await realpath(opts.audioIn), output = await realpath(opts.audioOut).catch(() => opts.audioOut);
    if (input === output) throw new Error('Audio input and output must use different files');
  }
  let bot: HeadlessClient | undefined, audioInput: ReadStream | undefined, audioOutput: WriteStream | undefined, videos: VideoFiles | undefined;
  let stopping: Promise<void> | undefined;
  let videoPump: AbortController | undefined;
  const emit = (value: unknown) => {
    if (process.stdout.writableLength > 1024 * 1024) { process.exitCode = 1; void stop(); return; }
    process.stdout.write(`${JSON.stringify(value)}\n`);
  };
  const stop = (): Promise<void> => stopping ??= (async () => {
    videoPump?.abort(); process.stdin.destroy(); audioInput?.destroy();
    await bot?.close();
    audioOutput?.end();
    await Promise.all([audioOutput ? finished(audioOutput).catch(() => {}) : Promise.resolve(), videos?.close()]);
    process.off('SIGINT', signalled); process.off('SIGTERM', signalled);
  })();
  const fail = (error: Error) => { emit({ event: 'error', message: error.message }); process.exitCode = 1; void stop(); };
  const signalled = () => { void stop(); };
  process.on('SIGINT', signalled); process.on('SIGTERM', signalled);

  try {
    bot = await HeadlessClient.connect({ ...opts, iceServers });
    const client = bot;
    for (const event of ['text', 'sharing', 'videoConnection', 'mediaError', 'user'] as const) client.on(event, value => emit({ event, ...value }));
    client.on('warning', message => emit({ event: 'warning', message }));
    client.on('close', reason => { emit({ event: 'closed', reason }); if (!stopping) { process.exitCode = 1; void stop(); } });
    if (opts.audioIn || opts.audioOut) {
      const audio = await client.enableAudio(opts.bitrate);
      audio.input.on('error', error => { if (!stopping) fail(error); });
      if (opts.audioOut) {
        audioOutput = await binaryOutput(opts.audioOut); audioOutput.on('error', fail);
        audio.output.pipe(audioOutput);
      }
      if (opts.audioIn) {
        audioInput = createReadStream(opts.audioIn); audioInput.on('error', fail); audioInput.pipe(audio.input);
      }
    }
    if (opts.videoOut) {
      videos = new VideoFiles(opts.videoOut, opts.fps, value => emit({ event: 'video', ...value }), fail);
      await videos.prepare(); client.on('videoFrame', frame => videos!.push(frame));
      if (opts.watch == null) client.video.autoWatch = true;
    }
    if (opts.watch != null) await client.video.watch(client.user(opts.watch));
    else if (opts.videoOut) await client.video.entered();

    const shareFile = async () => {
      if (!opts.videoIn) return;
      videoPump?.abort(); const controller = videoPump = new AbortController();
      await client.video.start(opts.width, opts.height);
      void pumpVideo(opts.videoIn, frameBytes(opts.width, opts.height), opts.fps, frame => client.video.push(frame), controller.signal)
        .then(() => { if (videoPump === controller) return client.video.stopSharing(); }).catch(e => { if (!controller.signal.aborted && !stopping) fail(e); });
    };
    if (opts.videoIn) await shareFile();
    emit({ event: 'ready', session: client.protocol.session, channel: client.protocol.self?.channelId, name: opts.name,
      audio: { format: 's16le', rate: 48000, channels: 1, enabled: !!client.audio } });

    void (async () => {
      for await (const line of commandLines(process.stdin)) {
        if (stopping) break;
        let id: unknown;
        try {
          if (line.length > 8 * 1024 * 1024) throw new Error('Command exceeds 8 MiB');
          const command = JSON.parse(line); id = command?.id;
          if (!command || typeof command.op !== 'string' || Array.isArray(command)) throw new Error('Expected a JSON object with an op');
          let result: unknown;
          switch (command.op) {
            case 'list': result = {
              users: [...client.protocol.users.values()].map(u => ({ session: u.session, name: u.name, channel: u.channelId })),
              channels: [...client.protocol.channels.values()].map(c => ({ id: c.id, name: c.name, path: client.channelPath(c.id) }))
            }; break;
            case 'send': await client.sendText(command.text, { user: command.user, channel: command.channel, html: command.html === true }); break;
            case 'join': await client.join(command.channel); break;
            case 'mute': if (typeof command.muted !== 'boolean') throw new Error('muted must be a boolean'); client.protocol.setSelfMute(command.muted); break;
            case 'deaf': if (typeof command.deafened !== 'boolean') throw new Error('deafened must be a boolean'); client.protocol.setSelfDeaf(command.deafened); break;
            case 'audio': {
              if (typeof command.data !== 'string' || command.data.length > 256000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(command.data)) throw new Error('audio data must be base64 PCM (at most 96000 samples)');
              const bytes = Buffer.from(command.data, 'base64');
              if (!bytes.length || bytes.length % 2) throw new Error('PCM must contain complete 16-bit samples');
              const audio = await client.enableAudio(opts.bitrate);
              if (audio.input.writableEnded || audio.input.destroyed) throw new Error('Audio input has ended');
              await new Promise<void>((resolve, reject) => audio.input.write(bytes, e => e ? reject(e) : resolve()));
              break;
            }
            case 'share':
              videoPump?.abort();
              if (command.kind != null && !['screen', 'camera'].includes(command.kind)) throw new Error('kind must be screen or camera');
              await client.video.start(command.width ?? opts.width, command.height ?? opts.height, command.kind ?? 'camera'); break;
            case 'video': {
              if (typeof command.data !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(command.data)) throw new Error('video data must be a base64 I420 frame');
              client.video.push(Buffer.from(command.data, 'base64')); break;
            }
            case 'stop-video': videoPump?.abort(); await client.video.stopSharing(); break;
            case 'watch': await client.video.watch(client.user(command.user)); break;
            case 'unwatch': await client.video.unwatch(); break;
            case 'quit': emit({ id, ok: true }); await stop(); return;
            default: throw new Error(`Unknown operation: ${command.op}`);
          }
          emit({ id, ok: true, ...(result === undefined ? {} : { result }) });
        } catch (e) { emit({ id, ok: false, error: (e as Error).message }); }
      }
      if (opts.exitOnEof && !stopping) await stop();
    })().catch(error => { if (!stopping) fail(error); });
  } catch (e) { await stop(); throw e; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch(error => { process.stderr.write(`${JSON.stringify({ event: 'error', message: error.message })}\n`); process.exitCode = 1; });
}
