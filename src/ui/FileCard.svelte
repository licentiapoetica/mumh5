<script lang="ts">
  import { untrack } from 'svelte';
  import Icon from './Icon.svelte';
  import { files, fileKind, type Transfer } from '../lib/files.svelte.ts';
  import { sessions } from '../lib/session.svelte.ts';
  import { formatBytes } from '../lib/html.ts';
  import type { FileMeta } from '../core/file-transfer.ts';

  // A file sent through the Mumble server: the preview picture until it is here, then the file itself
  let { meta, poster, author }: { meta: FileMeta; poster: string; author: number | null } = $props();

  const t = $derived<Transfer | undefined>(files.transfers[meta.i]);
  const kind = $derived(fileKind(meta));
  const ready = $derived(t?.state === 'ready');
  const busy = $derived(t?.state === 'finding' || t?.state === 'loading');

  $effect(() => { const m = meta; untrack(() => files.check(m)); });

  // A server with default limits carries about 200 KB a second from each person sending
  function eta(bytes: number): string {
    const s = bytes / 200_000;
    return s < 60 ? 'less than a minute' : s < 5400 ? `about ${Math.round(s / 60)} min` : `about ${Math.round(s / 3600)} h`;
  }

  const status = $derived.by(() => {
    if (!t || t.state === 'idle') return formatBytes(meta.s);
    if (t.state === 'finding') return 'Looking for someone who has it';
    if (t.state === 'loading') return `${formatBytes(t.got)} of ${formatBytes(meta.s)}${t.rate ? `, ${formatBytes(Math.round(t.rate))}/s` : ''}`;
    if (t.state === 'failed') return t.error;
    return formatBytes(meta.s) + (t.sending ? `, sending to ${t.sending}` : '');
  });

  const get = () => files.download(sessions.active, meta, author);
</script>

<div class="file" class:failed={t?.state === 'failed'}>
  {#if ready && kind === 'image'}
    <img src={t!.url} alt={meta.n} />
  {:else if ready && kind === 'video'}
    <video src={t!.url} controls preload="metadata"><track kind="captions" /></video>
  {:else if ready && kind === 'audio'}
    <audio src={t!.url} controls preload="metadata"></audio>
  {:else if poster}
    <button class="poster" title={busy ? meta.n : `Download (${eta(meta.s - (t?.got ?? 0))})`} disabled={busy} onclick={get}>
      <img src={poster} alt="" />
      {#if kind === 'video' && !busy}<span class="play"><Icon name="download" size={28} /></span>{/if}
    </button>
  {/if}
  <div class="row">
    <Icon name="file" size={18} />
    <div class="info">
      <span class="name" title={meta.n}>{meta.n}</span>
      <span class="sub">{status}</span>
    </div>
    {#if ready}
      <a class="icon-btn" href={t!.url} download={meta.n} title="Save" aria-label="Save {meta.n}"><Icon name="download" size={18} /></a>
    {:else if busy}
      <button class="icon-btn" title="Stop" aria-label="Stop downloading {meta.n}" onclick={() => files.cancel(meta.i)}><Icon name="x" size={18} /></button>
    {:else}
      <button class="btn" title="Comes through the Mumble server, {eta(meta.s)} from one person" onclick={get}>{t?.state === 'failed' ? 'Try again' : 'Download'}</button>
    {/if}
  </div>
  {#if busy}<div class="bar"><span style:width="{(t!.got / meta.s) * 100}%"></span></div>{/if}
</div>

<style>
  .file { display: flex; flex-direction: column; background: var(--bg-1); border: 1px solid var(--line); max-width: 100%; }
  .file.failed .sub { color: var(--danger); }
  .file > img, .file > video, .poster img { display: block; max-width: 100%; max-height: 360px; background: var(--bg-0); }
  .file > audio { width: 100%; }
  .poster { position: relative; display: block; padding: 0; align-self: flex-start; max-width: 100%; }
  .poster:disabled { cursor: default; }
  .play { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: #fff; background: rgb(0 0 0 / 0.25); }
  .row { display: flex; align-items: center; gap: 10px; padding: 8px 10px; color: var(--text-dim); }
  .info { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .name { color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sub { font-size: 12px; overflow-wrap: anywhere; }
  .bar { height: 3px; background: var(--bg-3); }
  .bar span { display: block; height: 100%; background: var(--accent); transition: width 200ms; }
</style>
