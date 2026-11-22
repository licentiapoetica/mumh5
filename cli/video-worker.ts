import { MumbleClient, type User } from '../src/core/client.ts';
import { createCodec } from '../src/core/proto.ts';
import { SHARE_DATA_ID } from '../src/core/share-signal.ts';
import { NativeVideo } from './video-native.ts';

const state = new MumbleClient(createCodec());
let nextSignal = 0, frameBusy = false;
let queue = Promise.resolve();
const signals = new Map<number, { resolve(): void; reject(error: Error): void }>();
let video: NativeVideo;
const event = (type: string, value: unknown) => {
  if (!process.connected || (type === 'videoFrame' && frameBusy)) return;
  if (type === 'videoFrame') frameBusy = true;
  process.send!({ op: 'event', type, value }, error => {
    if (type === 'videoFrame') frameBusy = false;
    if (error) process.exit(1);
  });
};

process.on('message', (message: any) => {
  if (message.op === 'signal-reply') {
    const pending = signals.get(message.id); signals.delete(message.id);
    if (pending) message.error ? pending.reject(new Error(message.error)) : pending.resolve();
    return;
  }
  if (message.op === 'state') {
    state.session = message.session; state.serverVersionNum = message.version;
    state.users.clear(); for (const user of message.users) state.users.set(user.session, user as User);
    return;
  }
  if (message.op === 'config') {
    video = new NativeVideo(state, (to, type, text) => new Promise<void>((resolve, reject) => {
      const id = ++nextSignal; signals.set(id, { resolve, reject }); process.send!({ op: 'signal', id, to, type, text });
    }), message.config, event);
    video.autoWatch = message.automatic; return;
  }
  if (message.op === 'automatic') { if (video) video.autoWatch = message.value; return; }
  if (message.op === 'frame') {
    try { video.push(message.data); } catch (e) { event('mediaError', { message: (e as Error).message }); }
    return;
  }
  queue = queue.then(async () => {
    try {
      switch (message.op) {
        case 'start': await video.start(message.width, message.height, message.kind); break;
        case 'stop': await video.stopSharing(); break;
        case 'watch': await video.watch(message.session); break;
        case 'unwatch': await video.unwatch(); break;
        case 'receive': await video.receive(message.sender, SHARE_DATA_ID, message.data); break;
        case 'entered': await video.entered(); break;
        case 'user': await video.userChanged(message.session); break;
        case 'close':
          await video.close();
          // Native node-webrtc receiver finalizers can crash during Node's automatic
          // environment teardown. All media is closed before this isolated exit.
          process.send!({ op: 'reply', id: message.id }, () => process.exit(0)); return;
        default: throw new Error('Unknown native-video operation');
      }
      process.send!({ op: 'reply', id: message.id });
    } catch (e) { process.send!({ op: 'reply', id: message.id, error: (e as Error).message }); }
  });
});
process.on('disconnect', () => { void video?.close().finally(() => process.exit(0)); });
