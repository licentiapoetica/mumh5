<script lang="ts">
  import { store, THEMES, type ThemeId } from '../lib/settings.svelte.ts';

  function pick(id: ThemeId) {
    store.settings.theme = id;
    store.saveSettings();
  }
</script>

<h3>Color scheme</h3>
<div class="themes" role="radiogroup" aria-label="Color scheme">
  {#each THEMES as t (t.id)}
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

<style>
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
  .m-box { margin-top: auto; height: 10px; background: var(--bg-3); border: 1px solid var(--line); }
</style>
