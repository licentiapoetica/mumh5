/** The only browser/native boundary. Never exposes TLS private keys to the WebView. */
import type { NativeApi, ContextParams } from './native.ts';
const toBase64 = (bytes: Uint8Array) => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); };
const fromBase64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const ACK_BYTES = 256 * 1024;
/** Joins byte arrays; with `prefix` 2, each gets a u16 little-endian length first (UDP records). */
export function concat(parts: Uint8Array[], prefix: 0 | 2): Uint8Array {
 if (parts.length === 1 && !prefix) return parts[0];
 const out = new Uint8Array(parts.reduce((n, p) => n + p.length + prefix, 0));
 let at = 0;
 for (const p of parts) {
  if (prefix) { out[at] = p.length & 0xff; out[at + 1] = p.length >> 8; at += 2; }
  out.set(p, at); at += p.length;
 }
 return out;
}
const textDecoder = new TextDecoder();
/** Splits a channel message from the wire commands into its records (see wire_frames.rs). */
export function readRecords(buffer: ArrayBuffer, on: (event: string, args: any[]) => void): void {
 const view = new DataView(buffer);
 for (let at = 0; at + 5 <= buffer.byteLength;) {
  const kind = view.getUint8(at), length = view.getUint32(at + 1, true);
  const payload = new Uint8Array(buffer, at + 5, length);
  at += 5 + length;
  if (kind === 0) on('data', [payload]);
  // A datagram is small and may be kept or transferred; it must not pin or detach the batch
  else if (kind === 1) on('udpVoice', [payload.slice()]);
  else { const msg = JSON.parse(textDecoder.decode(payload)); on(msg.event, msg.args); }
 }
}
export async function initializePlatform(): Promise<void> {
 if (!('__TAURI_INTERNALS__' in window)) return;
 const core = await import('@tauri-apps/api/core');
 const { Channel } = core;
 // Tauri rejects with the command's error string; the app (as with Electron) expects Error objects.
 const invoke = <T = unknown>(cmd: string, args?: Record<string, unknown> | Uint8Array, options?: { headers: Record<string, string> }): Promise<T> =>
  core.invoke<T>(cmd, args, options).catch((e: unknown) => { throw e instanceof Error ? e : new Error(typeof e === 'string' ? e : JSON.stringify(e)); });
 const { listen } = await import('@tauri-apps/api/event');
 const { getCurrentWindow } = await import('@tauri-apps/api/window');
 const { openUrl } = await import('@tauri-apps/plugin-opener');
 const call = <T = any>(action: string, args: unknown = {}) => invoke<T>('platform_call', { action, args });
 const cache = await call<Record<string, string>>('bootstrap');
 const events = new Map<string, Set<(id: string, ...args: any[]) => void>>();
 const emit = (name: string, id: string, args: any[]) => { for (const f of events.get(name) ?? []) f(id, ...args); };
 const channels = new Map<string, InstanceType<typeof Channel<ArrayBuffer>>>();
 const active = new Set<string>();
 // Outgoing bytes per connection: one request in flight, later sends join the next one, so a
 // burst costs a few IPC round trips instead of one each, and order is kept.
 const outgoing = new Map<string, Uint8Array[]>();
 const raw = (cmd: string, id: string, body: Uint8Array) => invoke<void>(cmd, body, { headers: { 'mumh5-wire': id } });
 const flushStream = async (id: string) => {
  for (let queue = outgoing.get(id); queue?.length; queue = outgoing.get(id)) {
   outgoing.set(id, []);
   await raw('wire_send', id, concat(queue, 0));
  }
  outgoing.delete(id);
 };
 // UDP keeps setup and nonce changes in order with the datagrams around them.
 type UdpOp = { packet: Uint8Array } | { action: string; args: unknown; done: (v: unknown) => void; fail: (e: unknown) => void };
 const udpQueues = new Map<string, UdpOp[]>();
 const flushUdp = async (id: string) => {
  for (let queue = udpQueues.get(id); queue?.length; queue = udpQueues.get(id)) {
   const head = queue[0];
   if ('action' in head) {
    queue.shift();
    await invoke('wire_udp', { id, action: head.action, args: head.args }).then(head.done, head.fail);
    continue;
   }
   let n = 0; while (n < queue.length && 'packet' in queue[n]) n++;
   const packets = queue.splice(0, n).map(op => (op as { packet: Uint8Array }).packet);
   await raw('wire_udp_send', id, concat(packets, 2)).catch(e => console.error('Native operation failed:', e));
  }
  udpQueues.delete(id);
 };
 const udpEnqueue = (id: string, op: UdpOp) => {
  const queue = udpQueues.get(id);
  if (queue) { queue.push(op); return; }
  udpQueues.set(id, [op]); void flushUdp(id);
 };
 const udpCall = <T = unknown>(id: string, action: string, args: unknown) => new Promise<T>((done, fail) => udpEnqueue(id, { action, args, done: done as (v: unknown) => void, fail }));
 const forget = (id: string) => { active.delete(id); channels.delete(id); outgoing.delete(id); udpQueues.delete(id); };
 const report = (p: Promise<unknown>) => { void p.catch(e => console.error('Native operation failed:', e)); };
 const relayCall = <T = any>(id: string, action: string, args: unknown) => invoke<T>('wire_relay', { id, action, args });
 const api: NativeApi = {
  relaySupported: true,
  platformInfo: () => call('platformInfo'), describeCerts: ders => call('describeCerts', { ders: ders.map(toBase64) }),
  pingServer: (host, port) => call('ping', { host, port }),
  identities: {
   list: () => call('identityList'), create: (name, email) => call('identityCreate', { name, email }),
   importP12: (bytes, password, name) => call('identityImport', { p12: toBase64(bytes), password, name }),
   findMumble: () => call('findMumble'), importMumble: name => call('importMumble', { name }),
   exportP12: (id, password) => call('identityExport', { id, password }),
   setDefault: id => call('identityChange', { op: 'setDefault', id }), rename: (id, name) => call('identityChange', { op: 'rename', id, name }),
   remove: id => call('identityChange', { op: 'remove', id }), finishSetup: () => call('identityChange', { op: 'finishSetup' })
  },
  savedState: {
   sync(key, local, merge) {
    if (cache[key] === undefined && merge && local !== null) { cache[key] = local; report(call('stateWrite', { key, raw: local })); }
    if (merge && local !== null && cache[key] !== undefined) {
     try {
      const a = JSON.parse(cache[key]), b = JSON.parse(local);
      if (key === 'mumh5.servers' && Array.isArray(a) && Array.isArray(b)) {
       cache[key] = JSON.stringify([...a, ...b.filter(s => !a.some(x => x.id === s.id || (String(x.host).toLowerCase() === String(s.host).toLowerCase() && x.port === s.port && x.username === s.username)))]);
      } else if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
       for (const [k, v] of Object.entries(b)) a[k] = Array.isArray(a[k]) && Array.isArray(v) ? [...new Set([...a[k], ...v])] : v;
       cache[key] = JSON.stringify(a);
      }
      report(call('stateWrite', { key, raw: cache[key] }));
     } catch { /* Keep the valid native backup when an origin has damaged data. */ }
    }
    return cache[key] ?? local;
   },
   write(key, raw) { cache[key] = raw; report(call('stateWrite', { key, raw })); return true; }
  },
  sounds: {
   load: () => call('soundsLoad'), save: settings => call('soundsSave', { settings }),
   read: async key => { const b = await call<string | null>('soundRead', { key }); return b === null ? null : fromBase64(b); },
   write: (key, bytes) => call('soundWrite', { key, data: toBase64(bytes) }), remove: key => call('soundRemove', { key })
  },
  updateTray: state => report(call('updateTray', state)),
  onTrayAction(fn) { void listen<string>('tray-action', e => fn(e.payload)); },
  attention: () => report(call('attention')), showWindow: () => report(call('showWindow')),
  onWindowShown(fn) {
   if (/Android/i.test(navigator.userAgent)) { const update = () => fn(!document.hidden); update(); document.addEventListener('visibilitychange', update); return () => document.removeEventListener('visibilitychange', update); }
   const w = getCurrentWindow(); let stopped = false;
   const update = async () => { const shown = await w.isVisible() && !await w.isMinimized(); if (!stopped) fn(shown); };
   report(update()); const off = w.onFocusChanged(() => report(update())); const resize = w.onResized(() => report(update()));
   return () => { stopped = true; void off.then(f => f()); void resize.then(f => f()); };
  },
  linkPreview: url => call('linkPreview', { url }), publicServers: url => call('publicServers', { url }),
  onContextMenu(fn) {
   window.addEventListener('contextmenu', event => {
    if (event.defaultPrevented) return;
    const target = event.target as HTMLElement;
    const editable = !!target.closest('input,textarea,[contenteditable="true"]');
    const link = target.closest<HTMLAnchorElement>('a[href]'); const image = target.closest<HTMLImageElement>('img');
    const p: ContextParams = { x: event.clientX, y: event.clientY, isEditable: editable, selectionText: getSelection()?.toString() ?? '', linkURL: link?.href ?? '', mediaType: image ? 'image' : '', srcURL: image?.src ?? '', misspelledWord: '', suggestions: [], editFlags: { canUndo: editable, canRedo: editable, canCut: editable, canCopy: true, canPaste: editable, canSelectAll: true } };
    event.preventDefault(); fn(p);
   });
  },
  editAction(action, arg) {
   if (action === 'copyImageAt' || action === 'saveImage') {
    const image = action === 'copyImageAt' ? document.elementFromPoint((arg as { x: number; y: number }).x, (arg as { x: number; y: number }).y)?.closest<HTMLImageElement>('img') : null;
    const url = image?.src ?? (typeof arg === 'string' ? arg : '');
    if (url) report((async () => {
     const data = /^(data:|blob:)/.test(url) ? toBase64(new Uint8Array(await (await fetch(url)).arrayBuffer())) : undefined;
     await call(action === 'saveImage' ? 'saveImage' : 'copyImage', { url, data });
    })());
    return;
   }
   if (['undo', 'redo', 'cut', 'copy', 'selectAll'].includes(action)) document.execCommand(action);
   else if (action === 'paste') report(navigator.clipboard.readText().then(text => { document.execCommand('insertText', false, text); }));
  },
  // WebView/OS picker controls screen access. The normal camera and mic APIs remain unchanged.
  screenSources: async () => ({ sources: [{ id: 'portal', name: 'Choose with system picker', thumbnail: '' }], chosen: false }),
  pickScreenSource() {}, shareInfo: () => call('shareInfo'), shareAudioApps: () => call('shareAudioApps'),
  shareAudioStart: target => call('shareAudioStart', { target }), shareAudioStop: () => call('shareAudioStop'),
  audioOutputs: () => call('audioOutputs'), setAudioOutput: id => call('setAudioOutput', { id }),
  hotkeysBind: shortcuts => call('hotkeysBind', { shortcuts }), hotkeysUnbind: () => call('hotkeysUnbind'), setZoom: factor => call('setZoom', { factor }),
  onHotkey: fn => { let off: (() => void) | null = null, gone = false; void listen<{ id: string; pressed: boolean }>('hotkey', e => fn(e.payload.id, e.payload.pressed)).then(u => { if (gone) u(); else off = u; }); return () => { gone = true; off?.(); }; },
  canPickColor: () => call('canPickColor'), pickColor: () => call('pickColor'),
  async open(id, host, port, identityId) {
   active.add(id);
   const channel = new Channel<ArrayBuffer>(); channels.set(id, channel);
   let unacked = 0;
   channel.onmessage = buffer => {
    if (!active.has(id)) return;
    try { readRecords(buffer, (event, args) => { if (active.has(id)) emit(event, id, args); if (event === 'close') forget(id); }); }
    finally {
     // The native side waits once a window of 1 MiB is unacknowledged (wire_frames.rs)
     unacked += buffer.byteLength;
     if (unacked >= ACK_BYTES && active.has(id)) { report(invoke('wire_ack', { id, bytes: unacked })); unacked = 0; }
    }
   };
   try { await invoke('wire_open', { id, host, port, identityId: identityId ?? null, events: channel }); if (!active.has(id)) await invoke('wire_close', { id }); }
   catch (e) { forget(id); emit('close', id, [String(e)]); throw e; }
  },
  send(id, bytes) {
   const queue = outgoing.get(id);
   // Copied when held: the caller may reuse its buffer before the next request goes out
   if (queue) { queue.push(bytes.slice()); return; }
   outgoing.set(id, [bytes]);
   void flushStream(id).catch(e => { if (active.has(id)) { emit('close', id, [String(e)]); api.close(id); } });
  },
  close(id) { forget(id); emit('close', id, ['Connection closed']); report(invoke('wire_close', { id })); },
  relayOpen: (id, rid, endpoint, token, lowSide) => relayCall(id, 'open', { rid, endpoint, token, lowSide }), relayTurn: (id, rid, lane) => relayCall(id, 'turn', { rid, lane }), relayCloseLane: (id, rid, lane) => report(relayCall(id, 'closeLane', { rid, lane })), relayClose: (id, rid) => report(relayCall(id, 'close', { rid })),
  on(name, fn) { const set = events.get(name) ?? new Set(); events.set(name, set); set.add(fn); return () => { set.delete(fn); }; },
  udpSetup: (id, key, cn, sn, protobuf) => report(udpCall(id, 'setup', { key: [...key], cn: [...cn], sn: [...sn], protobuf })),
  udpNonce: (id, sn) => report(udpCall(id, 'nonce', { sn: [...sn] })),
  udpSend: (id, bytes) => udpEnqueue(id, { packet: bytes.slice() }),
  udpClientNonce: async id => { const n = await udpCall<number[] | null>(id, 'clientNonce', {}); return n ? new Uint8Array(n) : null; }
 };
 window.mumh5Native = api;
 // Open external links with the system browser. Keep untrusted pages outside native IPC.
 addEventListener('click', e => { const a = (e.target as HTMLElement)?.closest<HTMLAnchorElement>('a[href]'); if (a && /^https?:/.test(a.href)) { e.preventDefault(); report(openUrl(a.href)); } });
 const originalOpen = window.open.bind(window);
 window.open = (url, ...rest) => { if (url && /^https?:/i.test(String(url))) { report(openUrl(String(url))); return null; } return originalOpen(url, ...rest); };
}
