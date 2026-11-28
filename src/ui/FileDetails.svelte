<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { files, type Transfer } from '../lib/files.svelte.ts';
  import { session } from '../lib/session.svelte.ts';
  import { store } from '../lib/settings.svelte.ts';
  import { formatBytes } from '../lib/html.ts';
  import { pieceCount, type FileMeta } from '../core/file-transfer.ts';
  import type { PeerStat } from '../lib/file-meters.ts';

  // The details of a file transfer: pieces, speed and time, and everyone it comes from or goes to,
  // with the route and, for a WebRTC link, its path. Read from files.svelte.ts once a second.
  let { meta, t }: { meta: FileMeta; t: Transfer | undefined } = $props();

  let now = $state(Date.now());
  let serverRtt = $state<number | null>(null);
  function read() {
    now = Date.now();
    const r = session.client?.link.read(now);
    serverRtt = r?.answers ? Math.round(r.rtt) : null;
  }
  read();
  const clock = setInterval(read, 1000);
  onMount(() => files.details(meta.i, true));
  onDestroy(() => { clearInterval(clock); files.details(meta.i, false); });

  const secs = (ms: number) => ms < 60000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.floor(ms / 60000)} min ${Math.round((ms % 60000) / 1000)} s`;
  const rate = (r: number) => `${formatBytes(Math.round(r))}/s`;
  const ROUTE: Record<PeerStat['route'], string> = { server: 'Mumble server', direct: 'direct', relay: 'TURN relay', mumpeer: 'mumpeer' };
  const stateOf = (p: PeerStat) => ({
    waiting: 'waiting', connecting: 'connecting', active: p.dir === 'from' ? 'sending to you' : 'receiving',
    done: p.dir === 'from' ? 'done' : 'has it', gone: p.dir === 'from' ? 'stopped' : 'left'
  })[p.state];
  // "35 direct, 1 Mumble server" when more than one route carried pieces
  const mix = (p: PeerStat) => {
    const parts = (Object.entries(p.via) as [PeerStat['route'], number][]).filter(([, n]) => n > 0);
    return parts.length > 1 ? ` (${parts.map(([r, n]) => `${n} ${ROUTE[r]}`).join(', ')})` : '';
  };
  const nameOf = (id: number) => { const u = session.user(id); return u ? store.displayName(u) : `#${id}`; };

  const downloading = $derived(!!t?.started);
  const count = $derived(t?.count || pieceCount(meta));
  const elapsed = $derived(t?.started ? (t.ended || now) - t.started : 0);
  const from = $derived((t?.peers ?? []).filter(p => p.dir === 'from'));
  const to = $derived((t?.peers ?? []).filter(p => p.dir === 'to'));
</script>

<div class="details" role="region" aria-label="Transfer details">
  <dl>
    {#if downloading}
      <dt>Pieces</dt><dd>{t!.state === 'ready' ? count : t!.pieces} of {count}, {formatBytes(meta.c)} each</dd>
      <dt>Speed</dt><dd>{t!.state === 'loading' ? `${rate(t!.rate)} now, ` : ''}{elapsed > 0 ? `${rate((t!.state === 'ready' ? meta.s : t!.got) / (elapsed / 1000))} on average` : '...'}</dd>
      <dt>Time</dt><dd>{secs(elapsed)}{t!.state === 'loading' && t!.rate > 0 ? `, about ${secs(((meta.s - t!.got) / t!.rate) * 1000)} left` : ''}</dd>
    {:else}
      <dt>Pieces</dt><dd>{count}, {formatBytes(meta.c)} each</dd>
    {/if}
    <dt>Check</dt><dd title="SHA-256 over the SHA-256 of every piece, from the announcement">{meta.h.slice(0, 16)}...{t?.state === 'ready' && downloading ? ', matched' : downloading ? ', checked when complete' : ''}</dd>
    {#if serverRtt != null}<dt>Server round trip</dt><dd>{serverRtt} ms</dd>{/if}
  </dl>

  {#snippet people(title: string, list: PeerStat[])}
    <h4>{title}</h4>
    <ul>
      {#each list as p (p.session)}
        <li>
          <span class="who">{nameOf(p.session)}</span>
          <span class="what">{ROUTE[p.route]}, {stateOf(p)}</span>
          <!-- What we got from someone counts each piece once; what we sent can include pieces sent again -->
          <span class="num">{p.dir === 'from' ? `${formatBytes(p.bytes)} (${Math.min(100, Math.round((p.bytes / meta.s) * 100))}%)` : `${formatBytes(p.bytes)} sent`}, {p.pieces} {p.pieces === 1 ? 'piece' : 'pieces'}{mix(p)}{p.rate > 0 ? `, ${rate(p.rate)}` : ''}</span>
          {#if p.path}<span class="path">{p.path}</span>{/if}
        </li>
      {/each}
    </ul>
  {/snippet}
  {#if from.length}{@render people('From', from)}{/if}
  {#if to.length}{@render people('To', to)}{/if}
  {#if !from.length && !to.length}<p>Nobody has asked for it yet.</p>{/if}
</div>

<style>
  .details { padding: 8px 10px 10px; border-top: 1px solid var(--line); background: var(--bg-0); font-size: 12px; color: var(--text-dim); user-select: text; }
  dl { display: grid; grid-template-columns: auto 1fr; gap: 2px 12px; margin: 0; }
  dt { white-space: nowrap; }
  dd { margin: 0; color: var(--text); font-family: var(--mono); font-size: 11px; overflow-wrap: anywhere; align-self: center; }
  h4 { margin: 10px 0 4px; font-size: 11px; font-weight: 650; letter-spacing: 0.07em; text-transform: uppercase; color: var(--text-faint); }
  ul { list-style: none; margin: 0; padding: 0; }
  li { display: grid; grid-template-columns: minmax(0, auto) minmax(0, 1fr); gap: 0 10px; padding: 4px 0; }
  li + li { border-top: 1px solid var(--line); }
  .who { color: var(--text); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .what { text-align: right; }
  .num, .path { grid-column: 1 / -1; font-family: var(--mono); font-size: 11px; color: var(--text); overflow-wrap: anywhere; }
  .path { color: var(--text-dim); }
  p { margin: 8px 0 0; }
</style>
