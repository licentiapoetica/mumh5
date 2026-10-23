<script lang="ts">
  import Avatar from './Avatar.svelte';
  import YouTubeEmbed from './YouTubeEmbed.svelte';
  import LinkPreview from './LinkPreview.svelte';
  import FileCard from './FileCard.svelte';
  import { store } from '../lib/settings.svelte.ts';
  import { session } from '../lib/session.svelte.ts';
  import { menu } from '../lib/menu.svelte.ts';
  import { userMenu, openProfile } from '../lib/actions.ts';
  import type { ChatEntry } from '../lib/session.svelte.ts';

  let { entry, grouped }: { entry: ChatEntry; grouped: boolean } = $props();

  const time = $derived(new Date(entry.time));

  // The author while still online: a click opens their card, right-click their menu
  const authorId = $derived(entry.self ? session.self?.session : entry.authorSession);
  function authorMenu(e: MouseEvent) {
    const u = authorId != null ? session.user(authorId) : undefined;
    if (u) menu.show(e, userMenu(u));
  }
  function authorCard(e: MouseEvent) {
    if (authorId != null && session.user(authorId)) openProfile(authorId, e.currentTarget as Element);
  }
  // Full date and time, shown at the right edge while the pointer is on the message
  const full = $derived(time.toLocaleString([], { dateStyle: 'medium', timeStyle: 'medium' }));
  const hhmm = $derived(time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
  // Next to the name: the time for today, "Yesterday" or the date before that
  const when = $derived.by(() => {
    const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const ago = Math.round((day(new Date()) - day(time)) / 86400000);
    if (ago === 0) return hhmm;
    if (ago === 1) return `Yesterday ${hhmm}`;
    return time.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
  });
</script>

{#if entry.kind === 'system'}
  <div class="system">
    <span class="mark" aria-hidden="true"></span>
    <div class="html">{@html entry.html} <span class="time">{hhmm}</span></div>
  </div>
{:else}
  <article class="msg" class:grouped>
    <time class="stamp" datetime={time.toISOString()}>{full}</time>
    <div class="gutter">
      {#if !grouped}<button class="face" tabindex="-1" aria-hidden="true" onclick={authorCard} oncontextmenu={authorMenu}><Avatar name={entry.author} size={40} src={session.avatar(authorId)} /></button>{/if}
    </div>
    <div class="content">
      {#if !grouped}
        <header>
          <button class="author" onclick={authorCard} oncontextmenu={authorMenu}><strong class:self={entry.self}>{entry.author}</strong></button>
          <time datetime={time.toISOString()} title={full}>{when}</time>
        </header>
      {/if}
      {#if entry.html}<div class="html">{@html entry.html}</div>{/if}
      {#each entry.embeds as m (m.url)}
        {#if m.kind === 'file'}
          <div class="embed"><FileCard meta={m.file!} poster={m.poster ?? ''} author={entry.self ? null : entry.authorSession} /></div>
        {:else if m.kind === 'link'}
          <div class="embed"><LinkPreview url={m.url} /></div>
        {:else if m.kind === 'youtube'}
          {#if store.settings.youtube !== 'off'}<div class="embed"><YouTubeEmbed videoId={m.videoId!} start={m.start} url={m.url} /></div>{/if}
        {:else}
        <div class="embed">
          {#if m.kind === 'image'}
            <a href={m.url} target="_blank" rel="noopener noreferrer"><img src={m.url} alt={m.name} loading="lazy" /></a>
          {:else if m.kind === 'video'}
            <video src={m.url} controls preload="metadata"><track kind="captions" /></video>
          {:else}
            <audio src={m.url} controls preload="metadata"></audio>
          {/if}
        </div>
        {/if}
      {/each}
    </div>
  </article>
{/if}

<style>
  .msg { position: relative; display: flex; gap: 14px; padding: 3px 16px; margin-top: 14px; font-size: var(--fs-chat); line-height: 1.5; }
  /* Over the end of the line, with its own background so it stays readable on long messages */
  .stamp { position: absolute; top: 2px; right: 12px; padding: 1px 7px; line-height: 18px; background: var(--bg-1); border: 1px solid var(--line-strong); box-shadow: var(--shadow-pop); visibility: hidden; pointer-events: none; }
  .msg:hover .stamp { visibility: visible; }
  .msg.grouped { margin-top: 0; padding-top: 1px; padding-bottom: 1px; }
  .msg:hover { background: color-mix(in srgb, var(--text) 3%, transparent); }
  .gutter { width: 40px; flex: none; display: flex; justify-content: center; padding-top: 2px; }
  .content { flex: 1; min-width: 0; }
  header { display: flex; align-items: baseline; gap: 8px; line-height: 1.35; margin-bottom: 1px; }
  header strong { font-weight: 600; }
  .author:hover strong { text-decoration: underline; }
  .face { display: flex; }
  header strong.self { color: var(--accent-hover); }
  time, .time { font-size: 12px; color: var(--text-faint); font-variant-numeric: tabular-nums; }
  .stamp { font-size: 11px; color: var(--text-dim); }
  .html { overflow-wrap: anywhere; user-select: text; }
  .html :global(p) { margin: 0; }
  .html :global(img) { max-width: min(520px, 100%); max-height: 360px; display: block; margin-top: 4px; border: 1px solid var(--line); }
  .html :global(pre), .html :global(code) { font-family: var(--mono); font-size: 13px; background: var(--bg-0); padding: 1px 4px; }
  .html :global(pre) { padding: 8px 10px; overflow-x: auto; }
  .html :global(blockquote) { margin: 4px 0; padding-left: 10px; border-left: 3px solid var(--line); color: var(--text-dim); }
  .embed { margin-top: 6px; max-width: min(520px, 100%); }
  .embed img, .embed video { display: block; max-width: 100%; max-height: 360px; background: var(--bg-0); border: 1px solid var(--line); }
  .embed audio { width: 100%; }
  .system { display: flex; gap: 14px; padding: 4px 16px; margin-top: 10px; color: var(--text-dim); font-size: 13px; }
  .system .mark { width: 40px; flex: none; display: flex; justify-content: center; padding-top: 7px; }
  .system .mark::before { content: ''; width: 6px; height: 6px; background: var(--text-faint); }
  .system .time { margin-left: 6px; }
  .system .html { flex: 1; min-width: 0; }
</style>
