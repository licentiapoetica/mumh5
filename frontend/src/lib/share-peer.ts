import { desktop } from './native.ts';
import { NativeSharePeer } from './native-share-peer.ts';

export interface OutgoingShare {
  stream: MediaStream;
  bitrate: number;
  motion: boolean;
}

export interface SharePeer {
  onState?: (state: RTCPeerConnectionState) => void;
  onStream?: (stream: MediaStream) => void;
  readonly waitingForAnswer: boolean;
  offer(): Promise<string>;
  answer(sdp: string): Promise<string>;
  accept(sdp: string): Promise<void>;
  replaceVideo(track: MediaStreamTrack): Promise<void>;
  setBitrate(bitrate: number): Promise<void>;
  stats(): Promise<RTCStatsReport>;
  close(): void;
}

export const sharePeerAvailable = (): boolean => typeof RTCPeerConnection !== 'undefined' || !!desktop?.shareRtc;

export function createSharePeer(config: RTCConfiguration, outgoing?: OutgoingShare): SharePeer {
  if (typeof RTCPeerConnection === 'undefined' && desktop?.shareRtc) return new NativeSharePeer(desktop.shareRtc, config, outgoing);
  return new WebSharePeer(config, outgoing);
}

// Preserve stereo when sending the sound of a screen.
const stereo = (sdp: string) => sdp.replace(/a=fmtp:(\d+) ([^\r\n]*useinbandfec=1[^\r\n]*)/g,
  (line, pt, rest) => rest.includes('stereo=1') ? line : `a=fmtp:${pt} ${rest};stereo=1;sprop-stereo=1;maxaveragebitrate=192000`);

class WebSharePeer implements SharePeer {
  private readonly pc: RTCPeerConnection;
  private readonly bitrateReady: Promise<void>;
  private video?: RTCRtpSender;
  private motion = false;
  onState?: (state: RTCPeerConnectionState) => void;
  onStream?: (stream: MediaStream) => void;

  constructor(config: RTCConfiguration, outgoing?: OutgoingShare) {
    this.pc = new RTCPeerConnection(config);
    this.pc.onconnectionstatechange = () => this.onState?.(this.pc.connectionState);
    this.pc.ontrack = e => { if (e.streams[0]) this.onStream?.(e.streams[0]); };
    if (outgoing) {
      this.motion = outgoing.motion;
      for (const track of outgoing.stream.getTracks()) {
        const sender = this.pc.addTrack(track, outgoing.stream);
        if (track.kind === 'video') this.video = sender;
      }
    }
    this.bitrateReady = outgoing ? this.setBitrate(outgoing.bitrate) : Promise.resolve();
  }

  get waitingForAnswer(): boolean { return this.pc.signalingState === 'have-local-offer'; }

  async setBitrate(bitrate: number): Promise<void> {
    if (!this.video) return;
    const params = this.video.getParameters();
    params.degradationPreference = this.motion ? 'maintain-framerate' : 'maintain-resolution';
    for (const enc of params.encodings ?? []) enc.maxBitrate = bitrate;
    await this.video.setParameters(params).catch(() => {});
  }

  async replaceVideo(track: MediaStreamTrack): Promise<void> { await this.video?.replaceTrack(track); }

  private async local(description: RTCSessionDescriptionInit): Promise<string> {
    await this.pc.setLocalDescription({ type: description.type, sdp: stereo(description.sdp ?? '') });
    const pc = this.pc;
    if (pc.iceGatheringState !== 'complete') {
      await new Promise<void>(resolve => {
        const done = () => { clearTimeout(timer); pc.removeEventListener('icegatheringstatechange', check); resolve(); };
        const check = () => { if (pc.iceGatheringState === 'complete') done(); };
        const timer = setTimeout(done, 3000);
        pc.addEventListener('icegatheringstatechange', check);
      });
    }
    if (!pc.localDescription) throw new Error('No local share description');
    return pc.localDescription.sdp;
  }

  async offer(): Promise<string> {
    await this.bitrateReady;
    return this.local(await this.pc.createOffer());
  }

  async answer(sdp: string): Promise<string> {
    await this.pc.setRemoteDescription({ type: 'offer', sdp });
    return this.local(await this.pc.createAnswer());
  }

  async accept(sdp: string): Promise<void> { await this.pc.setRemoteDescription({ type: 'answer', sdp }); }
  stats(): Promise<RTCStatsReport> { return this.pc.getStats(); }
  close(): void { this.pc.close(); }
}
