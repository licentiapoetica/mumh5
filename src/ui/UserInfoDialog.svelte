<script lang="ts">
  import { onDestroy } from 'svelte';
  import Modal from './Modal.svelte';
  import { session } from '../lib/session.svelte.ts';
  import { store } from '../lib/settings.svelte.ts';
  import { ui } from '../lib/ui.svelte.ts';
  import { native } from '../lib/native.ts';
  import { formatBytes } from '../lib/html.ts';
  import type { CertDetails } from '../core/transport.ts';

  let { target, onclose }: { target: number; onclose: () => void } = $props();
  // The dialog is remounted per user ({#key} in App), so the session is fixed for its lifetime
  // svelte-ignore state_referenced_locally
  const who = target;

  // The server fills in only what we may see: details for ourselves and admins,
  // packet statistics for people in our channel, times and pings for everyone.
  let stats = $state<any>(null);
  let certs = $state<CertDetails[]>([]);
  let updated = $state(0);
  // Seconds since the last answer, so online and idle times tick between answers
  let now = $state(Date.now());

  const client = session.client;
  const user = $derived(session.user(who));

  const off = client?.on('userStats', msg => {
    if (msg.session !== who) return;
    // Refreshes ask for statistics only; keep the details from the first answer
    stats = stats && !msg.version ? { ...stats, ...msg, version: stats.version, certificates: stats.certificates, address: stats.address } : msg;
    updated = Date.now();
    if (msg.certificates?.length && !certs.length && native) {
      native.describeCerts(msg.certificates).then(c => (certs = c));
    }
  });
  client?.requestUserStats(who);
  // Live: ask every second (UserStats is not rate limited by the server)
  const timer = setInterval(() => { now = Date.now(); client?.requestUserStats(who, true); }, 1000);
  onDestroy(() => { off?.(); clearInterval(timer); });
  const since = $derived(updated ? Math.max(0, Math.floor((now - updated) / 1000)) : 0);

  function duration(secs?: number): string {
    if (secs == null) return 'unknown';
    const d = Math.floor(secs / 86400), h = Math.floor(secs / 3600) % 24, m = Math.floor(secs / 60) % 60, s = secs % 60;
    return [d && `${d}d`, (d || h) && `${h}h`, (d || h || m) && `${m}m`, `${s}s`].filter(Boolean).join(' ');
  }

  function address(bytes?: Uint8Array): string {
    if (!bytes?.length) return '';
    const b = [...bytes];
    // IPv4-mapped IPv6 (::ffff:a.b.c.d)
    if (b.length === 16 && b.slice(0, 10).every(x => x === 0) && b[10] === 255 && b[11] === 255) return b.slice(12).join('.');
    const groups = [];
    for (let i = 0; i < b.length; i += 2) groups.push(((b[i] << 8) | b[i + 1]).toString(16));
    return groups.join(':').replace(/(^|:)0(:0)+(:|$)/, '::');
  }

  const version = $derived.by(() => {
    const v = stats?.version;
    if (!v) return '';
    const n = v.version_v2 ? Number(v.version_v2) : 0;
    const num = n ? `${Math.floor(n / 2 ** 48)}.${Math.floor(n / 2 ** 32) % 65536}.${Math.floor(n / 2 ** 16) % 65536}`
      : v.version_v1 ? `${v.version_v1 >> 16}.${(v.version_v1 >> 8) & 255}.${v.version_v1 & 255}` : '';
    return [v.release, num && !String(v.release ?? '').includes(num) ? `(protocol ${num})` : ''].filter(Boolean).join(' ');
  });

  const ping = (avg?: number, v?: number) => avg ? `${avg.toFixed(1)} ms${v ? ` (variance ${Math.sqrt(v).toFixed(1)})` : ''}` : 'n/a';
  const loss = (s: any) => {
    const total = (s?.good ?? 0) + (s?.late ?? 0) + (s?.lost ?? 0);
    return total ? `${(((s?.lost ?? 0) / total) * 100).toFixed(1)}%` : '-';
  };
</script>

<Modal title="Information: {user ? store.displayName(user) : `#${target}`}" {onclose} width={560}>
  {#if !stats}
    <p class="dim">Asking the server...</p>
  {:else}
    <h3>Connection</h3>
    <dl>
      <dt>Online for</dt><dd>{duration(stats.onlinesecs != null ? stats.onlinesecs + since : undefined)}</dd>
      {#if stats.idlesecs != null}<dt>Idle for</dt><dd>{duration(stats.idlesecs + since)}</dd>{/if}
      <dt>Ping (TCP)</dt><dd>{ping(stats.tcp_ping_avg, stats.tcp_ping_var)}</dd>
      <dt>Ping (UDP)</dt><dd>{stats.udp_packets ? ping(stats.udp_ping_avg, stats.udp_ping_var) : 'not using UDP (voice over TCP)'}</dd>
      <dt>Packets</dt><dd>{stats.tcp_packets ?? 0} TCP, {stats.udp_packets ?? 0} UDP</dd>
      {#if stats.bandwidth != null}<dt>Bandwidth</dt><dd>{formatBytes(stats.bandwidth)}/s</dd>{/if}
      {#if stats.address?.length}<dt>Address</dt><dd class="mono">{address(stats.address)}</dd>{/if}
    </dl>

    {#if stats.version}
      <h3>Client</h3>
      <dl>
        <dt>Version</dt><dd>{version || 'unknown'}</dd>
        {#if stats.version.os}<dt>System</dt><dd>{stats.version.os} {stats.version.os_version ?? ''}</dd>{/if}
        <dt>Opus</dt><dd>{stats.opus ? 'supported' : 'no (legacy codecs only)'}</dd>
      </dl>
    {/if}

    {#if stats.from_client || stats.from_server}
      <h3>Voice packets</h3>
      <table>
        <thead><tr><th></th><th>Good</th><th>Late</th><th>Lost</th><th>Resync</th><th>Loss</th></tr></thead>
        <tbody>
          <tr><th>From client</th><td>{stats.from_client?.good ?? 0}</td><td>{stats.from_client?.late ?? 0}</td><td>{stats.from_client?.lost ?? 0}</td><td>{stats.from_client?.resync ?? 0}</td><td>{loss(stats.from_client)}</td></tr>
          <tr><th>To client</th><td>{stats.from_server?.good ?? 0}</td><td>{stats.from_server?.late ?? 0}</td><td>{stats.from_server?.lost ?? 0}</td><td>{stats.from_server?.resync ?? 0}</td><td>{loss(stats.from_server)}</td></tr>
        </tbody>
      </table>
      <p class="dim small">Counted on the encrypted UDP channel; clients sending voice over TCP show zeros.</p>
    {/if}

    {#if stats.certificates?.length}
      <h3>Certificate</h3>
      <dl>
        <dt>Subject</dt><dd>{certs[0]?.subject.replace(/\n/g, ', ') ?? '...'}</dd>
        <dt>Verified</dt><dd>{stats.strong_certificate ? 'yes, signed by a trusted authority' : 'no, self-signed'}</dd>
      </dl>
      {#if certs.length}
        <button class="btn cert" onclick={() => (ui.cert = { title: `Certificate of ${user?.name ?? target}`, chain: certs })}>View certificate</button>
      {/if}
    {:else if user?.hash}
      <h3>Certificate</h3>
      <dl><dt>SHA-1</dt><dd class="mono">{user.hash}</dd></dl>
      <p class="dim small">Only admins and the user themselves can see the full certificate.</p>
    {/if}

    {#if !stats.version}
      <p class="dim small note">Client details, address and certificate are only shown to admins and to the user themselves.</p>
    {/if}
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
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { padding: 4px 6px; text-align: right; border-bottom: 1px solid var(--line); }
  th:first-child { text-align: left; color: var(--text-faint); font-weight: 400; }
  thead th { color: var(--text-faint); font-weight: 600; }
  .dim { color: var(--text-dim); margin: 0; }
  .small { font-size: 12px; margin-top: 6px; }
  .note { margin-top: 16px; }
  .cert { margin-top: 10px; }
  @media (max-width: 500px) { dl { grid-template-columns: 1fr; } dt { margin-top: 6px; } }
</style>
