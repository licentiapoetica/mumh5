// Screen sharing between mumh5 clients in the same channel. Mumble has no video, so the
// picture goes directly from the sharer to each viewer over WebRTC; only the setup messages
// travel through the Mumble server (as plugin data, see core/share-signal.ts). The server has
// checked the sender's certificate, so a stream is known to come from that user.
import { SHARE, SHARE_DATA_ID, encodeShare, ShareAssembler, type ShareType } from '../core/share-signal.ts';
import type { User } from '../core/client.ts';
import type { Session } from './session.svelte.ts';
import { desktop, type ScreenSource } from './native.ts';
import { store } from './settings.svelte.ts';
import { ui } from './ui.svelte.ts';

// Every viewer is a separate upload from the sharer
const MAX_VIEWERS = 8;
const MAX_BITRATE = 4_000_000;

export interface Watching {
  host: Session;
  session: number;
  stream: MediaStream | null;
  state: 'connecting' | 'live' | 'failed';
}

class ScreenShare {
  // The server we are sharing on, and what we send
  host = $state.raw<Session | null>(null);
  stream = $state.raw<MediaStream | null>(null);
  viewers = $state(0);
  watching = $state.raw<Watching | null>(null);
  error = $state('');
  // Source choice in the desktop app (the browser brings its own picker)
  picker = $state.raw<{ sources: ScreenSource[]; choose: (id: string | null) => void } | null>(null);

  private peers = new Map<number, RTCPeerConnection>();
  private watchPc: RTCPeerConnection | null = null;
  private watchTimer: ReturnType<typeof setTimeout> | undefined;
  private assemblers = new WeakMap<Session, ShareAssembler>();

  // Plugin data needs a 1.4 server; older ones would not pass the signals on
  supported(s: Session): boolean {
    return !!s.client && s.client.serverVersionNum >= 0x010400 && typeof RTCPeerConnection !== 'undefined';
  }

  private iceServers(): RTCIceServer[] {
    const stun = store.settings.stunServer.trim();
    return stun ? [{ urls: /^stuns?:/.test(stun) ? stun : `stun:${stun}` }] : [];
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
        text: 'Screen sharing connects you directly to the other person. You see each other\'s IP address, like in a video call. Only mumh5 users in your channel can watch.',
        onsubmit: () => { answered = true; store.settings.shareNoticeSeen = true; store.saveSettings(); resolve(true); },
        oncancel: () => { if (!answered) resolve(false); }
      };
    });
  }

  private async capture(): Promise<MediaStream> {
    if (desktop) {
      const { sources, chosen } = await desktop.screenSources();
      // Cancelled in the system's picker
      if (!sources.length) throw new Error('');
      const id = chosen ? sources[0].id
        : await new Promise<string | null>(choose => { this.picker = { sources, choose }; });
      this.picker = null;
      if (!id) throw new Error('');
      desktop.pickScreenSource(id);
    }
    return navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false });
  }

  async start(s: Session): Promise<void> {
    if (this.stream || !this.supported(s) || !(await this.notice())) return;
    this.error = '';
    let stream: MediaStream;
    try {
      stream = await this.capture();
    } catch (e) {
      // Cancelling the picker is not an error worth showing
      const msg = (e as Error).message;
      if (msg && (e as Error).name !== 'NotAllowedError') this.error = `Could not capture the screen: ${msg}`;
      return;
    }
    // Disconnected while the picker was open
    if (!s.client) return stream.getTracks().forEach(t => t.stop());
    for (const t of stream.getVideoTracks()) {
      t.contentHint = 'detail';
      // The system's "stop sharing" control
      t.addEventListener('ended', () => this.stop());
    }
    this.host = s;
    this.stream = stream;
    this.send(s, this.others(s), SHARE.on);
    s.setSharing(s.client.session!, true);
  }

  stop(): void {
    const s = this.host;
    if (s?.client) {
      this.send(s, this.others(s), SHARE.off);
      if (s.client.session != null) s.setSharing(s.client.session, false);
    }
    this.dropPeers();
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
    this.host = null;
  }

  private dropPeers(): void {
    for (const pc of this.peers.values()) pc.close();
    this.peers.clear();
    this.viewers = 0;
  }

  private dropPeer(session: number): void {
    this.peers.get(session)?.close();
    this.peers.delete(session);
    this.viewers = this.peers.size;
  }

  async watch(s: Session, session: number): Promise<void> {
    if (!this.supported(s) || !s.sharing[session] || !(await this.notice())) return;
    this.unwatch();
    this.watching = { host: s, session, stream: null, state: 'connecting' };
    this.send(s, [session], SHARE.watch);
    this.watchTimer = setTimeout(() => this.setWatchState('failed'), 20000);
  }

  unwatch(): void {
    const w = this.watching;
    if (!w) return;
    if (w.host.client) this.send(w.host, [w.session], SHARE.leave);
    this.endWatch();
  }

  private endWatch(): void {
    clearTimeout(this.watchTimer);
    this.watchPc?.close();
    this.watchPc = null;
    this.watching = null;
  }

  private setWatchState(state: Watching['state'], stream?: MediaStream): void {
    const w = this.watching;
    if (!w) return;
    if (state !== 'connecting') clearTimeout(this.watchTimer);
    this.watching = { ...w, state, stream: stream ?? w.stream };
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
    this.dropPeer(viewer);
    if (this.peers.size >= MAX_VIEWERS) return;
    const pc = new RTCPeerConnection({ iceServers: this.iceServers() });
    this.peers.set(viewer, pc);
    this.viewers = this.peers.size;
    pc.addEventListener('connectionstatechange', () => {
      if ((pc.connectionState === 'failed' || pc.connectionState === 'closed') && this.peers.get(viewer) === pc) this.dropPeer(viewer);
    });
    for (const track of stream.getTracks()) {
      const sender = pc.addTrack(track, stream);
      if (track.kind !== 'video') continue;
      const params = sender.getParameters();
      // Keep the picture sharp and let the frame rate drop when the connection is tight
      params.degradationPreference = 'maintain-resolution';
      for (const enc of params.encodings ?? []) enc.maxBitrate = MAX_BITRATE;
      await sender.setParameters(params).catch(() => {});
    }
    await pc.setLocalDescription(await pc.createOffer());
    await this.gathered(pc);
    if (this.peers.get(viewer) === pc && pc.localDescription) await this.send(s, [viewer], SHARE.offer, pc.localDescription.sdp);
  }

  private async answerTo(s: Session, sharer: number, sdp: string): Promise<void> {
    const w = this.watching;
    if (!w || w.host !== s || w.session !== sharer) return;
    this.watchPc?.close();
    const pc = new RTCPeerConnection({ iceServers: this.iceServers() });
    this.watchPc = pc;
    pc.addEventListener('track', e => { if (this.watchPc === pc) this.setWatchState('live', e.streams[0]); });
    pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'failed' && this.watchPc === pc) this.setWatchState('failed');
    });
    try {
      await pc.setRemoteDescription({ type: 'offer', sdp });
      await pc.setLocalDescription(await pc.createAnswer());
      await this.gathered(pc);
      if (this.watchPc === pc && pc.localDescription) await this.send(s, [sharer], SHARE.answer, pc.localDescription.sdp);
    } catch {
      if (this.watchPc === pc) this.setWatchState('failed');
    }
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
      case SHARE.on: s.setSharing(sender, true); break;
      case SHARE.off:
        s.setSharing(sender, false);
        if (this.watching?.host === s && this.watching.session === sender) this.endWatch();
        break;
      case SHARE.who: if (this.host === s) this.send(s, [sender], SHARE.on); break;
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
    s.clearSharing();
    if (this.watching?.host === s) this.unwatch();
    if (this.host === s) {
      this.dropPeers();
      s.setSharing(self, true);
      this.send(s, this.others(s), SHARE.on);
    }
    this.send(s, this.others(s), SHARE.who);
  }

  // Someone else connected, moved or left
  userMoved(s: Session, user: User, gone = false): void {
    if (!s.client?.self || user.session === s.client.session) return;
    if (!gone && this.inMyChannel(s, user.session)) {
      if (this.host === s) this.send(s, [user.session], SHARE.on);
      return;
    }
    s.setSharing(user.session, false);
    if (this.host === s) this.dropPeer(user.session);
    if (this.watching?.host === s && this.watching.session === user.session) this.endWatch();
  }

  closed(s: Session): void {
    if (this.host === s) {
      this.dropPeers();
      this.stream?.getTracks().forEach(t => t.stop());
      this.stream = null;
      this.host = null;
    }
    if (this.watching?.host === s) this.endWatch();
  }
}

export const share = new ScreenShare();
