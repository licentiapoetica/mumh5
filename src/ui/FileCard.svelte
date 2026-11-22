<script lang="ts">
  import { untrack } from 'svelte';
  import Icon from './Icon.svelte';
  import MediaCard from './MediaCard.svelte';
  import MediaPlayer from './MediaPlayer.svelte';
  import PdfPreview from './PdfPreview.svelte';
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

<MediaCard file name={meta.n} detail={status} icon={kind === 'image' ? 'image' : kind === 'video' ? 'screen' : kind === 'audio' ? 'headphones' : 'file'}
  href={ready ? t!.url : undefined} failed={t?.state === 'failed'} progress={busy ? (t!.got / Math.max(1, meta.s)) * 100 : undefined}>
  {#snippet actions()}
    {#if busy}
      <button class="icon-btn" title="Stop" aria-label="Stop downloading {meta.n}" onclick={() => files.cancel(meta.i)}><Icon name="x" size={18} /></button>
    {:else if !ready}
      <button class="btn" title="Comes through the Mumble server, {eta(meta.s)} from one person" onclick={get}>{t?.state === 'failed' ? 'Try again' : 'Download'}</button>
    {/if}
  {/snippet}
  {#if ready && kind === 'image'}
    <img src={t!.url} alt={meta.n} />
  {:else if ready && (kind === 'video' || kind === 'audio')}
    <MediaPlayer {kind} url={t!.url} name={meta.n} />
  {:else if ready && kind === 'pdf'}
    <PdfPreview url={t!.url} name={meta.n} />
  {:else if !ready && poster}
    <button class="poster" title={busy ? meta.n : `Download (${eta(meta.s - (t?.got ?? 0))})`} disabled={busy} onclick={get}>
      <img src={poster} alt="" />
      {#if kind === 'video' && !busy}<span class="play"><Icon name="download" size={28} /></span>{/if}
    </button>
  {/if}
</MediaCard>

<style>
  .poster { position: relative; display: block; padding: 0; max-width: 100%; }
  .poster:disabled { cursor: default; }
  .play { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: #fff; background: rgb(0 0 0 / 0.25); }
</style>
