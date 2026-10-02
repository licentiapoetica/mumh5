<script lang="ts">
  import Icon from '../ui/Icon.svelte';
  import RightPanel from '../ui/RightPanel.svelte';
  import Rooms from './Rooms.svelte';
  import ChatScreen from './ChatScreen.svelte';
  import VoiceScreen from './VoiceScreen.svelte';
  import People from './People.svelte';
  import You from './You.svelte';
  import Dock from './Dock.svelte';
  import { session } from '../lib/session.svelte.ts';
  import { ui } from '../lib/ui.svelte.ts';
  import type { SavedServer } from '../lib/settings.svelte.ts';

  // The Rooms interface: one screen at a time with a bar to move between them, made for
  // phones first. Wide windows keep the rooms on the left next to the chosen screen. Same
  // state, dialogs and menus as the standard interface; only the arrangement differs.
  let { onadd, onedit, onbrowse }: { onadd: () => void; onedit: (s: SavedServer) => void; onbrowse: () => void } = $props();

  type Screen = 'rooms' | 'chat' | 'voice' | 'people' | 'you';
  let width = $state(window.innerWidth);
  const wide = $derived(width >= 900);
  let chosen = $state<Screen>('rooms');
  // With the rooms always on the left, their place in the main area goes to the chat
  const screen = $derived(wide && chosen === 'rooms' ? 'chat' : chosen);

  const connected = $derived(session.status === 'connected');
  const unread = $derived(Object.values(session.unread).reduce((a, b) => a + b, 0));
  const inVoice = $derived(!!session.self);

  const ITEMS: { id: Screen; name: string; icon: string }[] = [
    { id: 'rooms', name: 'Rooms', icon: 'rooms' },
    { id: 'chat', name: 'Chat', icon: 'message' },
    { id: 'voice', name: 'Voice', icon: 'channel' },
    { id: 'people', name: 'People', icon: 'users' },
    { id: 'you', name: 'You', icon: 'user' }
  ];
  const items = $derived(wide ? ITEMS.filter(i => i.id !== 'rooms') : ITEMS);

  // A direct message or a text channel opened from a menu shows its chat. Joining a room
  // also changes the chat, but leaves you where you are.
  let lastView = session.view;
  $effect(() => {
    const view = session.view;
    if (view === lastView) return;
    lastView = view;
    if (view.startsWith('dm:') || session.isText(Number(view.slice(3)))) chosen = 'chat';
  });

  // Profiles and channel details open over the screen
  const sheet = $derived(ui.panelOpen && connected && session.panel.kind !== 'members');
  function closeSheet() {
    ui.panelOpen = false;
    session.closePanel();
  }
</script>

<svelte:window bind:innerWidth={width} onkeydown={e => { if (e.key === 'Escape' && sheet) closeSheet(); }} />

<div class="shell" class:wide>
  <nav class="bar" aria-label="Screens">
    {#each items as item (item.id)}
      <button class="item" class:active={screen === item.id} aria-current={screen === item.id ? 'page' : undefined} onclick={() => (chosen = item.id)}>
        <span class="glyph">
          <Icon name={item.icon} size={22} />
          {#if item.id === 'chat' && unread}<span class="count">{unread > 99 ? '99+' : unread}</span>{/if}
          {#if item.id === 'voice' && inVoice}<span class="on"></span>{/if}
        </span>
        <span class="cap">{item.name}</span>
      </button>
    {/each}
  </nav>

  {#if wide}
    <div class="side">
      <Rooms {onadd} {onedit} {onbrowse} onchat={() => (chosen = 'chat')} />
      <Dock onopen={() => (chosen = 'voice')} />
    </div>
  {/if}

  <main>
    <div class="screen">
      {#if screen === 'rooms'}<Rooms {onadd} {onedit} {onbrowse} onchat={() => (chosen = 'chat')} />
      {:else if screen === 'chat'}<ChatScreen back={!wide} onback={() => (chosen = 'rooms')} />
      {:else if screen === 'voice'}<VoiceScreen onrooms={() => (chosen = 'rooms')} onchat={() => (chosen = 'chat')} />
      {:else if screen === 'people'}<People onchat={() => (chosen = 'chat')} />
      {:else}<You {onadd} {onedit} {onbrowse} />{/if}
    </div>
    {#if !wide && screen !== 'voice'}<Dock onopen={() => (chosen = 'voice')} />{/if}
  </main>

  {#if sheet}
    <button class="scrim" aria-label="Close" onclick={closeSheet}></button>
    <div class="sheet"><RightPanel onnavigate={() => { closeSheet(); chosen = 'chat'; }} onclose={closeSheet} /></div>
  {/if}
</div>

<style>
  .shell { position: relative; height: 100%; display: flex; flex-direction: column; overflow: hidden; background: var(--bg-1); }
  main { flex: 1; min-height: 0; min-width: 0; display: flex; flex-direction: column; }
  .screen { flex: 1; min-height: 0; }

  /* Phones: the bar is at the bottom, under the thumb */
  .bar { order: 2; flex: none; display: flex; background: var(--bg-0); border-top: 1px solid var(--line); padding-bottom: env(safe-area-inset-bottom); }
  .item { flex: 1; min-width: 0; height: 56px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; color: var(--text-faint); box-shadow: inset 0 2px 0 transparent; }
  .item:hover { color: var(--text); }
  .item.active { color: var(--text); box-shadow: inset 0 2px 0 var(--accent); }
  .glyph { position: relative; display: flex; }
  .cap { font-size: 11px; font-weight: 600; }
  .count { position: absolute; top: -6px; left: 14px; min-width: 18px; padding: 0 4px; line-height: 16px; font-size: 10px; font-weight: 700; text-align: center; background: var(--danger); color: #fff; }
  .on { position: absolute; top: -2px; right: -4px; width: 8px; height: 8px; background: var(--speaking); }

  /* Wide windows: the bar on the left edge, the rooms next to it, the screen takes the rest */
  .shell.wide { flex-direction: row; }
  .wide .bar { order: 0; flex-direction: column; width: 76px; border-top: 0; border-right: 1px solid var(--line); padding: 8px 0; }
  .wide .item { flex: none; height: 64px; box-shadow: inset 2px 0 0 transparent; }
  .wide .item.active { box-shadow: inset 2px 0 0 var(--accent); }
  .side { flex: none; width: 360px; min-height: 0; display: flex; flex-direction: column; border-right: 1px solid var(--line); }
  .side > :global(.rooms) { flex: 1; }

  .scrim { position: absolute; inset: 0; z-index: 15; background: rgb(0 0 0 / 0.55); }
  .sheet { position: absolute; z-index: 20; left: 0; right: 0; bottom: 0; height: min(86%, 720px); display: flex; box-shadow: 0 -8px 32px rgb(0 0 0 / 0.4); border-top: 1px solid var(--line); }
  .sheet :global(.panel) { width: 100% !important; border-left: 0; }
  .sheet :global(.panel > .resize) { display: none; }
  .wide .sheet { left: auto; top: 0; height: auto; width: 400px; border-top: 0; box-shadow: -8px 0 32px rgb(0 0 0 / 0.4); }
</style>
