<script lang="ts">
  import { store, THEMES, type ThemeId, type Arrangement } from '../lib/settings.svelte.ts';

  const ARRANGEMENTS: { id: Arrangement; name: string; note: string }[] = [
    { id: 'side', name: 'Modern', note: 'Channels left, members right' },
    { id: 'classic', name: 'Classic', note: 'Chat left, channels right, like Mumble' },
    { id: 'stacked', name: 'Stacked', note: 'Channels on top, chat below, like Mumble' }
  ];

  const INTERFACES: { id: 'standard' | 'rooms'; name: string; note: string }[] = [
    { id: 'standard', name: 'Standard', note: 'Channel tree, chat and members side by side' },
    { id: 'rooms', name: 'Rooms', note: 'One screen at a time, made for phones. New and not complete yet' }
  ];
  function choose(id: 'standard' | 'rooms') {
    store.settings.interface = id;
    store.saveSettings();
  }

  function arrange(id: Arrangement) {
    store.settings.arrangement = id;
    store.saveSettings();
  }

  // With this many schemes the list can be narrowed by name and by dark or light
  let find = $state('');
  let shade = $state<'all' | 'dark' | 'light'>('all');
  const shown = $derived(THEMES.filter(t => (shade === 'all' || (shade === 'light') === t.light)
    && (!find.trim() || `${t.name} ${t.note}`.toLowerCase().includes(find.trim().toLowerCase()))));

  function pick(id: ThemeId) {
    store.settings.theme = id;
    store.saveSettings();
  }
</script>

<h3>Color scheme</h3>
<div class="narrow">
  <input type="search" placeholder="Find a color scheme" aria-label="Find a color scheme" bind:value={find} />
  <div class="shades" role="group" aria-label="Show">
    {#each ['all', 'dark', 'light'] as const as k (k)}
      <button class:on={shade === k} aria-pressed={shade === k} onclick={() => (shade = k)}>{k === 'all' ? `All ${THEMES.length}` : k === 'dark' ? 'Dark' : 'Light'}</button>
    {/each}
  </div>
</div>
<div class="themes" role="radiogroup" aria-label="Color scheme">
  {#each shown as t (t.id)}
    <button role="radio" aria-checked={store.settings.theme === t.id} class:active={store.settings.theme === t.id}
      onclick={() => pick(t.id)} aria-label={t.name}>
      <!-- A miniature of the app in that theme -->
      <span class="mini" data-theme-preview={t.id} aria-hidden="true">
        <span class="m-rail"><span></span><span></span></span>
        <span class="m-side"><i></i><i class="sel"></i><i></i></span>
        <span class="m-chat">
          <span class="m-head"></span>
          <i class="a"></i><i></i><i class="short"></i>
          <span class="m-box"></span>
        </span>
      </span>
      <span class="name">{t.name}</span>
      <span class="note">{t.note}</span>
    </button>
  {/each}
</div>
{#if !shown.length}<p class="nothing">No color scheme matches.</p>{/if}

<h3 class="gap">Interface</h3>
<div class="themes" role="radiogroup" aria-label="Interface">
  {#each INTERFACES as f (f.id)}
    {@const on = (store.settings.interface ?? 'standard') === f.id}
    <button role="radio" aria-checked={on} class:active={on} onclick={() => choose(f.id)} aria-label={f.name}>
      <span class="mini face {f.id}" aria-hidden="true">
        {#if f.id === 'standard'}
          <span class="m-rail"><span></span><span></span></span>
          <span class="m-side"><i></i><i class="sel"></i><i></i></span>
          <span class="m-chat"><span class="m-head"></span><i class="a"></i><i></i><span class="m-box"></span></span>
        {:else}
          <span class="m-col">
            <span class="m-chat"><span class="m-head"></span><i class="a"></i><i></i><i class="short"></i></span>
            <span class="m-tabs"><i class="sel"></i><i></i><i></i><i></i></span>
          </span>
        {/if}
      </span>
      <span class="name">{f.name}</span>
      <span class="note">{f.note}</span>
    </button>
  {/each}
</div>

{#if (store.settings.interface ?? 'standard') === 'standard'}
<h3 class="gap">Layout</h3>
<div class="themes" role="radiogroup" aria-label="Layout">
  {#each ARRANGEMENTS as a (a.id)}
    {@const on = (store.settings.arrangement ?? 'side') === a.id}
    <button role="radio" aria-checked={on} class:active={on} onclick={() => arrange(a.id)} aria-label={a.name}>
      <span class="mini lay {a.id}" aria-hidden="true">
        <span class="m-rail"><span></span><span></span></span>
        {#if a.id === 'side'}<span class="m-side"><i></i><i class="sel"></i><i></i></span>{/if}
        {#if a.id === 'stacked'}
          <span class="m-col">
            <span class="m-side"><i></i><i class="sel"></i></span>
            <span class="m-chat"><span class="m-head"></span><i class="a"></i><i></i><span class="m-box"></span></span>
          </span>
        {:else}
          <span class="m-chat"><span class="m-head"></span><i class="a"></i><i></i><i class="short"></i><span class="m-box"></span></span>
        {/if}
        {#if a.id === 'classic'}<span class="m-side"><i></i><i class="sel"></i><i></i></span>{/if}
        {#if a.id === 'side'}<span class="m-members"><i></i><i></i></span>{/if}
      </span>
      <span class="name">{a.name}</span>
      <span class="note">{a.note}</span>
    </button>
  {/each}
</div>
<p class="help">Narrow windows use the phone layout, except Stacked, which stays as it is.</p>
{/if}

<style>
  .gap { margin-top: 22px; }
  .narrow { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
  .narrow input { flex: 1 1 180px; width: auto; }
  .shades { display: flex; border: 1px solid var(--line); }
  .shades button { padding: 0 14px; font-size: 14px; color: var(--text-dim); }
  .shades button.on { background: var(--accent); color: var(--accent-text); }
  .nothing { margin: 10px 0 0; font-size: 14px; color: var(--text-dim); }
  .help { margin: 6px 0 0; font-size: 13px; color: var(--text-dim); }
  .m-col { flex: 1; display: flex; flex-direction: column; min-width: 0; }
  .m-col .m-chat { flex: 1; }
  .m-col .m-side { width: auto; height: 34%; flex: none; padding: 5px; gap: 4px; border-bottom: 1px solid var(--line); }
  .m-members { width: 18%; background: var(--bg-1); display: flex; flex-direction: column; gap: 5px; padding: 8px 4px; border-left: 1px solid var(--line); }
  .m-members i { height: 4px; background: var(--text-faint); width: 80%; }
  .lay.classic .m-side { border-left: 1px solid var(--line); }
  h3 { margin: 8px 0 0; font-size: 14px; }
  .themes { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 10px; margin-top: 10px; }
  .themes > button { display: flex; flex-direction: column; gap: 2px; padding: 8px; text-align: left; border: 1px solid var(--line); background: var(--bg-0); }
  .themes > button.active { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
  .name { font-weight: 600; margin-top: 6px; }
  .note { font-size: 12px; color: var(--text-dim); }
  .mini { display: flex; height: 84px; overflow: hidden; border: 1px solid var(--line); font-family: var(--font); }
  .m-rail { width: 16%; background: var(--rail, var(--bg-0)); display: flex; flex-direction: column; align-items: center; gap: 4px; padding-top: 5px; }
  .m-rail span { width: 60%; aspect-ratio: 1; background: var(--accent); }
  .m-rail span + span { background: var(--bg-3); }
  .m-side { width: 30%; background: var(--bg-1); display: flex; flex-direction: column; gap: 5px; padding: 8px 5px; }
  .m-side i { height: 5px; background: var(--text-faint); width: 70%; }
  .m-side i.sel { background: var(--accent); width: 85%; }
  .m-chat { flex: 1; background: var(--bg-2); display: flex; flex-direction: column; gap: 5px; padding: 0 6px 6px; }
  .m-head { height: 10px; margin: 0 -6px 2px; background: var(--bg-1); border-bottom: 1px solid var(--line); }
  [data-theme-preview="win95"] .m-head { background: linear-gradient(90deg, #000080, #1084d0); }
  .m-chat i { height: 4px; background: var(--text-dim); width: 80%; }
  .m-chat i.a { background: var(--accent); width: 35%; }
  .m-chat i.short { width: 55%; }
  .face.rooms .m-col { flex: 1; display: flex; flex-direction: column; }
  .m-tabs { flex: none; height: 12px; display: flex; gap: 6px; align-items: center; justify-content: center; background: var(--bg-0); border-top: 1px solid var(--line); }
  .m-tabs i { width: 10px; height: 4px; background: var(--text-faint); }
  .m-tabs i.sel { background: var(--accent); }
  .m-box { margin-top: auto; height: 10px; background: var(--bg-3); border: 1px solid var(--line); }
</style>
