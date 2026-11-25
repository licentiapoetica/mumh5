<script lang="ts">
  import { comboFromEvent, comboLabel, keyName, type HotkeyAction } from '../core/hotkeys.ts';
  import { hotkeys } from '../lib/hotkeys.svelte.ts';
  import { voice } from '../lib/audio/voice.svelte.ts';
  import { store } from '../lib/settings.svelte.ts';

  type Row = 'ptt' | HotkeyAction;
  let recording = $state<Row | null>(null);

  const rows: { id: Row; label: string; help: string }[] = [
    { id: 'ptt', label: 'Push to talk', help: 'Hold to talk. Used when the transmit mode under Voice is Push to talk.' },
    { id: 'mute', label: 'Mute or unmute', help: '' },
    { id: 'deafen', label: 'Deafen or undeafen', help: '' }
  ];
  const current = (id: Row) => id === 'ptt' ? (voice.settings.pttKey ?? '') : hotkeys.combo(id);
  const label = (id: Row) => { const c = current(id); return !c ? 'Not set' : id === 'ptt' ? keyName(c) : comboLabel(c); };

  function record(id: Row) { recording = id; hotkeys.capturing = true; }
  function stop() { recording = null; hotkeys.capturing = false; }
  function clear(id: Row) {
    if (id === 'ptt') voice.update({ pttKey: '' });
    else hotkeys.set(id, '');
  }

  function onKey(e: KeyboardEvent) {
    if (!recording) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.code === 'Escape') return stop();
    // Push to talk is one key, held; the others may have Ctrl, Alt, Shift or Super
    const combo = recording === 'ptt' ? (comboFromEvent({ ...e, code: e.code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false }) ?? null) : comboFromEvent(e);
    if (!combo) return; // a modifier on its own: wait for the key
    if (recording === 'ptt') voice.update({ pttKey: combo });
    else hotkeys.set(recording, combo);
    stop();
  }

  // The window Settings is in, which is not always the app's
  function keysHere(node: HTMLElement) {
    const view = node.ownerDocument.defaultView ?? window;
    const key = onKey as EventListener;
    view.addEventListener('keydown', key, true);
    return { destroy: () => { view.removeEventListener('keydown', key, true); stop(); } };
  }

  const g = $derived(hotkeys.global);
  const names: Record<string, string> = { ptt: 'Push to talk', mute: 'Mute', deafen: 'Deafen' };
</script>

<div use:keysHere>
  {#each rows as row (row.id)}
    <label for="hk-{row.id}">{row.label}</label>
    <div class="row">
      <button id="hk-{row.id}" class="btn key" class:capturing={recording === row.id} onclick={() => (recording === row.id ? stop() : record(row.id))}>
        {recording === row.id ? 'Press the keys... (Esc cancels)' : label(row.id)}
      </button>
      {#if current(row.id)}<button class="btn" onclick={() => clear(row.id)}>Clear</button>{/if}
    </div>
    {#if row.help}<p class="help">{row.help}</p>{/if}
  {/each}
  <p class="help">While you type in a text field, single keys stay text; combinations with Ctrl, Alt or Super still work.</p>

  {#if hotkeys.available}
    <label class="check"><input type="checkbox" checked={store.settings.globalHotkeys}
      onchange={e => { store.settings.globalHotkeys = e.currentTarget.checked; store.saveSettings(); }} /> Also while mumh5 is in the background</label>
    <p class="help">Works through the desktop's own shortcut service (KDE Plasma, GNOME 48 or newer), on Wayland and X11. The desktop may ask you to confirm the keys, and the keys it settles on are the ones that work; change them in the system settings.</p>
    {#if g.state === 'binding'}
      <p class="help" role="status">Waiting for the desktop...</p>
    {:else if g.state === 'on'}
      <p class="help" role="status">Active system-wide: {Object.entries(g.triggers).map(([id, trigger]) => `${names[id] ?? id} ${trigger || '(no key assigned)'}`).join(', ')}.</p>
    {:else if g.state === 'failed'}
      <p class="help error" role="status">Not available: {g.error}</p>
    {/if}
  {/if}
</div>

<style>
  .row { display: flex; gap: 8px; align-items: center; }
  .key { min-width: 220px; justify-content: flex-start; }
  .key.capturing { border-color: var(--accent); color: var(--accent); }
  .error { color: var(--danger); }
</style>
