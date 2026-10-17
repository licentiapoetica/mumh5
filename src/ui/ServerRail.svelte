<script lang="ts">
  import Icon from './Icon.svelte';
  import { store, type SavedServer } from '../lib/settings.svelte.ts';
  import { sessions } from '../lib/session.svelte.ts';
  import { menu } from '../lib/menu.svelte.ts';
  import { desktop } from '../lib/native.ts';
  import { makeServerIcon } from '../lib/images.ts';

  let { onadd, onedit, onsettings, onbrowse }:
    { onadd: () => void; onedit: (s: SavedServer) => void; onsettings: () => void; onbrowse: () => void } = $props();

  const initials = (label: string) =>
    label.split(/[\s._-]+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';

  const stateOf = (id: string) => sessions.byServer(id)?.status ?? 'idle';
  const unreadOf = (id: string) => {
    const s = sessions.byServer(id);
    return s && sessions.activeId !== id ? Object.values(s.unread).reduce((a, b) => a + b, 0) : 0;
  };

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

  // Icon picked from the tile's context menu
  let iconPicker: HTMLInputElement;
  let iconFor = '';
  async function pickIcon() {
    const file = iconPicker.files?.[0];
    iconPicker.value = '';
    if (file && iconFor) store.setServerIcon(iconFor, await makeServerIcon(file).catch(() => undefined));
  }

  function serverMenu(e: MouseEvent, s: SavedServer, i: number) {
    const state = stateOf(s.id);
    menu.show(e, [
      { header: true, label: s.label },
      state === 'idle'
        ? { label: 'Connect', action: () => sessions.open(s) }
        : { label: 'Disconnect', action: () => sessions.close(s.id) },
      ...(state === 'connected' && sessions.voiceId !== s.id ? [{ label: 'Talk here', action: () => { sessions.select(s.id); sessions.setVoice(sessions.byServer(s.id)!); } }] : []),
      { separator: true, label: '' },
      { label: 'Move up', disabled: i === 0, action: () => store.moveServer(s.id, i - 1) },
      { label: 'Move down', disabled: i === store.servers.length - 1, action: () => store.moveServer(s.id, i + 1) },
      { separator: true, label: '' },
      { label: 'Change icon...', action: () => { iconFor = s.id; iconPicker.click(); } },
      ...(s.icon ? [{ label: 'Remove icon', action: () => store.setServerIcon(s.id, undefined) }] : []),
      { label: 'Edit...', action: () => onedit(s) }
    ]);
  }
</script>

<nav class="rail" aria-label="Servers" ondrop={onDrop} ondragover={e => { if (dragging) e.preventDefault(); }}>
  {#each store.servers as s, i (s.id)}
    {@const state = stateOf(s.id)}
    {@const unread = unreadOf(s.id)}
    {#if dropIndex === i && dragging}<div class="drop-line"></div>{/if}
    <button class="tile" class:active={sessions.activeId === s.id} class:live={state === 'connected'}
      class:connecting={state === 'connecting'} class:voice={sessions.voiceId === s.id && state === 'connected'}
      class:dragged={dragging === s.id}
      title="{s.label} ({s.host}){state === 'connected' ? (sessions.voiceId === s.id ? ', voice' : ', connected') : ''}"
      draggable="true"
      ondragstart={e => { dragging = s.id; e.dataTransfer?.setData('text/plain', s.id); if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'; }}
      ondragend={() => { dragging = null; dropIndex = null; }}
      ondragover={e => onDragOver(e, i)}
      onclick={() => sessions.open(s)}
      oncontextmenu={e => serverMenu(e, s, i)}>
      {#if s.icon}<img class="icon" src={s.icon} alt="" draggable="false" />{:else}{initials(s.label)}{/if}
      {#if unread}<span class="unread">{unread > 99 ? '99+' : unread}</span>{/if}
    </button>
  {/each}
  {#if dropIndex === store.servers.length && dragging}<div class="drop-line"></div>{/if}
  <input bind:this={iconPicker} type="file" accept="image/*" hidden onchange={pickIcon} />
  <button class="tile add" title="Add a server" onclick={onadd}><Icon name="plus" /></button>
  <!-- The public list and its pings need the desktop app -->
  {#if desktop}<button class="tile add" title="Browse public servers" onclick={onbrowse}><Icon name="globe" /></button>{/if}
  <div class="spacer"></div>
  <button class="tile ghost" title="Settings" onclick={onsettings}><Icon name="settings" /></button>
</nav>

<style>
  /* The server you are talking on leads the list, wherever it sits in your own order */
  .tile.voice { order: -1; }
  .rail {
    width: 68px; flex: none; background: var(--bg-0); display: flex; flex-direction: column;
    align-items: center; gap: 8px; padding: 12px 0; overflow-y: auto;
  }
  .tile {
    position: relative; width: 44px; height: 44px; flex: none; display: flex; align-items: center; justify-content: center;
    background: var(--bg-3); font-weight: 700; font-size: 15px; transition: background 100ms, color 100ms;
  }
  .tile:hover { background: var(--accent); color: var(--accent-text); }
  .tile.active { background: var(--accent); color: var(--accent-text); }
  .tile.active::before {
    content: ''; position: absolute; left: -12px; top: 8px; bottom: 8px; width: 4px; background: var(--text);
  }
  .tile.dragged { opacity: 0.4; }
  .icon { width: 100%; height: 100%; object-fit: cover; display: block; pointer-events: none; }
  /* Connection state: grey dot connecting, green connected, green with ring where voice runs */
  .tile.live::after, .tile.connecting::after {
    content: ''; position: absolute; right: -3px; bottom: -3px; width: 10px; height: 10px;
    background: var(--speaking); border: 2px solid var(--bg-0);
  }
  .tile.connecting::after { background: var(--text-faint); }
  .tile.voice::after { box-shadow: 0 0 0 2px var(--speaking); }
  .unread {
    position: absolute; right: -6px; top: -6px; min-width: 18px; padding: 0 4px; line-height: 16px;
    font-size: 10px; background: var(--danger); color: #fff; border: 2px solid var(--bg-0);
  }
  .drop-line { width: 44px; height: 3px; flex: none; background: var(--accent); margin: -5px 0; }
  .add { color: var(--speaking); background: var(--bg-2); }
  .add:hover { background: var(--speaking); color: var(--bg-0); }
  .ghost { background: transparent; color: var(--text-dim); }
  .ghost:hover { background: var(--bg-3); color: var(--text); }
  .spacer { flex: 1; }
</style>
