<script lang="ts">
  import { onMount, tick } from 'svelte';
  import Modal from './Modal.svelte';
  import { debugLog, type DebugEntry, type LogLevel } from '../core/debug-log.ts';
  let { onclose }: { onclose: () => void } = $props();
  let entries = $state<readonly DebugEntry[]>([]);
  let level = $state<LogLevel | 'all'>('all');
  let search = $state('');
  let follow = $state(true);
  let status = $state('');
  let output = $state<HTMLDivElement>();
  const shown = $derived(entries.filter(e => (level === 'all' || e.level === level) && debugLog.export([e]).toLowerCase().includes(search.toLowerCase())));
  onMount(() => debugLog.subscribe(() => { entries = debugLog.snapshot(); }));
  $effect(() => { void shown; if (follow) void tick().then(() => { if (output) output.scrollTop = output.scrollHeight; }); });
  async function copy() {
    try { await navigator.clipboard.writeText(debugLog.export(shown)); status = 'Log copied.'; }
    catch { status = 'Could not copy. Download the log instead.'; }
  }
  function download() {
    const doc = output?.ownerDocument ?? document;
    const url = URL.createObjectURL(new Blob([debugLog.export(shown)], { type: 'text/plain' }));
    const link = doc.createElement('a'); link.href = url; link.download = `dream-cord-debug-${new Date().toISOString().replaceAll(':', '-')}.txt`;
    doc.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
</script>
<Modal title="Debug log" {onclose} width={1000} height={650}>
  <p class="help">Live diagnostics from this app session, including connection failures, WebSocket close codes and keepalive status. Up to {debugLog.limit} events are kept in memory. Chat messages, passwords, tokens and certificate keys are not logged. Logs can include server addresses and server-provided disconnect reasons.</p>
  <div class="filters">
    <label>Level <select bind:value={level}><option value="all">All levels</option>{#each ['debug', 'info', 'warn', 'error'] as const as l}<option value={l}>{l}</option>{/each}</select></label>
    <label class="search">Search <input type="search" bind:value={search} placeholder="Filter diagnostics" /></label>
    <label class="follow"><input type="checkbox" bind:checked={follow} /> Follow latest</label>
  </div>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex (keyboard users must be able to scroll the log) -->
  <div class="output" role="log" aria-label="Diagnostic events" aria-live="off" tabindex="0" bind:this={output}>
    {#each shown as entry (entry.id)}
      <div class="entry" data-level={entry.level}><time>{entry.time}</time> <strong>{entry.level.toUpperCase()}</strong> [{entry.area}] {entry.message}{#if Object.keys(entry.details).length}{' '}<span>{JSON.stringify(entry.details)}</span>{/if}</div>
    {:else}<p>No matching events.</p>{/each}
  </div>
  <p class="status" role="status">{status || `${shown.length} of ${entries.length} events`}</p>
  {#snippet footer()}
    <button class="btn" onclick={() => { debugLog.clear(); status = ''; }}>Clear log</button>
    <span class="grow"></span>
    <button class="btn" onclick={copy}>Copy log</button>
    <button class="btn" onclick={download}>Download log</button>
    <button class="btn primary" onclick={onclose}>Done</button>
  {/snippet}
</Modal>
<style>
  .help { margin: 0 0 12px; color: var(--text-dim); font-size: 13px; }
  .filters { display: flex; flex-wrap: wrap; align-items: end; gap: 12px; margin-bottom: 12px; }
  label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; }
  .search { flex: 1; min-width: 140px; }
  .follow { flex-direction: row; align-items: center; padding-bottom: 8px; }
  .output { height: clamp(140px, 40vh, 360px); overflow: auto; padding: 10px; background: var(--bg-0); border: 1px solid var(--line); font: 12px/1.6 monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
  .entry { padding: 2px 0; }
  time { color: var(--text-faint); }
  [data-level='warn'] strong { color: var(--warn); }
  [data-level='error'] strong { color: var(--danger); }
  .status { margin: 8px 0 0; color: var(--text-dim); font-size: 12px; }
  .grow { flex: 1; }
</style>
