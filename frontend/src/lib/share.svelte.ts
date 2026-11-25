// Screen sharing between mumh5 clients in the same channel. Mumble has no video, so the
// picture goes directly from the sharer to each viewer over WebRTC; only the setup messages
// travel through the Mumble server (as plugin data, see core/share-signal.ts). The server has
// checked the sender's certificate, so a stream is known to come from that user.
import {
  SHARE, SHARE_DATA_ID, encodeShare, ShareAssembler, decodeShareFlow, decodeWatchRequest,
  type ShareFlow, type ShareRoute, type ShareType, type ShareWatchRequest
} from '../core/share-signal.ts';
import { requestId } from '../core/mumpeer-signal.ts';
import type { RelayLease } from './mumpeer.svelte.ts';
import type { User } from '../core/client.ts';
import type { Session } from './session.svelte.ts';
import { desktop, isWeb, mumpeerSupported } from './native.ts';
import { proxyIce, relayIce } from './web.svelte.ts';
import { store, type ScreenShareRoute } from './settings.svelte.ts';
import { ui } from './ui.svelte.ts';
import { sounds } from './audio/sounds.svelte.ts';
import { cameraBitrate, cameraError, cameraWishes, openCamera } from './camera.ts';
import { createSharePeer, sharePeerAvailable, type SharePeer } from './share-peer.ts';

// Every viewer is a separate upload from the sharer
const MAX_VIEWERS = 8;
// Cameras watched at once; each is a download and a decoder
const MAX_CAMERAS = 12;
export const QUALITY = {
  low: { label: 'Low (1 Mbit/s, 30 fps)', bitrate: 1_000_000, fps: 30 },
  medium: { label: 'Medium (4 Mbit/s, 30 fps)', bitrate: 4_000_000, fps: 30 },
  high: { label: 'High (8 Mbit/s, 60 fps)', bitrate: 8_000_000, fps: 60 }
} as const;

// What a stream shows. Sent along with the announcement, so others see the right icon.
export type ShareKind = 'screen' | 'camera';

export interface Watching {
  host: Session;
  session: number;
  kind: ShareKind;
  stream: MediaStream | null;
  state: 'connecting' | 'live' | 'failed';
  route?: ShareRoute;
  error?: string;
}

interface OfferAttempt {
  session: Session;
  viewer: number;
  request: ShareWatchRequest | null;
  route: ShareRoute;
  fallback?: 'standard' | 'mumpeer';
  lease?: RelayLease;
}

interface WatchAttempt {
  session: Session;
  sharer: number;
  request: ShareWatchRequest;
  route?: ShareRoute;
  fallback?: 'standard' | 'mumpeer';
  requestedFallback?: boolean;
  relayAttempted?: boolean;
  lease?: RelayLease;
}

const screenRoute = (): ScreenShareRoute => mumpeerSupported() ? store.settings.screenShareRoute : 'standard';
const DIRECT_TIMEOUT = 20000;
const RELAY_TIMEOUT = 25000;

class ScreenShare {
  // The server we are sharing on, and what we send
  host = $state.raw<Session | null>(null);
  stream = $state.raw<MediaStream | null>(null);
  kind = $state<ShareKind>('screen');
  // A phone's back camera points away from us, so it is not shown as a mirror
  private facingAway = $state(false);
  // How many cameras this device has; with more than one there is something to switch to
  cameras = $state(0);
  switching = $state(false);
  // The camera button was pressed and the camera is still starting
  opening = $state(false);
  viewers = $state(0);
  // Streams we receive: one screen at a time, and any number of cameras next to it
  watches = $state.raw<Watching[]>([]);
  // People whose camera we chose not to see, by certificate (or name); until the app restarts
  hidden = $state<Record<string, boolean>>({});
  error = $state('');
  // The large picture is in a window of its own; the main window keeps only a bar for it
  poppedOut = $state(false);
  // The server the start dialog is open for
  dialog = $state.raw<Session | null>(null);
  private usesVirtualMic = false;

  private peers = new Map<number, SharePeer>();
  private watchPcs = new Map<number, SharePeer>();
  private offers = new Map<number, OfferAttempt>();
  private watchAttempts = new Map<number, WatchAttempt>();
  private watchTimers = new Map<number, ReturnType<typeof setTimeout>>();
  private assemblers = new WeakMap<Session, ShareAssembler>();
  // Viewers whose connection came up, so leaving is only announced for those
  private live = new Set<number>();
  // When we entered the channel: streams already running there are not announced with a sound
  private enteredAt = new WeakMap<Session, number>();

  get cameraOn(): boolean { return !!this.stream && this.kind === 'camera'; }
  get screenOn(): boolean { return !!this.stream && this.kind === 'screen'; }
  // Our own camera as a mirror shows us; never what the others get
  get mirror(): boolean { return this.cameraOn && store.settings.cameraMirror && !this.facingAway; }

  // Plugin data needs a 1.4 server; older ones would not pass the signals on
  screenSupported(s: Session): boolean { return this.supported(s) && screenRoute() !== 'off'; }

  supported(s: Session): boolean {
    return !!s.client && s.client.serverVersionNum >= 0x010400 && sharePeerAvailable();
  }

  private async iceServers(direct = false): Promise<RTCIceServer[]> {
    const stun = store.settings.stunServer.trim();
    const chosen: RTCIceServer[] = stun ? [{ urls: /^stuns?:/.test(stun) ? stun : `stun:${stun}` }] : [];
    if (direct) return chosen;
    // A mumh5 proxy adds its STUN and its relay, which takes over by itself when no direct
    // connection comes up (mobile and company networks, browsers that forbid direct UDP). The
    // browser build has the proxy it is served from; the desktop app the one set in Settings.
    const relay = store.settings.relayServer.trim();
    return [...chosen, ...(relay ? await relayIce(relay) : isWeb ? await proxyIce() : [])];
  }

  // For testing the relay: localStorage mumh5.iceDebug = "relay" uses only relayed routes,
  // "relay-tcp" only the relay reached over TCP (what a browser without direct UDP is left with)
  private async rtcConfig(route: ShareRoute): Promise<RTCConfiguration> {
    const iceServers = await this.iceServers(route === 'direct');
    let debug = '';
    try { debug = localStorage.getItem('mumh5.iceDebug') ?? ''; } catch { /* storage unavailable */ }
    if (route === 'direct' || !debug.startsWith('relay')) return { iceServers };
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
    const client = s.client;
    if (!client || !to.length) return;
    const packets = await encodeShare(type, text);
    if (s.client !== client) return;
    for (const packet of packets) client.sendPluginData(to, SHARE_DATA_ID, packet);
  }

  private flow(s: Session, peer: number, msg: ShareFlow): Promise<void> {
    return this.send(s, [peer], SHARE.flow, JSON.stringify({ v: 1, ...msg }));
  }

  // Sharer and viewer connect directly, so each learns the other's address; say so once
  confirmDirectShare(): Promise<boolean> {
    if (store.settings.shareNoticeSeen) return Promise.resolve(true);
    return new Promise(resolve => {
      let answered = false;
      ui.prompt = {
        title: 'Screen sharing', label: '', confirm: 'Continue', input: 'none',
        text: 'Screen sharing can use a direct connection. You see each other\'s IP address on that route. Only mumh5 users in your channel can watch.',
        onsubmit: () => { answered = true; store.settings.shareNoticeSeen = true; store.saveSettings(); resolve(true); },
        oncancel: () => { if (!answered) resolve(false); }
      };
    });
  }

  // Opens the dialog where the source, the sound and the quality are chosen
  async start(s: Session): Promise<void> {
    const policy = screenRoute();
    if (this.stream || this.dialog || this.opening || !this.screenSupported(s) || (policy !== 'relay-only' && !(await this.confirmDirectShare()))) return;
    if (screenRoute() !== policy) return;
    this.error = '';
    this.dialog = s;
  }

  screenPolicyChanged(): void {
    this.dialog = null;
    if (this.screenOn) this.stop();
    for (const watch of this.watches) if (watch.kind === 'screen') this.unwatch(watch.session);
  }

  // The camera button: on with the choices from Settings, Video, without a dialog
  async toggleCamera(s: Session): Promise<void> {
    if (this.cameraOn) return this.stop();
    if (this.stream || this.dialog || this.opening || !this.supported(s) || !(await this.confirmDirectShare())) return;
    // Something else may have started while the note was open
    if (this.stream || this.dialog || this.opening) return;
    this.opening = true;
    this.error = '';
    try {
      this.go(s, await openCamera(), false, 'camera');
    } catch (e) {
      this.error = cameraError(e);
    } finally {
      this.opening = false;
    }
  }

  // The dialog hands over what it captured
  go(s: Session, stream: MediaStream, usesVirtualMic: boolean, kind: ShareKind = 'screen'): void {
    const dialog = this.dialog;
    this.dialog = null;
    if (!s.client || this.stream || (kind === 'screen' && (dialog !== s || screenRoute() === 'off'))) {
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
    this.facingAway = stream.getVideoTracks()[0]?.getSettings().facingMode === 'environment';
    this.cameras = 0;
    if (kind === 'camera') navigator.mediaDevices.enumerateDevices().then(d => { this.cameras = d.filter(x => x.kind === 'videoinput').length; }).catch(() => {});
    this.host = s;
    this.stream = stream;
    this.send(s, this.others(s), SHARE.on, kind);
    s.setSharing(s.client.session!, kind);
    sounds.play('shareStarted');
  }

  // The next camera of this device (front and back on a phone), without interrupting the stream
  async switchCamera(): Promise<void> {
    if (!this.cameraOn || this.switching) return;
    const ids = (await navigator.mediaDevices.enumerateDevices().catch(() => [])).filter(d => d.kind === 'videoinput').map(d => d.deviceId);
    this.cameras = ids.length;
    const current = this.stream?.getVideoTracks()[0]?.getSettings().deviceId ?? '';
    const next = ids[(ids.indexOf(current) + 1) % ids.length];
    if (ids.length >= 2 && next && next !== current) await this.useCamera(next);
  }

  // The Video settings changed while the camera is on
  async applyCamera(deviceChanged: boolean): Promise<void> {
    if (!this.cameraOn) return;
    if (deviceChanged) await this.useCamera(store.settings.cameraDevice);
    else await this.stream?.getVideoTracks()[0]?.applyConstraints(cameraWishes()).catch(e => { this.error = `The camera did not take the new settings: ${(e as Error).message}`; });
    for (const pc of this.peers.values()) await pc.setBitrate(cameraBitrate()).catch(() => {});
  }

  private async useCamera(deviceId: string): Promise<void> {
    const stream = this.stream;
    const old = stream?.getVideoTracks()[0];
    if (!stream || !old || this.kind !== 'camera' || this.switching) return;
    this.switching = true;
    this.error = '';
    const current = old.getSettings().deviceId ?? '';
    try {
      let fresh: MediaStream;
      try {
        // Computers can have both open for a moment, which keeps the picture going
        fresh = await openCamera(deviceId);
      } catch {
        // A phone opens one camera at a time, so the old one has to go first
        old.stop();
        try {
          fresh = await openCamera(deviceId);
        } catch (e) {
          // Could not get the other one: back to the camera we had
          fresh = await openCamera(current).catch(() => { throw e; });
          this.error = `Could not switch the camera: ${cameraError(e)}`;
        }
      }
      // Stopped sharing in the meantime
      if (this.stream !== stream) return fresh.getTracks().forEach(t => t.stop());
      const track = fresh.getVideoTracks()[0];
      track.contentHint = 'motion';
      track.addEventListener('ended', () => { if (this.stream?.getVideoTracks()[0] === track) this.stop(); });
      // Viewers keep their connection; only the picture changes
      for (const pc of this.peers.values()) {
        await pc.replaceVideo(track).catch(e => { this.error = `A viewer did not get the new camera: ${(e as Error).message}`; });
      }
      old.stop();
      this.stream = new MediaStream([track, ...stream.getAudioTracks()]);
      this.facingAway = track.getSettings().facingMode === 'environment';
    } catch (e) {
      this.error = `The camera stopped: ${(e as Error).message}`;
      this.stop();
    } finally {
      this.switching = false;
    }
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
    for (const offer of this.offers.values()) offer.lease?.close();
    this.offers.clear();
    for (const pc of this.peers.values()) pc.close();
    this.peers.clear();
    this.live.clear();
    this.viewers = 0;
  }

  private dropPeer(session: number): void {
    const attempt = this.offers.get(session);
    this.offers.delete(session);
    attempt?.lease?.close();
    this.closePeerConnection(session);
  }

  private closePeerConnection(session: number): void {
    const pc = this.peers.get(session);
    this.peers.delete(session);
    pc?.close();
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
    const policy = kind === 'screen' ? screenRoute() : 'standard';
    if (policy === 'off' || !this.supported(s) || !kind || this.watchOf(session) || (policy !== 'relay-only' && !(await this.confirmDirectShare()))) return;
    if (kind === 'screen' && screenRoute() !== policy) return;
    // Streams from another server, and another screen, make way
    for (const w of this.watches) if (w.host !== s || (kind === 'screen' && w.kind === 'screen')) this.unwatch(w.session);
    if (kind === 'camera' && this.watches.filter(w => w.kind === 'camera').length >= MAX_CAMERAS) return;
    if (!s.sharing[session] || this.watchOf(session)) return;
    delete this.hidden[this.who(s, session)];
    this.watches = [...this.watches, { host: s, session, kind, stream: null, state: 'connecting' }];
    if (kind === 'screen') {
      const request: ShareWatchRequest = {
        id: requestId(), relay: s.mumpeer.capability(session),
        only: policy === 'relay-only', direct: policy === 'direct-only'
      };
      if (policy === 'automatic' && request.relay) request.preferRelay = true;
      if (request.only && !request.relay) {
        this.setWatchState(session, 'failed', undefined, { error: 'Mumpeer is unavailable for this user.' });
        return;
      }
      this.watchAttempts.set(session, { session: s, sharer: session, request });
      this.send(s, [session], SHARE.watch, JSON.stringify({ v: 1, ...request }));
    } else {
      this.send(s, [session], SHARE.watch);
    }
    this.timeWatch(session);
  }

  private timeWatch(session: number, timeout = DIRECT_TIMEOUT): void {
    clearTimeout(this.watchTimers.get(session));
    this.watchTimers.set(session, setTimeout(() => this.watchFailed(session), timeout));
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
    const attempt = this.watchAttempts.get(session);
    this.watchAttempts.delete(session);
    attempt?.lease?.close();
    this.closeWatchConnection(session);
    this.watches = this.watches.filter(w => w.session !== session);
  }

  private closeWatchConnection(session: number): void {
    const pc = this.watchPcs.get(session);
    this.watchPcs.delete(session);
    pc?.close();
  }

  private setWatchState(session: number, state: Watching['state'], stream?: MediaStream, detail?: Pick<Watching, 'route' | 'error'>): void {
    if (!this.watchOf(session)) return;
    if (state !== 'connecting') { clearTimeout(this.watchTimers.get(session)); this.watchTimers.delete(session); }
    this.watches = this.watches.map(w => w.session === session ? { ...w, state, stream: stream ?? w.stream, ...detail } : w);
  }

  private requestFallback(attempt: WatchAttempt): void {
    if (attempt.requestedFallback) return;
    attempt.requestedFallback = true;
    this.closeWatchConnection(attempt.sharer);
    this.setWatchState(attempt.sharer, 'connecting');
    this.timeWatch(attempt.sharer, attempt.fallback === 'mumpeer' ? RELAY_TIMEOUT : DIRECT_TIMEOUT);
    void this.flow(attempt.session, attempt.sharer, { t: 'fallback', id: attempt.request.id });
  }

  private watchRelayFailed(attempt: WatchAttempt, reason: string): void {
    if (this.watchAttempts.get(attempt.sharer) !== attempt || attempt.route !== 'mumpeer') return;
    if (attempt.fallback === 'standard') this.requestFallback(attempt);
    else this.watchFailed(attempt.sharer, reason);
  }

  private watchFailed(session: number, reason?: string): void {
    const attempt = this.watchAttempts.get(session);
    if (!reason && attempt?.fallback && !attempt.requestedFallback) {
      this.requestFallback(attempt);
      return;
    }
    if (!reason && (!attempt || (!attempt.lease && !attempt.request.only && !attempt.requestedFallback))) {
      this.setWatchState(session, 'failed');
      return;
    }
    const watching = this.watchOf(session);
    if (attempt) {
      this.watchAttempts.delete(session);
      attempt.lease?.close();
    }
    this.closeWatchConnection(session);
    if (watching?.host.client) void this.send(watching.host, [session], SHARE.leave);
    this.setWatchState(session, 'failed', undefined, { error: reason });
  }

  // All cameras on or off, remembered
  async setCams(s: Session, on: boolean): Promise<void> {
    // Also a setting while not connected, where there is nobody to connect to yet
    if (on && !store.settings.autoCameras && this.supported(s) && !(await this.confirmDirectShare())) return;
    store.settings.autoCameras = on;
    store.saveSettings();
    if (!on) {
      for (const w of this.watches) if (w.kind === 'camera') this.unwatch(w.session);
      return;
    }
    for (const session of Object.keys(s.sharing)) if (Number(session) !== s.client?.session) this.autoWatch(s, Number(session));
  }

  private offerCurrent(a: OfferAttempt): boolean {
    return this.offers.get(a.viewer) === a && this.host === a.session && !!this.stream && this.inMyChannel(a.session, a.viewer);
  }

  private failOffer(a: OfferAttempt, reason: string): void {
    if (!this.offerCurrent(a)) return;
    if (a.route === 'mumpeer' && a.fallback === 'standard') {
      a.route = 'standard';
      a.fallback = undefined;
      this.closePeerConnection(a.viewer);
      a.lease?.close();
      a.lease = undefined;
      void this.offerTo(a);
      return;
    }
    this.dropPeer(a.viewer);
    if (a.request) void this.flow(a.session, a.viewer, { t: 'error', id: a.request.id, reason: reason.slice(0, 180) });
  }

  private async watchRequested(s: Session, viewer: number, text?: string): Promise<void> {
    if (!this.stream || this.host !== s) return;
    const request = this.kind === 'screen' ? decodeWatchRequest(text) : null;
    const policy = this.kind === 'screen' ? screenRoute() : 'standard';
    if (request && this.offers.get(viewer)?.request?.id === request.id) return;
    this.dropPeer(viewer);
    if (this.offers.size >= MAX_VIEWERS) return;
    const matchingRelay = !!request?.relay && request.relay === s.mumpeer.capability(viewer);
    const only = policy === 'relay-only' || request?.only;
    const direct = policy === 'direct-only' || request?.direct;
    const prefer = policy === 'automatic' && request?.preferRelay && matchingRelay && !direct && !only;
    const attempt: OfferAttempt = { session: s, viewer, request, route: direct ? 'direct' : 'standard' };
    this.offers.set(viewer, attempt);
    if (policy === 'off') return this.failOffer(attempt, 'The sharer disabled screen sharing.');
    if (only && (!matchingRelay || direct)) return this.failOffer(attempt, 'Both users need to allow the same mumpeer relay.');

    if (matchingRelay && !direct && !only) attempt.fallback = prefer ? 'standard' : 'mumpeer';
    if (only || prefer) await this.relayOffer(attempt);
    else await this.offerTo(attempt);
  }

  private async relayOffer(a: OfferAttempt): Promise<void> {
    if (!this.offerCurrent(a) || !a.request || a.route === 'mumpeer') return;
    a.route = 'mumpeer';
    if (a.fallback === 'mumpeer') a.fallback = undefined;
    this.closePeerConnection(a.viewer);
    try {
      if (!a.request.relay || a.request.relay !== a.session.mumpeer.capability(a.viewer)) throw new Error('Mumpeer is unavailable for this user.');
      // Tell the viewer which attempt may acquire a pair before sending any SDP.
      await this.flow(a.session, a.viewer, { t: 'relay', id: a.request.id, retryStandard: a.fallback === 'standard' || undefined });
      if (!this.offerCurrent(a) || a.route !== 'mumpeer') return;
      a.lease = a.session.mumpeer.acquire(a.viewer, a.request.id, a.session.client!.session!, reason => this.failOffer(a, reason));
      await this.offerTo(a);
    } catch (error) {
      if (a.route === 'mumpeer') this.failOffer(a, (error as Error).message);
    }
  }

  private async offerTo(a: OfferAttempt): Promise<void> {
    const { session: s, viewer, request, route } = a;
    const stream = this.stream;
    if (!stream || !this.offerCurrent(a)) return;
    try {
      const config = await (a.lease?.config ?? this.rtcConfig(route));
      if (!this.offerCurrent(a) || a.route !== route) return;
      const motion = this.kind === 'camera';
      const bitrate = motion ? cameraBitrate() : QUALITY[store.settings.shareQuality].bitrate;
      const pc = createSharePeer(config, { stream, bitrate, motion });
      this.peers.set(viewer, pc);
      this.viewers = this.peers.size;
      const current = () => this.offerCurrent(a) && this.peers.get(viewer) === pc;
      pc.onState = state => {
        if (!current()) return;
        if (state === 'connected' && !this.live.has(viewer)) {
          this.live.add(viewer);
          sounds.play('viewerJoined');
        } else if (state === 'failed') {
          if (a.fallback === 'mumpeer') void this.relayOffer(a);
          else this.failOffer(a, 'Could not connect to the viewer.');
        } else if (state === 'closed') this.dropPeer(viewer);
      };
      const sdp = await pc.offer();
      if (!current()) return;
      if (request) await this.flow(s, viewer, { t: 'offer', id: request.id, route, sdp, fallback: a.fallback === 'mumpeer' });
      else await this.send(s, [viewer], SHARE.offer, sdp);
    } catch (error) {
      if (a.route === route) this.failOffer(a, (error as Error).message);
    }
  }

  private async answerTo(s: Session, sharer: number, sdp: string, route: ShareRoute, attempt?: WatchAttempt): Promise<void> {
    const mine = () => {
      const w = this.watchOf(sharer);
      return w?.host === s && (!attempt || (this.watchAttempts.get(sharer) === attempt && attempt.route === route));
    };
    if (!mine()) return;
    try {
      const config = await (attempt?.lease?.config ?? this.rtcConfig(route));
      if (!mine()) return;
      if (route === 'direct' && / typ relay(?: |\r|$)/m.test(sdp)) throw new Error('The other client offered a relay in direct-only mode.');
      this.closeWatchConnection(sharer);
      const pc = createSharePeer(config);
      this.watchPcs.set(sharer, pc);
      const current = () => mine() && this.watchPcs.get(sharer) === pc;
      let connected = false;
      pc.onStream = stream => {
        if (current()) this.setWatchState(sharer, connected ? 'live' : 'connecting', stream, { route });
      };
      pc.onState = state => {
        if (!current()) return;
        connected = state === 'connected';
        if (connected) this.setWatchState(sharer, 'live', undefined, { route });
        else if (state === 'failed') this.watchFailed(sharer);
      };
      const answer = await pc.answer(sdp);
      if (!current()) return;
      if (attempt) await this.flow(s, sharer, { t: 'answer', id: attempt.request.id, route, sdp: answer });
      else await this.send(s, [sharer], SHARE.answer, answer);
    } catch (error) {
      if (!mine()) return;
      if (route === 'mumpeer' && attempt) this.watchRelayFailed(attempt, (error as Error).message);
      else this.watchFailed(sharer, (error as Error).message);
    }
  }

  private receiveFlow(s: Session, sender: number, flow: ShareFlow): void {
    const offer = this.offers.get(sender);
    if (offer?.session === s && offer.request?.id === flow.id && this.offerCurrent(offer)) {
      if (flow.t === 'fallback') {
        if (offer.fallback === 'mumpeer') void this.relayOffer(offer);
        if (offer.fallback === 'standard' && offer.route === 'mumpeer') this.failOffer(offer, 'The viewer could not use mumpeer.');
      }
      if (flow.t === 'answer' && offer.route === flow.route) {
        if (offer.route === 'direct' && / typ relay(?: |\r|$)/m.test(flow.sdp)) return this.failOffer(offer, 'The viewer offered a relay in direct-only mode.');
        const pc = this.peers.get(sender);
        if (pc?.waitingForAnswer) void pc.accept(flow.sdp).catch(() => {
          if (this.peers.get(sender) === pc) this.failOffer(offer, 'Could not accept the viewer’s answer.');
        });
      }
    }

    const attempt = this.watchAttempts.get(sender);
    if (!attempt || attempt.session !== s || attempt.request.id !== flow.id) return;
    if (flow.t === 'error') this.watchFailed(sender, flow.reason);
    if (flow.t === 'relay' && !attempt.relayAttempted) {
      if (attempt.request.direct || !attempt.request.relay) {
        this.watchFailed(sender, 'Mumpeer is unavailable for this user.');
        return;
      }
      attempt.relayAttempted = true;
      attempt.route = 'mumpeer';
      attempt.fallback = flow.retryStandard && attempt.request.preferRelay && !attempt.request.only ? 'standard' : undefined;
      attempt.requestedFallback = false;
      this.closeWatchConnection(sender);
      this.setWatchState(sender, 'connecting', undefined, { route: 'mumpeer' });
      this.timeWatch(sender, RELAY_TIMEOUT);
      try {
        if (attempt.request.relay !== s.mumpeer.capability(sender)) throw new Error('Mumpeer is unavailable for this user.');
        attempt.lease = s.mumpeer.acquire(sender, flow.id, sender, reason => this.watchRelayFailed(attempt, reason));
        void attempt.lease.config.catch((error: Error) => this.watchRelayFailed(attempt, error.message));
      } catch (error) { this.watchRelayFailed(attempt, (error as Error).message); }
    }
    if (flow.t === 'offer') {
      if (flow.route === 'mumpeer') {
        if (attempt.route !== 'mumpeer' || !attempt.lease || attempt.requestedFallback) return;
      } else if (attempt.request.only || (attempt.request.direct && flow.route !== 'direct')) return;
      if (attempt.route === flow.route && (this.watchPcs.has(sender) || attempt.requestedFallback)) return;

      if (attempt.route === 'mumpeer' && flow.route !== 'mumpeer') {
        if (attempt.fallback !== 'standard' || flow.route !== 'standard') return;
        attempt.route = 'standard';
        this.closeWatchConnection(sender);
        attempt.lease?.close();
        attempt.lease = undefined;
        attempt.requestedFallback = false;
        this.timeWatch(sender);
      }
      attempt.route = flow.route;
      if (flow.route !== 'mumpeer') {
        attempt.fallback = flow.fallback && flow.route === 'standard' && attempt.request.relay && !attempt.relayAttempted ? 'mumpeer' : undefined;
      }
      void this.answerTo(s, sender, flow.sdp, flow.route, attempt);
    }
  }

  private legacyOffer(s: Session, sender: number, sdp: string): void {
    const attempt = this.watchAttempts.get(sender);
    if (this.watchOf(sender)?.host !== s) return;
    if (attempt?.request.only) {
      this.watchFailed(sender, 'The sharer does not support mumpeer for this share.');
      return;
    }
    if (attempt?.route) return;
    if (attempt) this.watchAttempts.delete(sender);
    void this.answerTo(s, sender, sdp, attempt?.request.direct ? 'direct' : 'standard');
  }

  // Raw WebRTC statistics for the overlay: of a stream we watch, or one per viewer of ours
  async reports(own: boolean, session?: number): Promise<{ viewer: number | null; report: RTCStatsReport }[]> {
    if (!own) {
      const pc = session != null ? this.watchPcs.get(session) : undefined;
      return pc ? [{ viewer: null, report: await pc.stats() }] : [];
    }
    return Promise.all([...this.peers].map(async ([viewer, pc]) => ({ viewer, report: await pc.stats() })));
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
      case SHARE.watch: void this.watchRequested(s, sender, msg.text); break;
      case SHARE.leave: if (this.host === s) this.dropPeer(sender); break;
      case SHARE.offer: if (msg.text) this.legacyOffer(s, sender, msg.text); break;
      case SHARE.answer: {
        const offer = this.offers.get(sender);
        const pc = this.peers.get(sender);
        if (offer?.session === s && !offer.request && msg.text && pc?.waitingForAnswer) {
          if (offer.route === 'direct' && / typ relay(?: |\r|$)/m.test(msg.text)) return this.failOffer(offer, 'The viewer offered a relay in direct-only mode.');
          void pc.accept(msg.text).catch(() => {
            if (this.peers.get(sender) === pc) this.dropPeer(sender);
          });
        }
        break;
      }
      case SHARE.flow: {
        const flow = decodeShareFlow(msg.text);
        if (flow) this.receiveFlow(s, sender, flow);
        break;
      }
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
