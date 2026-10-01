// Screen sharing between mumh5 clients in the same channel. Mumble has no video, so the
// picture goes directly from the sharer to each viewer over WebRTC; only the setup messages
// travel through the Mumble server (as plugin data, see core/share-signal.ts). The server has
// checked the sender's certificate, so a stream is known to come from that user.
import { SHARE, SHARE_DATA_ID, encodeShare, ShareAssembler, type ShareType } from '../core/share-signal.ts';
import type { User } from '../core/client.ts';
import type { Session } from './session.svelte.ts';
import { desktop, isWeb } from './native.ts';
import { proxyIce, relayIce } from './web.svelte.ts';
import { store } from './settings.svelte.ts';
import { ui } from './ui.svelte.ts';
import { sounds } from './audio/sounds.svelte.ts';

// Every viewer is a separate upload from the sharer
const MAX_VIEWERS = 8;
// Cameras watched at once; each is a download and a decoder
const MAX_CAMERAS = 12;
// A face needs far less than a screen full of text
const CAMERA_BITRATE = 1_200_000;
export const QUALITY = {
  low: { label: 'Low (1 Mbit/s, 30 fps)', bitrate: 1_000_000, fps: 30 },
  medium: { label: 'Medium (4 Mbit/s, 30 fps)', bitrate: 4_000_000, fps: 30 },
  high: { label: 'High (8 Mbit/s, 60 fps)', bitrate: 8_000_000, fps: 60 }
} as const;

// Opus is negotiated as mono speech by default; shared sound is stereo and often music
const stereo = (sdp: string) => sdp.replace(/a=fmtp:(\d+) ([^\r\n]*useinbandfec=1[^\r\n]*)/g,
  (line, pt, rest) => rest.includes('stereo=1') ? line : `a=fmtp:${pt} ${rest};stereo=1;sprop-stereo=1;maxaveragebitrate=192000`);

// What a stream shows. Sent along with the announcement, so others see the right icon.
export type ShareKind = 'screen' | 'camera';

export interface Watching {
  host: Session;
  session: number;
  kind: ShareKind;
  stream: MediaStream | null;
  state: 'connecting' | 'live' | 'failed';
}

class ScreenShare {
  // The server we are sharing on, and what we send
  host = $state.raw<Session | null>(null);
  stream = $state.raw<MediaStream | null>(null);
  kind = $state<ShareKind>('screen');
  // Show our own camera mirrored to ourselves, as a mirror would. Not a camera pointing away
  // from us (a phone's back camera), and never what the others get.
  mirror = $state(false);
  viewers = $state(0);
  // Streams we receive: one screen at a time, and any number of cameras next to it
  watches = $state.raw<Watching[]>([]);
  // People whose camera we chose not to see, by certificate (or name); until the app restarts
  hidden = $state<Record<string, boolean>>({});
  error = $state('');
  // The server the start dialog is open for
  dialog = $state.raw<Session | null>(null);
  private usesVirtualMic = false;

  private peers = new Map<number, RTCPeerConnection>();
  private watchPcs = new Map<number, RTCPeerConnection>();
  private watchTimers = new Map<number, ReturnType<typeof setTimeout>>();
  private assemblers = new WeakMap<Session, ShareAssembler>();
  // Viewers whose connection came up, so leaving is only announced for those
  private live = new Set<number>();
  // When we entered the channel: streams already running there are not announced with a sound
  private enteredAt = new WeakMap<Session, number>();

  // Plugin data needs a 1.4 server; older ones would not pass the signals on
  supported(s: Session): boolean {
    return !!s.client && s.client.serverVersionNum >= 0x010400 && typeof RTCPeerConnection !== 'undefined';
  }

  private async iceServers(): Promise<RTCIceServer[]> {
    const stun = store.settings.stunServer.trim();
    const chosen: RTCIceServer[] = stun ? [{ urls: /^stuns?:/.test(stun) ? stun : `stun:${stun}` }] : [];
    // A mumh5 proxy adds its STUN and its relay, which takes over by itself when no direct
    // connection comes up (mobile and company networks, browsers that forbid direct UDP). The
    // browser build has the proxy it is served from; the desktop app the one set in Settings.
    const relay = store.settings.relayServer.trim();
    return [...chosen, ...(relay ? await relayIce(relay) : isWeb ? await proxyIce() : [])];
  }

  // For testing the relay: localStorage mumh5.iceDebug = "relay" uses only relayed routes,
  // "relay-tcp" only the relay reached over TCP (what a browser without direct UDP is left with)
  private async rtcConfig(): Promise<RTCConfiguration> {
    const iceServers = await this.iceServers();
    let debug = '';
    try { debug = localStorage.getItem('mumh5.iceDebug') ?? ''; } catch { /* storage unavailable */ }
    if (!debug.startsWith('relay')) return { iceServers };
    const tcpOnly = (urls: string | string[]) => [urls].flat().filter(u => !u.startsWith('turn') || u.includes('transport=tcp'));
    return { iceTransportPolicy: 'relay', iceServers: debug === 'relay-tcp' ? iceServers.map(s => ({ ...s, urls: tcpOnly(s.urls) })) : iceServers };
  }

  private others(s: Session): number[] {
    const self = s.client?.self;
    if (!self) return [];
    return [...s.client!.users.values()].filter(u => u.session !== self.session && u.channelId === self.channelId).map(u => u.session);
  }

  private inMyChannel(s: Session, session: number): boolean {
    const self = s.client?.self;
    return !!self && s.client!.users.get(session)?.channelId === self.channelId;
  }

  private async send(s: Session, to: number[], type: ShareType, text?: string): Promise<void> {
    if (!to.length) return;
    for (const packet of await encodeShare(type, text)) s.client?.sendPluginData(to, SHARE_DATA_ID, packet);
  }

  // Sharer and viewer connect directly, so each learns the other's address; say so once
  private notice(): Promise<boolean> {
    if (store.settings.shareNoticeSeen) return Promise.resolve(true);
    return new Promise(resolve => {
      let answered = false;
      ui.prompt = {
        title: 'Screen sharing', label: '', confirm: 'Continue', input: 'none',
        text: 'Screen sharing connects you directly to other participants in this channel. You see each other\'s IP address. Only mumh5 users in your channel can watch.',
        onsubmit: () => { answered = true; store.settings.shareNoticeSeen = true; store.saveSettings(); resolve(true); },
        oncancel: () => { if (!answered) resolve(false); }
      };
    });
  }

  // Opens the dialog where the source, the sound and the quality are chosen
  async start(s: Session): Promise<void> {
    if (this.stream || this.dialog || !this.supported(s) || !(await this.notice())) return;
    this.error = '';
    this.dialog = s;
  }

  // The dialog hands over what it captured
  go(s: Session, stream: MediaStream, usesVirtualMic: boolean, kind: ShareKind = 'screen'): void {
    this.dialog = null;
    // Disconnected while the dialog was open
    if (!s.client || this.stream) {
      stream.getTracks().forEach(t => t.stop());
      if (usesVirtualMic) desktop?.shareAudioStop();
      return;
    }
    for (const t of stream.getVideoTracks()) {
      // Text on a screen must stay sharp; a face may blur a little but should move smoothly
      t.contentHint = kind === 'camera' ? 'motion' : 'detail';
      // The system's "stop sharing" control
      t.addEventListener('ended', () => this.stop());
    }
    this.usesVirtualMic = usesVirtualMic;
    this.kind = kind;
    this.mirror = kind === 'camera' && stream.getVideoTracks()[0]?.getSettings().facingMode !== 'environment';
    this.host = s;
    this.stream = stream;
    this.send(s, this.others(s), SHARE.on, kind);
    s.setSharing(s.client.session!, kind);
    sounds.play('shareStarted');
  }

  private release(): void {
    this.dropPeers();
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
    this.host = null;
    if (this.usesVirtualMic) desktop?.shareAudioStop();
    this.usesVirtualMic = false;
  }

  stop(): void {
    const s = this.host;
    if (this.stream) sounds.play('shareStopped');
    if (s?.client) {
      this.send(s, this.others(s), SHARE.off);
      if (s.client.session != null) s.setSharing(s.client.session, false);
    }
    this.release();
  }

  private dropPeers(): void {
    for (const pc of this.peers.values()) pc.close();
    this.peers.clear();
    this.live.clear();
    this.viewers = 0;
  }

  private dropPeer(session: number): void {
    this.peers.get(session)?.close();
    this.peers.delete(session);
    if (this.live.delete(session)) sounds.play('viewerLeft');
    this.viewers = this.peers.size;
  }

  // The screen being watched, if any (there is at most one)
  get watching(): Watching | null {
    return this.watches.find(w => w.kind === 'screen') ?? null;
  }
  watchOf(session: number): Watching | undefined {
    return this.watches.find(w => w.session === session);
  }

  // Cameras come on by themselves, like in a video call, once the note about IP addresses was
  // confirmed; each person's can be hidden, and the whole thing switched off
  get cams(): boolean {
    return store.settings.autoCameras;
  }
  private who(s: Session, session: number): string {
    const u = s.client?.users.get(session);
    return u ? u.hash || `name:${u.name}` : '';
  }
  isHidden(s: Session, session: number): boolean {
    return !!this.hidden[this.who(s, session)];
  }
  hideCamera(s: Session, session: number, hide: boolean): void {
    const key = this.who(s, session);
    if (!key) return;
    if (hide) { this.hidden[key] = true; this.unwatch(session); }
    else { delete this.hidden[key]; this.watch(s, session); }
  }
  private autoWatch(s: Session, session: number): void {
    if (this.cams && store.settings.shareNoticeSeen && s.sharing[session] === 'camera' && !this.isHidden(s, session)) this.watch(s, session);
  }

  async watch(s: Session, session: number): Promise<void> {
    const kind = s.sharing[session];
    if (!this.supported(s) || !kind || this.watchOf(session) || !(await this.notice())) return;
    // Streams from another server, and another screen, make way
    for (const w of this.watches) if (w.host !== s || (kind === 'screen' && w.kind === 'screen')) this.unwatch(w.session);
    if (kind === 'camera' && this.watches.filter(w => w.kind === 'camera').length >= MAX_CAMERAS) return;
    if (!s.sharing[session] || this.watchOf(session)) return;
    // Asking for it shows it again
    delete this.hidden[this.who(s, session)];
    this.watches = [...this.watches, { host: s, session, kind, stream: null, state: 'connecting' }];
    this.send(s, [session], SHARE.watch);
    this.watchTimers.set(session, setTimeout(() => this.setWatchState(session, 'failed'), 20000));
  }

  // One stream, or all of them
  unwatch(session?: number): void {
    for (const w of this.watches) {
      if (session != null && w.session !== session) continue;
      if (w.host.client) this.send(w.host, [w.session], SHARE.leave);
      this.endWatch(w.session);
    }
  }

  private endWatch(session: number): void {
    clearTimeout(this.watchTimers.get(session));
    this.watchTimers.delete(session);
    this.watchPcs.get(session)?.close();
    this.watchPcs.delete(session);
    this.watches = this.watches.filter(w => w.session !== session);
  }

  private setWatchState(session: number, state: Watching['state'], stream?: MediaStream): void {
    if (!this.watchOf(session)) return;
    if (state !== 'connecting') { clearTimeout(this.watchTimers.get(session)); this.watchTimers.delete(session); }
    this.watches = this.watches.map(w => w.session === session ? { ...w, state, stream: stream ?? w.stream } : w);
  }

  // All cameras on or off, remembered
  async setCams(s: Session, on: boolean): Promise<void> {
    if (on && (!this.supported(s) || !(await this.notice()))) return;
    store.settings.autoCameras = on;
    store.saveSettings();
    if (!on) {
      for (const w of this.watches) if (w.kind === 'camera') this.unwatch(w.session);
      return;
    }
    for (const session of Object.keys(s.sharing)) if (Number(session) !== s.client?.session) this.autoWatch(s, Number(session));
  }

  // Candidates travel inside the description, so wait for them instead of sending each one
  private gathered(pc: RTCPeerConnection): Promise<void> {
    if (pc.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise(resolve => {
      const done = () => { clearTimeout(timer); pc.removeEventListener('icegatheringstatechange', check); resolve(); };
      const check = () => { if (pc.iceGatheringState === 'complete') done(); };
      const timer = setTimeout(done, 3000);
      pc.addEventListener('icegatheringstatechange', check);
    });
  }

  private async offerTo(s: Session, viewer: number): Promise<void> {
    const stream = this.stream;
    if (!stream || this.host !== s) return;
    const config = await this.rtcConfig();
    if (this.stream !== stream || this.host !== s) return;
    this.dropPeer(viewer);
    if (this.peers.size >= MAX_VIEWERS) return;
    const pc = new RTCPeerConnection(config);
    this.peers.set(viewer, pc);
    this.viewers = this.peers.size;
    pc.addEventListener('connectionstatechange', () => {
      if (this.peers.get(viewer) !== pc) return;
      if (pc.connectionState === 'connected' && !this.live.has(viewer)) {
        this.live.add(viewer);
        sounds.play('viewerJoined');
      } else if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.dropPeer(viewer);
    });
    for (const track of stream.getTracks()) {
      const sender = pc.addTrack(track, stream);
      if (track.kind !== 'video') continue;
      const params = sender.getParameters();
      // Keep the picture sharp and let the frame rate drop when the connection is tight
      params.degradationPreference = this.kind === 'camera' ? 'maintain-framerate' : 'maintain-resolution';
      const wanted = QUALITY[store.settings.shareQuality].bitrate;
      for (const enc of params.encodings ?? []) enc.maxBitrate = this.kind === 'camera' ? Math.min(wanted, CAMERA_BITRATE) : wanted;
      await sender.setParameters(params).catch(() => {});
    }
    await pc.setLocalDescription({ type: 'offer', sdp: stereo((await pc.createOffer()).sdp ?? '') });
    await this.gathered(pc);
    if (this.peers.get(viewer) === pc && pc.localDescription) await this.send(s, [viewer], SHARE.offer, pc.localDescription.sdp);
  }

  private async answerTo(s: Session, sharer: number, sdp: string): Promise<void> {
    const mine = () => { const w = this.watchOf(sharer); return !!w && w.host === s; };
    if (!mine()) return;
    const config = await this.rtcConfig();
    if (!mine()) return;
    this.watchPcs.get(sharer)?.close();
    const pc = new RTCPeerConnection(config);
    this.watchPcs.set(sharer, pc);
    const current = () => this.watchPcs.get(sharer) === pc;
    // The track is announced with the description, before any route exists: the stream only
    // counts as live once the connection is up, otherwise the viewer stares at a black picture
    pc.addEventListener('track', e => {
      if (current()) this.setWatchState(sharer, pc.connectionState === 'connected' ? 'live' : 'connecting', e.streams[0]);
    });
    pc.addEventListener('connectionstatechange', () => {
      if (!current()) return;
      if (pc.connectionState === 'connected') this.setWatchState(sharer, 'live');
      else if (pc.connectionState === 'failed') this.setWatchState(sharer, 'failed');
    });
    try {
      await pc.setRemoteDescription({ type: 'offer', sdp });
      await pc.setLocalDescription({ type: 'answer', sdp: stereo((await pc.createAnswer()).sdp ?? '') });
      await this.gathered(pc);
      if (current() && pc.localDescription) await this.send(s, [sharer], SHARE.answer, pc.localDescription.sdp);
    } catch {
      if (current()) this.setWatchState(sharer, 'failed');
    }
  }

  // Raw WebRTC statistics for the overlay: of a stream we watch, or one per viewer of ours
  async reports(own: boolean, session?: number): Promise<{ viewer: number | null; report: RTCStatsReport }[]> {
    if (!own) {
      const pc = session != null ? this.watchPcs.get(session) : undefined;
      return pc ? [{ viewer: null, report: await pc.getStats() }] : [];
    }
    return Promise.all([...this.peers].map(async ([viewer, pc]) => ({ viewer, report: await pc.getStats() })));
  }

  // ─── Called by the session ────────────────────────────────────────────────

  async receive(s: Session, sender: number, dataId: string, data: Uint8Array): Promise<void> {
    if (dataId !== SHARE_DATA_ID) return;
    let assembler = this.assemblers.get(s);
    if (!assembler) this.assemblers.set(s, assembler = new ShareAssembler());
    const msg = await assembler.push(sender, data);
    // Only people in our channel take part
    if (!msg || !s.client || !this.inMyChannel(s, sender)) return;
    switch (msg.type) {
      case SHARE.on:
        if (!s.sharing[sender] && Date.now() - (this.enteredAt.get(s) ?? 0) > 3000) sounds.play('shareStarted');
        s.setSharing(sender, msg.text === 'camera' ? 'camera' : 'screen');
        this.autoWatch(s, sender);
        break;
      case SHARE.off:
        if (s.sharing[sender]) sounds.play('shareStopped');
        s.setSharing(sender, false);
        if (this.watchOf(sender)?.host === s) this.endWatch(sender);
        break;
      case SHARE.who: if (this.host === s) this.send(s, [sender], SHARE.on, this.kind); break;
      case SHARE.watch: if (this.host === s) this.offerTo(s, sender).catch(() => this.dropPeer(sender)); break;
      case SHARE.leave: if (this.host === s) this.dropPeer(sender); break;
      case SHARE.offer: if (msg.text) this.answerTo(s, sender, msg.text); break;
      case SHARE.answer:
        if (this.host === s && msg.text) this.peers.get(sender)?.setRemoteDescription({ type: 'answer', sdp: msg.text }).catch(() => this.dropPeer(sender));
        break;
    }
  }

  // We connected or moved: ask who is sharing here, and tell the new channel about our stream
  entered(s: Session): void {
    if (!this.supported(s)) return;
    const self = s.client!.session!;
    this.enteredAt.set(s, Date.now());
    s.clearSharing();
    for (const w of this.watches) if (w.host === s) this.unwatch(w.session);
    if (this.host === s) {
      this.dropPeers();
      s.setSharing(self, this.kind);
      this.send(s, this.others(s), SHARE.on, this.kind);
    }
    this.send(s, this.others(s), SHARE.who);
  }

  // Someone else connected, moved or left
  userMoved(s: Session, user: User, gone = false): void {
    if (!s.client?.self || user.session === s.client.session) return;
    if (!gone && this.inMyChannel(s, user.session)) {
      if (this.host === s) this.send(s, [user.session], SHARE.on, this.kind);
      return;
    }
    // A sharer who left or disconnected: their stream is over for us
    if (s.sharing[user.session]) sounds.play('shareStopped');
    s.setSharing(user.session, false);
    if (this.host === s) this.dropPeer(user.session);
    if (this.watchOf(user.session)?.host === s) this.endWatch(user.session);
  }

  closed(s: Session): void {
    if (this.host === s) this.release();
    if (this.dialog === s) this.dialog = null;
    for (const w of this.watches) if (w.host === s) this.endWatch(w.session);
  }
}

export const share = new ScreenShare();
