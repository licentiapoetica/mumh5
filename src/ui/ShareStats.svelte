<script lang="ts">
  import { onDestroy } from 'svelte';
  import { share } from '../lib/share.svelte.ts';
  import { session } from '../lib/session.svelte.ts';
  import { store } from '../lib/settings.svelte.ts';

  // "Stats for nerds" over the stream: codecs, picture, bitrate and the network path, read
  // from the WebRTC connection once a second. own: our stream (one block per viewer).
  let { own, onclose }: { own: boolean; onclose: () => void } = $props();

  type Row = [string, string];
  let blocks = $state<{ title: string; rows: Row[] }[]>([]);
  // Byte counters from the previous reading, for the bitrate
  const last = new Map<string, { bytes: number; at: number }>();

  const kbit = (key: string, bytes: number | undefined, at: number): string => {
    if (bytes == null) return 'n/a';
    const prev = last.get(key);
    last.set(key, { bytes, at });
    if (!prev || at <= prev.at) return '...';
    return `${Math.round(((bytes - prev.bytes) * 8) / (at - prev.at))} kbit/s`;
  };
  const ms = (seconds: number | undefined) => seconds == null ? 'n/a' : `${Math.round(seconds * 1000)} ms`;
  const codecName = (report: RTCStatsReport, id?: string): string => {
    const c = id ? report.get(id) : null;
    if (!c) return 'n/a';
    const profile = /profile-level-id=([0-9a-f]+)/i.exec(c.sdpFmtpLine ?? '')?.[1];
    const stereo = /stereo=1/.test(c.sdpFmtpLine ?? '') ? ', stereo' : '';
    return `${String(c.mimeType).split('/')[1]}${profile ? ` (${profile})` : ''}${c.clockRate && c.mimeType.startsWith('audio') ? `, ${c.clockRate / 1000} kHz${stereo}` : ''}`;
  };
  const KIND: Record<string, string> = { host: 'direct', srflx: 'direct, through a router (STUN)', prflx: 'direct, through a router', relay: 'relayed (TURN)' };

  function describe(report: RTCStatsReport, key: string): Row[] {
    const all = [...report.values()];
    const rows: Row[] = [];
    const rtp = (type: string, kind: string) => all.find(s => s.type === type && s.kind === kind);
    const video = rtp(own ? 'outbound-rtp' : 'inbound-rtp', 'video');
    const audio = rtp(own ? 'outbound-rtp' : 'inbound-rtp', 'audio');
    if (video) {
      rows.push(['Video codec', codecName(report, video.codecId)]);
      if (video.frameWidth) rows.push(['Picture', `${video.frameWidth}x${video.frameHeight}${video.framesPerSecond != null ? `, ${Math.round(video.framesPerSecond)} fps` : ''}`]);
      rows.push(['Video bitrate', kbit(`${key}v`, own ? video.bytesSent : video.bytesReceived, video.timestamp)]);
      if (own) {
        if (video.encoderImplementation) rows.push(['Encoder', video.encoderImplementation]);
        if (video.qualityLimitationReason && video.qualityLimitationReason !== 'none') rows.push(['Held back by', video.qualityLimitationReason]);
      } else {
        if (video.decoderImplementation) rows.push(['Decoder', video.decoderImplementation]);
        rows.push(['Frames dropped', `${video.framesDropped ?? 0} of ${video.framesReceived ?? 0}`]);
        rows.push(['Video packets lost', `${video.packetsLost ?? 0} of ${(video.packetsReceived ?? 0) + (video.packetsLost ?? 0)}`]);
        rows.push(['Video jitter', ms(video.jitter)]);
      }
    }
    if (audio) {
      rows.push(['Audio codec', codecName(report, audio.codecId)]);
      rows.push(['Audio bitrate', kbit(`${key}a`, own ? audio.bytesSent : audio.bytesReceived, audio.timestamp)]);
      if (!own) rows.push(['Audio packets lost', String(audio.packetsLost ?? 0)]);
    } else rows.push(['Audio', 'none']);
    if (own) {
      // What the viewer reports back about our packets
      const back = all.find(s => s.type === 'remote-inbound-rtp' && s.kind === 'video');
      if (back) rows.push(['Lost on the way', `${Math.round((back.fractionLost ?? 0) * 100)}%`]);
    }
    const transport = all.find(s => s.type === 'transport');
    const pair = (transport?.selectedCandidatePairId && report.get(transport.selectedCandidatePairId)) || all.find(s => s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded');
    if (pair) {
      const local = report.get(pair.localCandidateId), remote = report.get(pair.remoteCandidateId);
      rows.push(['Connection', `${KIND[local?.candidateType] ?? local?.candidateType ?? 'n/a'}, ${String(local?.protocol ?? '').toUpperCase()}`]);
      if (remote?.candidateType) rows.push(['Other side', KIND[remote.candidateType] ?? remote.candidateType]);
      rows.push(['Round trip', ms(pair.currentRoundTripTime)]);
      if (pair.availableOutgoingBitrate) rows.push(['Estimated capacity', `${Math.round(pair.availableOutgoingBitrate / 1000)} kbit/s`]);
    } else rows.push(['Connection', 'not established']);
    return rows;
  }

  async function read() {
    const reports = await share.reports(own);
    blocks = reports.map(r => {
      const user = r.viewer != null ? session.user(r.viewer) : undefined;
      return { title: r.viewer == null ? '' : `To ${user ? store.displayName(user) : `#${r.viewer}`}`, rows: describe(r.report, String(r.viewer)) };
    });
  }
  read();
  const timer = setInterval(read, 1000);
  onDestroy(() => clearInterval(timer));
</script>

<div class="nerd" role="status" aria-label="Stream statistics">
  <button class="close" onclick={onclose} aria-label="Close statistics">x</button>
  {#each blocks as b (b.title)}
    {#if b.title}<strong>{b.title}</strong>{/if}
    <dl>{#each b.rows as [k, v] (k)}<dt>{k}</dt><dd>{v}</dd>{/each}</dl>
  {:else}
    <p>{own ? 'Nobody is watching yet.' : 'Not connected.'}</p>
  {/each}
</div>

<style>
  .nerd { position: absolute; top: 8px; left: 8px; z-index: 2; max-width: calc(100% - 16px); max-height: calc(100% - 16px); overflow: auto; padding: 8px 28px 8px 10px;
    background: rgb(0 0 0 / 0.78); color: #e8e8e8; font: 11px/1.5 var(--mono); user-select: text; }
  dl { display: grid; grid-template-columns: auto 1fr; gap: 0 12px; margin: 0; }
  dt { color: #9aa; white-space: nowrap; }
  dd { margin: 0; overflow-wrap: anywhere; }
  strong { display: block; margin: 6px 0 2px; color: #fff; }
  strong:first-of-type { margin-top: 0; }
  p { margin: 0; }
  .close { position: absolute; top: 2px; right: 4px; padding: 2px 6px; color: #ccc; font: inherit; }
  .close:hover { color: #fff; }
</style>
