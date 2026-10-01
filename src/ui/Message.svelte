<script lang="ts">
  import Avatar from './Avatar.svelte';
  import YouTubeEmbed from './YouTubeEmbed.svelte';
  import LinkPreview from './LinkPreview.svelte';
  import { store } from '../lib/settings.svelte.ts';
  import { session } from '../lib/session.svelte.ts';
  import { menu } from '../lib/menu.svelte.ts';
  import { userMenu } from '../lib/actions.ts';
  import type { ChatEntry } from '../lib/session.svelte.ts';

  let { entry, grouped }: { entry: ChatEntry; grouped: boolean } = $props();

  const time = $derived(new Date(entry.time));

  // Right-click on the author opens the user menu while they are still online
  function authorMenu(e: MouseEvent) {
    const u = entry.authorSession != null ? session.user(entry.authorSession) : undefined;
    if (u) menu.show(e, userMenu(u));
  }
  // Full date and time, shown at the right edge while the pointer is on the message
  const full = $derived(time.toLocaleString([], { dateStyle: 'medium', timeStyle: 'medium' }));
  const hhmm = $derived(time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
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
      {#if !grouped}<span role="presentation" oncontextmenu={authorMenu}><Avatar name={entry.author} size={38} /></span>{/if}
    </div>
    <div class="content">
      {#if !grouped}
        <header>
          <strong class:self={entry.self} oncontextmenu={authorMenu}>{entry.author}</strong>
          <time datetime={time.toISOString()}>{time.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</time>
        </header>
      {/if}
      {#if entry.html}<div class="html">{@html entry.html}</div>{/if}
      {#each entry.embeds as m (m.url)}
        {#if m.kind === 'link'}
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
  .msg { position: relative; display: flex; gap: 14px; padding: 2px 16px; margin-top: 14px; }
  /* Over the end of the line, with its own background so it stays readable on long messages */
  .stamp { position: absolute; top: 2px; right: 12px; padding: 1px 6px; line-height: 18px; background: var(--bg-1); border: 1px solid var(--line); visibility: hidden; pointer-events: none; }
  .msg:hover .stamp { visibility: visible; }
  .msg.grouped { margin-top: 0; }
  .msg:hover { background: rgb(255 255 255 / 0.02); }
  .gutter { width: 38px; flex: none; display: flex; justify-content: center; }
  .content { flex: 1; min-width: 0; }
  header { display: flex; align-items: baseline; gap: 8px; }
  header strong { font-weight: 600; }
  header strong.self { color: var(--accent-hover); }
  time, .time { font-size: 11px; color: var(--text-faint); }
  .html { overflow-wrap: anywhere; user-select: text; }
  .html :global(p) { margin: 0; }
  .html :global(img) { max-width: min(520px, 100%); max-height: 360px; display: block; margin-top: 4px; border: 1px solid var(--line); }
  .html :global(pre), .html :global(code) { font-family: var(--mono); font-size: 13px; background: var(--bg-0); padding: 1px 4px; }
  .html :global(pre) { padding: 8px 10px; overflow-x: auto; }
  .html :global(blockquote) { margin: 4px 0; padding-left: 10px; border-left: 3px solid var(--line); color: var(--text-dim); }
  .embed { margin-top: 6px; max-width: min(520px, 100%); }
  .embed img, .embed video { display: block; max-width: 100%; max-height: 360px; background: var(--bg-0); border: 1px solid var(--line); }
  .embed audio { width: 100%; }
  .system { display: flex; gap: 14px; padding: 4px 16px; margin-top: 8px; color: var(--text-dim); font-size: 13px; }
  .system .mark { width: 38px; flex: none; display: flex; justify-content: center; padding-top: 7px; }
  .system .mark::before { content: ''; width: 6px; height: 6px; background: var(--text-faint); }
  .system .time { margin-left: 6px; }
  .system .html { flex: 1; min-width: 0; }
</style>
