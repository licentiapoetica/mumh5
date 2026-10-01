<script lang="ts">
  import Modal from './Modal.svelte';
  import { session } from '../lib/session.svelte.ts';

  let { onclose }: { onclose: () => void } = $props();

  const info = $derived(session.serverInfo);
  const server = $derived(session.server);
  const cert = $derived(session.serverCert);
  const voice = $derived(session.voiceTransport);
</script>

<Modal title="Server information" {onclose} width={520}>
  {#if info && server}
    <h3>Server</h3>
    <dl>
      <dt>Address</dt><dd class="mono">{server.host}:{server.port}</dd>
      <dt>Version</dt><dd>{info.version || 'unknown'}</dd>
      <dt>People</dt><dd>{info.users}{info.config.maxUsers ? ` of ${info.config.maxUsers}` : ''}</dd>
      <dt>Channels</dt><dd>{info.channels}</dd>
    </dl>

    <h3>Connection</h3>
    <dl>
      <dt>Ping (TCP)</dt><dd>{session.rtt ? `${session.rtt} ms` : 'n/a'}</dd>
      <dt>Voice</dt><dd>{voice.udp ? `Encrypted UDP${voice.rtt ? `, ${Math.round(voice.rtt)} ms` : ''}` : 'Through the TCP connection'}</dd>
      <dt>Certificate</dt><dd>{cert ? (cert.authorized ? 'Signed by a trusted authority' : 'Self-signed or untrusted, pinned on first connect') : 'unknown'}</dd>
      {#if cert}<dt>SHA-256</dt><dd class="mono">{cert.fingerprint}</dd>{/if}
    </dl>

    <h3>Limits</h3>
    <dl>
      <dt>Voice bitrate</dt><dd>{info.maxBandwidth ? `up to ${Math.round(info.maxBandwidth / 1000)} kbit/s` : 'unknown'}</dd>
      <dt>Message length</dt><dd>{info.config.messageLength ? `${info.config.messageLength} characters` : 'unlimited'}</dd>
      <dt>Image messages</dt><dd>{info.config.imageMessageLength ? `${info.config.imageMessageLength} characters` : 'unlimited'}</dd>
      <dt>HTML in messages</dt><dd>{info.config.allowHtml ? 'allowed' : 'not allowed'}</dd>
    </dl>
  {/if}

  {#snippet footer()}
    <button class="btn primary" onclick={onclose}>Close</button>
  {/snippet}
</Modal>

<style>
  h3 { margin: 18px 0 6px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-dim); }
  h3:first-child { margin-top: 8px; }
  dl { display: grid; grid-template-columns: 130px 1fr; gap: 4px 12px; margin: 0; font-size: 14px; }
  dt { color: var(--text-faint); }
  dd { margin: 0; overflow-wrap: anywhere; user-select: text; }
  .mono { font: 12px var(--mono); }
  @media (max-width: 500px) { dl { grid-template-columns: 1fr; } dt { margin-top: 6px; } }
</style>
