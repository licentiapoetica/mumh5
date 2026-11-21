<script lang="ts">
  import Avatar from './Avatar.svelte';
  import YouTubeEmbed from './YouTubeEmbed.svelte';
  import LinkPreview from './LinkPreview.svelte';
  import MediaLink from './MediaLink.svelte';
  import FileCard from './FileCard.svelte';
  import Icon from './Icon.svelte';
  import { store } from '../lib/settings.svelte.ts';
  import { session } from '../lib/session.svelte.ts';
  import { menu } from '../lib/menu.svelte.ts';
  import { userMenu, openProfile } from '../lib/actions.ts';
  import { reactorKey, reactorNames, type Reaction } from '../core/reactions.ts';
  import type { ChatEntry } from '../lib/session.svelte.ts';

  // onreact opens the emoji picker at the given button; left out where reactions are not possible.
  // active: the picker is open for this message, or it was tapped on a touch screen.
  let { entry, grouped, onreact, ontoggle, active = false, ontouch }: {
    entry: ChatEntry;
    grouped: boolean;
    onreact?: (anchor: HTMLElement) => void;
    ontoggle?: (emoji: string) => void;
    active?: boolean;
    ontouch?: () => void;
  } = $props();

  let article = $state<HTMLElement>();
  let reactButton = $state<HTMLButtonElement>();
  const me = $derived(session.self ? reactorKey(session.self) : '');
  const mine = (r: Reaction) => r.who.some(w => w.k === me);
  const reactedBy = (r: Reaction) => reactorNames(r.who.map(w => (w.k === me ? 'You' : w.name)).sort((a, b) => Number(b === 'You') - Number(a === 'You')));

  // Add reaction in the desktop app's right-click menu (lib/text-menu.ts)
  $effect(() => {
    const el = article;
    if (!el || !onreact) return;
    const open = () => { if (reactButton) onreact(reactButton); };
    el.addEventListener('mumh5:react', open);
    return () => el.removeEventListener('mumh5:react', open);
  });

  // Touch screens have no hover: a tap on the message shows its buttons
  function tapped(e: PointerEvent) {
    if (e.pointerType === 'touch' && !(e.target as Element).closest('a, button, input, video, img, .code')) ontouch?.();
  }

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
  <article class="msg" class:grouped class:active data-reactable={onreact ? '' : undefined} bind:this={article} onpointerup={tapped}>
    <div class="tools">
      <time class="stamp" datetime={time.toISOString()}>{full}</time>
      {#if onreact}
        <button class="react" title="Add reaction" aria-label="Add reaction" bind:this={reactButton}
          onclick={e => onreact(e.currentTarget)}><Icon name="smile" size={14} /></button>
      {/if}
    </div>
    <div class="gutter">
      {#if !grouped}<button class="face" data-menu-row tabindex="-1" aria-hidden="true" onclick={authorCard} oncontextmenu={authorMenu}><Avatar name={entry.author} size={40} src={session.avatar(authorId)} keep /></button>{/if}
    </div>
    <div class="content">
      {#if !grouped}
        <header>
          <button class="author" data-menu-row onclick={authorCard} oncontextmenu={authorMenu}><strong class:self={entry.self}>{entry.author}</strong></button>
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
        {:else if store.settings.mediaLinks !== 'off' || store.trustedHosts.includes(new URL(m.url).host.toLowerCase())}
          <div class="embed"><MediaLink kind={m.kind} url={m.url} name={m.name} /></div>
        {/if}
      {/each}
      {#if entry.reactions.length}
        <div class="reactions">
          {#each entry.reactions as r (r.emoji)}
            <button class="reaction" class:mine={mine(r)} aria-pressed={mine(r)} disabled={!ontoggle}
              title="{reactedBy(r)} reacted with {r.emoji}" onclick={() => ontoggle?.(r.emoji)}>
              <span class="e">{r.emoji}</span><span class="n">{r.who.length}</span>
            </button>
          {/each}
          {#if onreact}
            <button class="reaction add" title="Add reaction" aria-label="Add reaction" onclick={e => onreact(e.currentTarget)}><Icon name="smile" size={14} /></button>
          {/if}
        </div>
      {/if}
    </div>
  </article>
{/if}

<style>
  .msg { position: relative; display: flex; gap: 14px; padding: 3px 16px; margin-top: 14px; font-size: var(--fs-chat); line-height: 1.5; }
  /* Over the end of the line, with their own background so they stay readable on long messages */
  .tools { position: absolute; top: 2px; right: 12px; z-index: 1; display: flex; gap: 4px; visibility: hidden; pointer-events: none; }
  .msg:hover .tools, .msg:focus-within .tools, .msg.active .tools { visibility: visible; }
  .stamp { padding: 1px 7px; line-height: 18px; background: var(--bg-1); border: 1px solid var(--line-strong); }
  .react { pointer-events: auto; width: 22px; display: grid; place-items: center; background: var(--bg-1); border: 1px solid var(--line-strong); color: var(--text-dim); transition: color 120ms var(--ease), background 120ms var(--ease); }
  .react:hover, .msg.active .react { color: var(--text); background: var(--bg-hover); }
  .reactions { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
  .reaction { height: 24px; display: inline-flex; align-items: center; gap: 5px; padding: 0 7px; font-size: 13px; line-height: 1; color: var(--text-dim); background: var(--bg-1); border: 1px solid var(--line); transition: border-color 120ms var(--ease), background 120ms var(--ease); }
  .reaction:hover:not(:disabled) { border-color: var(--line-strong); background: var(--bg-hover); }
  .reaction.mine { color: var(--text); border-color: color-mix(in srgb, var(--accent) 70%, var(--line)); background: color-mix(in srgb, var(--accent) 14%, var(--bg-1)); }
  .reaction:disabled { cursor: default; }
  .reaction .e { font-family: 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif; font-size: 15px; }
  .reaction .n { font-weight: 600; font-variant-numeric: tabular-nums; }
  .reaction.add { visibility: hidden; padding: 0 6px; }
  .msg:hover .reaction.add, .msg:focus-within .reaction.add, .msg.active .reaction.add { visibility: visible; }
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
  /* Inline code; blocks are .code in app.css */
  .html :global(code) { font-family: var(--mono); font-size: 13px; background: var(--bg-0); padding: 1px 4px; }
  .html :global(blockquote) { margin: 4px 0; padding-left: 10px; border-left: 3px solid var(--line); color: var(--text-dim); }
  .embed { margin-top: 6px; max-width: min(520px, 100%); }
  .system { display: flex; gap: 14px; padding: 4px 16px; margin-top: 10px; color: var(--text-dim); font-size: 13px; }
  .system .mark { width: 40px; flex: none; display: flex; justify-content: center; padding-top: 7px; }
  .system .mark::before { content: ''; width: 6px; height: 6px; background: var(--text-faint); }
  .system .time { margin-left: 6px; }
  .system .html { flex: 1; min-width: 0; }
</style>
