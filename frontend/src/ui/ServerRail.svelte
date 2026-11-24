<script lang="ts">
  import Icon from './Icon.svelte';
  import { serverInitials as initials, store } from '../lib/settings.svelte.ts';
  import { sessions } from '../lib/session.svelte.ts';
  import { menu } from '../lib/menu.svelte.ts';
  import { desktop } from '../lib/native.ts';
  import { railMenu, serverState as stateOf, serverUnread as unreadOf } from '../lib/server-menu.ts';

  // canHide: false in the phone drawer, which opens and closes by itself
  let { onadd, onbrowse, canHide = true }:
    { onadd: () => void; onbrowse: () => void; canHide?: boolean } = $props();

  // The home screen over a connected server takes the marker from that server's tile
  const homeOver = $derived(sessions.homeShown && sessions.active.status !== 'idle');

  function hide() {
    store.settings.railHidden = true;
    store.saveSettings();
  }

  // Drag and drop reordering
  let dragging = $state<string | null>(null);
  let dropIndex = $state<number | null>(null);

  function onDragOver(e: DragEvent, i: number) {
    if (!dragging) return;
    e.preventDefault();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    dropIndex = e.clientY < r.top + r.height / 2 ? i : i + 1;
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    if (dragging && dropIndex !== null) {
      const from = store.servers.findIndex(s => s.id === dragging);
      store.moveServer(dragging, dropIndex > from ? dropIndex - 1 : dropIndex);
    }
    dragging = null;
    dropIndex = null;
  }

  // A double click on the collapsed button opens the list under the pointer. Its second click
  // lands on whatever tile appeared there and must not switch servers or close the list again.
  let firstClickHere = false;
  function guardClick(e: MouseEvent) {
    if (e.detail <= 1) firstClickHere = true;
    else if (!firstClickHere) { e.preventDefault(); e.stopPropagation(); }
  }
</script>

<nav class="rail" aria-label="Servers" onclickcapture={guardClick} ondrop={onDrop} ondragover={e => { if (dragging) e.preventDefault(); }}>
  {#each store.servers as s, i (s.id)}
    {@const state = stateOf(s.id)}
    {@const unread = unreadOf(s.id)}
    {#if dropIndex === i && dragging}<div class="drop-line"></div>{/if}
    <button class="tile" class:active={sessions.activeId === s.id && !homeOver} class:live={state === 'connected'}
      class:connecting={state === 'connecting'} class:voice={sessions.voiceId === s.id && state === 'connected'}
      class:dragged={dragging === s.id}
      title="{s.label} ({s.host}){state === 'connected' ? (sessions.voiceId === s.id ? ', voice' : ', connected') : ''}"
      draggable="true"
      ondragstart={e => { dragging = s.id; e.dataTransfer?.setData('text/plain', s.id); if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'; }}
      ondragend={() => { dragging = null; dropIndex = null; }}
      ondragover={e => onDragOver(e, i)}
      onclick={() => sessions.open(s)}
      ondblclick={() => { if (canHide && firstClickHere) hide(); }}
      oncontextmenu={e => menu.show(e, railMenu(s, i))}>
      {#if s.icon}<img class="icon" src={s.icon} alt="" draggable="false" />{:else}{initials(s.label)}{/if}
      {#if unread}<span class="unread">{unread > 99 ? '99+' : unread}</span>{/if}
    </button>
  {/each}
  {#if dropIndex === store.servers.length && dragging}<div class="drop-line"></div>{/if}
  <button class="tile add" title="Add a server" onclick={onadd}><Icon name="plus" size={18} /></button>
  <!-- The public list and its pings need the desktop app -->
  {#if desktop}<button class="tile add" title="Browse public servers" onclick={onbrowse}><Icon name="globe" size={18} /></button>{/if}
  <div class="spacer"></div>
  {#if sessions.active.status !== 'idle'}
    {@const label = sessions.homeShown ? 'Back to server' : 'Go to home screen'}
    <button class="tile ghost" class:active={homeOver} title={label} aria-label={label} aria-pressed={homeOver} onclick={() => (sessions.homeShown = !sessions.homeShown)}><Icon name="home" size={18} /></button>
  {/if}
  {#if canHide}<button class="tile ghost" title="Hide server list" aria-label="Hide server list" onclick={hide}><Icon name="sidebar" size={18} /></button>{/if}
</nav>

<style>
  /* The server you are talking on leads the list, wherever it sits in your own order */
  .tile.voice { order: -1; }
  /* The first tile sits exactly where ServerButton sits while the list is hidden */
  .rail {
    width: var(--rail-w); flex: none; background: var(--bg-0); display: flex; flex-direction: column;
    align-items: center; gap: 8px; padding: 8px 0; overflow-y: auto;
  }
  .tile {
    position: relative; width: 36px; height: 36px; flex: none; display: flex; align-items: center; justify-content: center;
    background: var(--bg-3); font-weight: 650; font-size: 12px; letter-spacing: 0.02em; transition: background 120ms var(--ease), color 120ms var(--ease);
  }
  .tile:hover { background: var(--accent); color: var(--accent-text); }
  .tile.active { background: var(--accent); color: var(--accent-text); }
  .tile.active::before {
    content: ''; position: absolute; left: -8px; top: 8px; bottom: 8px; width: 3px; background: var(--text);
  }
  .tile.dragged { opacity: 0.4; }
  .icon { width: 100%; height: 100%; object-fit: cover; display: block; pointer-events: none; }
  .tile.connecting::after {
    content: ''; position: absolute; right: -2px; bottom: -2px; width: 9px; height: 9px;
    background: var(--text-faint); border: 2px solid var(--bg-0);
  }
  .unread {
    position: absolute; right: -5px; top: -5px; min-width: 18px; padding: 0 3px; line-height: 14px; text-align: center;
    font-size: 10px; font-weight: 700; letter-spacing: 0; background: var(--danger); color: #fff; border: 2px solid var(--bg-0);
  }
  .drop-line { width: 36px; height: 3px; flex: none; background: var(--accent); margin: -5px 0; }
  .add { color: var(--speaking); background: var(--bg-2); }
  .add:hover { background: var(--speaking); color: var(--bg-0); }
  .ghost { background: transparent; color: var(--text-dim); }
  .ghost:hover { background: var(--bg-3); color: var(--text); }
  .tile.ghost.active:hover { background: var(--accent); color: var(--accent-text); }
  .spacer { flex: 1; }
</style>
