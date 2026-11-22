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
  const names = (r: Reaction) => r.who.map(w => (w.k === me ? 'You' : w.name)).sort((a, b) => Number(b === 'You') - Number(a === 'You'));
  const reactedBy = (r: Reaction) => reactorNames(names(r));

  // Who reacted: a popover on hover (short delay), keyboard focus and touch long-press.
  // Native title tooltips do not show reliably in Electron and never on touch.
  const tipId = $props.id();
  let tip = $state<{ emoji: string; rect: DOMRect } | null>(null);
  let tipEl = $state<HTMLElement>();
  let tipPos = $state({ x: 0, y: 0 });
  let showTimer: ReturnType<typeof setTimeout> | undefined;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  let pressed = false; // a long-press opened the popover, so the click that follows is not a toggle
  const tipReaction = $derived(tip ? entry.reactions.find(r => r.emoji === tip!.emoji) : undefined);

  function showTip(chip: HTMLElement, emoji: string, delay: number) {
    clearTimeout(hideTimer);
    clearTimeout(showTimer);
    showTimer = setTimeout(() => { tip = { emoji, rect: chip.getBoundingClientRect() }; }, delay);
  }
  function hideTip(delay = 0) {
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { tip = null; }, delay);
  }
  function chipDown(e: PointerEvent, emoji: string) {
    if (e.pointerType !== 'touch') return;
    pressed = false;
    clearTimeout(showTimer);
    const chip = e.currentTarget as HTMLElement;
    showTimer = setTimeout(() => { pressed = true; tip = { emoji, rect: chip.getBoundingClientRect() }; }, 500);
  }
  function chipClick(emoji: string) {
    if (pressed) { pressed = false; return; }
    ontoggle?.(emoji);
  }

  // Above the chip, below it when there is no room, always inside the window
  $effect(() => {
    if (!tip || !tipEl) return;
    const { rect } = tip;
    const w = tipEl.offsetWidth, h = tipEl.offsetHeight, gap = 6, edge = 8;
    const above = rect.top - gap - h >= edge;
    const y = above ? rect.top - gap - h : Math.min(rect.bottom + gap, window.innerHeight - h - edge);
    const x = Math.max(edge, Math.min(rect.left, window.innerWidth - w - edge));
    tipPos = { x, y: Math.max(edge, y) };
  });
  // Escape or a tap elsewhere closes it; a scroll moves the chip away from it
  $effect(() => {
    if (!tip) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') hideTip(); };
    const down = (e: PointerEvent) => {
      if (!(e.target as Element).closest?.('.reaction:not(.add), .reactors')) hideTip();
    };
    window.addEventListener('keydown', key);
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('scroll', () => hideTip(), { capture: true, once: true });
    return () => {
      window.removeEventListener('keydown', key);
      window.removeEventListener('pointerdown', down, true);
    };
  });
  $effect(() => () => { clearTimeout(showTimer); clearTimeout(hideTimer); });

  // Moved to body so no transformed or clipped ancestor affects fixed placement
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return { destroy: () => node.remove() };
  }

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
  const authorId = $derived(session.chatAuthor(entry)?.session);
  // Someone still here shows under their current name, also on older messages
  const authorName = $derived.by(() => {
    const u = session.chatAuthor(entry);
    return u ? store.displayName(u) : entry.author;
  });
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
      {#if !grouped}<button class="face" data-menu-row tabindex="-1" aria-hidden="true" onclick={authorCard} oncontextmenu={authorMenu}><Avatar name={authorName} size={40} src={session.avatar(authorId)} keep /></button>{/if}
    </div>
    <div class="content">
      {#if !grouped}
        <header>
          <button class="author" data-menu-row onclick={authorCard} oncontextmenu={authorMenu}><strong class:self={entry.self}>{authorName}</strong></button>
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
        {:else if m.url.startsWith('data:image/') || store.settings.mediaLinks !== 'off' || store.trustedHosts.includes(new URL(m.url).host.toLowerCase())}
          <div class="embed"><MediaLink kind={m.kind} url={m.url} name={m.name} /></div>
        {/if}
      {/each}
      {#if entry.reactions.length}
        <div class="reactions">
          {#each entry.reactions as r (r.emoji)}
            <button class="reaction" class:mine={mine(r)} aria-pressed={mine(r)} disabled={!ontoggle}
              aria-label="{r.emoji} {r.who.length}, {reactedBy(r)} reacted" aria-describedby={tip?.emoji === r.emoji ? tipId : undefined}
              onclick={() => chipClick(r.emoji)}
              onpointerenter={e => { if (e.pointerType === 'mouse') showTip(e.currentTarget, r.emoji, 350); }}
              onpointerleave={e => { if (e.pointerType === 'mouse') hideTip(120); }}
              onpointerdown={e => chipDown(e, r.emoji)}
              onpointerup={e => { if (e.pointerType === 'touch') clearTimeout(showTimer); }}
              onpointercancel={() => clearTimeout(showTimer)}
              oncontextmenu={e => { if (pressed) e.preventDefault(); }}
              onfocus={e => { if (e.currentTarget.matches(':focus-visible')) showTip(e.currentTarget, r.emoji, 0); }}
              onblur={() => hideTip()}>
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
  {#if tip && tipReaction}
    <div class="reactors" id={tipId} role="tooltip" use:portal style="left:{tipPos.x}px;top:{tipPos.y}px"
      onpointerenter={() => clearTimeout(hideTimer)} onpointerleave={() => hideTip(120)}>
      <div class="rh"><span class="e">{tipReaction.emoji}</span><span class="n">{tipReaction.who.length}</span></div>
      <ul>{#each names(tipReaction) as n}<li>{n}</li>{/each}</ul>
    </div>
  {/if}
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
  .reactors { position: fixed; z-index: 1000; min-width: 120px; max-width: min(260px, calc(100vw - 16px)); max-height: min(40vh, 280px); overflow-y: auto; padding: 6px 0; font-size: 13px; color: var(--text); background: var(--bg-1); border: 1px solid var(--line-strong); }
  .reactors .rh { display: flex; align-items: center; gap: 6px; padding: 0 10px 4px; color: var(--text-dim); }
  .reactors .e { font-size: 18px; font-family: 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif; }
  .reactors .n { font-weight: 600; font-variant-numeric: tabular-nums; }
  .reactors ul { margin: 0; padding: 0; list-style: none; }
  .reactors li { padding: 2px 10px; overflow-wrap: anywhere; }
  .reaction.add { visibility: hidden; padding: 0 6px; }
  .msg:hover .reaction.add, .msg:focus-within .reaction.add, .msg.active .reaction.add { visibility: visible; }
  .msg.grouped { margin-top: 0; padding-top: 1px; padding-bottom: 1px; }
  .msg:hover { background: color-mix(in srgb, var(--text) 3%, transparent); }
  .gutter { width: 40px; flex: none; display: flex; justify-content: center; padding-top: 2px; }
  .content { flex: 1; min-width: 0; }
  header { display: flex; align-items: baseline; gap: 8px; line-height: 1.35; margin-bottom: 1px; }
  header strong { font-weight: 600; }
  .author:hover strong { text-decoration: underline; }
  .face { display: flex; align-self: flex-start; }
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
