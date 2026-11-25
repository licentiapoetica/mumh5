// Bundle as an IIFE and run through the Tauri smoke-test build with mock capture enabled.
import { NativeSharePeer, type NativeShareRtc } from '../src/lib/native-share-peer.ts';
import type { NativeApi } from '../src/lib/native.ts';
import { media, painterOf } from '../src/lib/stream-picture.ts';

const invoke = (window as unknown as { __TAURI_INTERNALS__: { invoke(cmd: string, args: unknown): Promise<unknown> } }).__TAURI_INTERNALS__.invoke;
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor<T>(read: () => T | undefined, name: string): Promise<T> {
  for (let i = 0; i < 160; i++) {
    const value = read();
    if (value !== undefined) return value;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${name}`);
}

// Counts what crosses the native boundary, for the failure message
const trace = { sends: 0, sent: 0, sendErrors: [] as string[], receives: 0, received: 0, bytesIn: 0, events: [] as string[] };
function traced(native: NativeShareRtc): NativeShareRtc {
  return {
    ...native,
    open: (id, config, source, audio, notify) => native.open(id, config, source, audio, e => { trace.events.push(`${source ? 'sender' : 'receiver'}:${e}`); notify(e); }),
    send: (source, bytes) => { trace.sends++; return native.send(source, bytes).then(r => { trace.sent++; return r; }, e => { trace.sendErrors.push(String(e)); throw e; }); },
    receive: id => { trace.receives++; return native.receive(id).then(b => { trace.received++; trace.bytesIn += b.byteLength; return b; }); }
  };
}

async function roundtrip(native: NativeShareRtc, source: MediaStream, motion: boolean): Promise<string> {
  native = traced(native);
  const config: RTCConfiguration = { iceServers: [] };
  const sender = new NativeSharePeer(native, config, { stream: source, bitrate: 800000, motion });
  const receiver = new NativeSharePeer(native, config);
  // Shown the way the stage shows it: a video element, painted over by the native painter
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;bottom:0;right:0;width:160px;height:90px;pointer-events:none';
  const player = document.createElement('video');
  player.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
  box.append(player);
  document.body.append(box);
  let shown: ReturnType<typeof media> | undefined;
  let incoming: MediaStream | undefined;
  receiver.onStream = stream => { incoming = stream; if (shown) shown.update(stream); else shown = media(player, stream); };
  const states: { sender?: string; receiver?: string } = {};
  sender.onState = state => { states.sender = state; };
  receiver.onState = state => { states.receiver = state; };
  let offer = '', answer = '';
  try {
    offer = await sender.offer();
    answer = await receiver.answer(offer);
    await sender.accept(answer);
    return await waitFor(() => {
      if (states.sender === 'failed' || states.receiver === 'failed') throw new Error(`Share peer failed: ${JSON.stringify(states)}`);
      const painter = painterOf(incoming);
      const canvas = box.querySelector('canvas');
      if (!painter?.width || !canvas?.width) return undefined;
      // Something other than black reached the canvas on the page
      const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      let lit = 0;
      for (let i = 0; i < pixels.length; i += 4 * 97) if (pixels[i] + pixels[i + 1] + pixels[i + 2] > 60) lit++;
      return lit > 10 ? `${painter.width}x${painter.height}` : undefined;
    }, `decoded video frames (${JSON.stringify(states)})`);
  } catch (error) {
    // What the two sides saw, for finding out why
    const summary = async (peer: NativeSharePeer) => [...(await peer.stats().catch(() => new Map())).values()]
      .filter((r: { type?: string }) => ['transport', 'inbound-rtp', 'outbound-rtp'].includes(r.type ?? ''))
      .map((r: Record<string, unknown>) => JSON.stringify(r));
    const candidates = (sdp: string) => sdp.split(/\r?\n/).filter(l => l.startsWith('a=candidate')).map(l => l.split(' ').slice(4, 8).join(' '));
    throw new Error(`${(error as Error).message}; trace ${JSON.stringify({ ...trace, sendErrors: trace.sendErrors.slice(0, 3) })}; sender ${JSON.stringify(await summary(sender))}; receiver ${JSON.stringify(await summary(receiver))}; offer ${JSON.stringify(candidates(offer))}; answer ${JSON.stringify(candidates(answer))}`);
  } finally {
    sender.close();
    receiver.close();
    shown?.destroy();
    box.remove();
    source.getTracks().forEach(track => track.stop());
  }
}

async function main() {
 try {
  const native = await waitFor(() => (window as Window & { mumh5Native?: NativeApi }).mumh5Native?.shareRtc, 'the Rust share backend');
  // WebKitGTK plays only streams of capture devices, so both rounds use the mock camera
  const open = () => Promise.race([
    navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240 } }),
    delay(12000).then(() => { throw new Error('Timed out opening the mock camera'); })
  ]);
  const screen = await roundtrip(native, await open(), false);
  const cameraStream = await open();
  const camera = await roundtrip(native, cameraStream, true);
  await invoke('smoke_report', { report: { ok: true, screen, camera } });
 } catch (error) {
  await invoke('smoke_report', { report: { ok: false, error: String(error) } });
 }
}

void main();
