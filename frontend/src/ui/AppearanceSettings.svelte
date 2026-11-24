<script lang="ts">
  import BackgroundSettings from './BackgroundSettings.svelte';
  import CornerSettings from './CornerSettings.svelte';
  import SectionHead from './SectionHead.svelte';
  import ThemeLibrary from './ThemeLibrary.svelte';
  import { store, THEMES, type ThemeId, type Arrangement } from '../lib/settings.svelte.ts';

  const TAB_BARS = [
    { id: 'none', name: 'Plain' }, { id: 'tree', name: 'Same as channel list' }, { id: 'chat', name: 'Same as chat' }
  ] as const;
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

  const classicLeft = $derived(store.settings.classicSide === 'left');
  function placeList(side: 'left' | 'right') {
    store.settings.classicSide = side;
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

<SectionHead first title="Role icons" part="appearance.roles" />
<div class="role-opts">
  <label for="role-icons">Show next to names</label>
  <select id="role-icons" value={store.settings.roleIcons ?? 'all'}
    onchange={e => { store.settings.roleIcons = e.currentTarget.value as 'all' | 'top' | 'off'; store.saveSettings(); }}>
    <option value="all">All roles</option>
    <option value="top">Top role only</option>
    <option value="off">Off</option>
  </select>
  <label class="role-check"><input type="checkbox" checked={store.settings.roleColors !== false}
    onchange={e => { store.settings.roleColors = e.currentTarget.checked; store.saveSettings(); }} /> Color names by top role</label>
</div>

<SectionHead title="People" part="appearance.people" />
<div class="role-opts">
  <label for="avatars">Show people as</label>
  <select id="avatars" value={store.settings.avatars}
    onchange={e => { store.settings.avatars = e.currentTarget.value as 'pictures' | 'spheres'; store.saveSettings(); }}>
    <option value="pictures">Pictures</option>
    <option value="spheres">Spheres</option>
  </select>
</div>
<p class="help">Chat, members, profiles and voice tiles keep the picture.</p>

<SectionHead title="Interface" part="appearance.interface" />
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
<SectionHead title="Layout" part="appearance.layout" />
<div class="themes" role="radiogroup" aria-label="Layout">
  {#each ARRANGEMENTS as a (a.id)}
    {@const on = (store.settings.arrangement ?? 'side') === a.id}
    <button role="radio" aria-checked={on} class:active={on} onclick={() => arrange(a.id)} aria-label={a.name}>
      <span class="mini lay {a.id}" class:flip={a.id === 'classic' && classicLeft} aria-hidden="true">
        <span class="m-rail"><span></span><span></span></span>
        {#if a.id === 'side' || (a.id === 'classic' && classicLeft)}<span class="m-side"><i></i><i class="sel"></i><i></i></span>{/if}
        {#if a.id === 'stacked'}
          <span class="m-col">
            <span class="m-side"><i></i><i class="sel"></i></span>
            <span class="m-chat"><span class="m-head"></span><i class="a"></i><i></i><span class="m-box"></span></span>
          </span>
        {:else}
          <span class="m-chat"><span class="m-head"></span><i class="a"></i><i></i><i class="short"></i><span class="m-box"></span></span>
        {/if}
        {#if a.id === 'classic' && !classicLeft}<span class="m-side"><i></i><i class="sel"></i><i></i></span>{/if}
        {#if a.id === 'side'}<span class="m-members"><i></i><i></i></span>{/if}
      </span>
      <span class="name">{a.name}</span>
      <span class="note">{a.id === 'classic' && classicLeft ? 'Channels left, chat right' : a.note}</span>
    </button>
  {/each}
</div>
{#if store.settings.arrangement === 'classic'}
  <span class="pick-label" id="classic-side">Channel list</span>
  <div class="shades pick" role="group" aria-labelledby="classic-side">
    {#each ['left', 'right'] as const as k (k)}
      <button class:on={store.settings.classicSide === k} aria-pressed={store.settings.classicSide === k} onclick={() => placeList(k)}>{k === 'left' ? 'Left' : 'Right'}</button>
    {/each}
  </div>
{/if}
<label class="role-check"><input type="checkbox" checked={store.settings.treeLines}
  onchange={e => { store.settings.treeLines = e.currentTarget.checked; store.saveSettings(); }} /> Show tree lines</label>
{#if store.settings.arrangement === 'stacked'}
  <span class="pick-label" id="tab-bar-bg">Tab bar background</span>
  <p class="help">The strip with the chat names above the messages. Backgrounds are set below.</p>
  <div class="shades pick" role="group" aria-labelledby="tab-bar-bg">
    {#each TAB_BARS as t (t.id)}
      <button class:on={store.settings.tabBarBackground === t.id} aria-pressed={store.settings.tabBarBackground === t.id}
        onclick={() => { store.settings.tabBarBackground = t.id; store.saveSettings(); }}>{t.name}</button>
    {/each}
  </div>
{/if}
<p class="help">Narrow windows use the phone layout, except Stacked, which stays as it is.</p>
{/if}

<BackgroundSettings />

<CornerSettings />

<SectionHead title="Color scheme" part="appearance.scheme" />
<ThemeLibrary />
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

<style>
  .role-opts { max-width: 280px; }
  .role-opts label:first-child { margin-top: 0; }
  .role-check { display: flex; align-items: center; gap: 8px; margin: 12px 0 0; font-size: 14px; font-weight: 400; color: var(--text); }
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
  .lay.classic:not(.flip) .m-side { border-left: 1px solid var(--line); }
  .pick-label { display: block; margin: 16px 0 6px; font-size: 13px; font-weight: 600; color: var(--text-dim); }
  .shades.pick { display: inline-flex; }
  .shades.pick button { min-width: 72px; min-height: var(--control-h); }
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
