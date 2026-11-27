<script lang="ts">
  import Icon from './Icon.svelte';
  import { store, THEMES } from '../lib/settings.svelte.ts';
  import { studio } from '../lib/theme-studio.svelte.ts';
  import { themeWindow } from '../lib/theme-window.svelte.ts';
  import { themeVars, type CustomTheme } from '../lib/custom-themes.ts';
  import { ui } from '../lib/ui.svelte.ts';

  let picker = $state<HTMLInputElement>();
  // The built-in scheme in use, which can be changed in place
  const scheme = $derived(THEMES.find(t => t.id === store.settings.theme) ?? null);

  // Read before starting: starting closes a Settings dialog, and with it this button
  function openCreator(e: MouseEvent, start: () => void) {
    const from = (e.currentTarget as HTMLElement).ownerDocument.defaultView ?? window;
    start();
    themeWindow.show(from);
  }

  function use(t: CustomTheme) {
    store.settings.theme = t.id;
    store.saveSettings();
  }

  function askRemove(t: CustomTheme) {
    ui.prompt = {
      title: `Delete ${t.name}?`, label: '', confirm: 'Delete', danger: true, input: 'none',
      text: 'This removes the theme from this device.',
      onsubmit: () => studio.remove(t.id)
    };
  }

  function askReset(id: string, name: string) {
    ui.prompt = {
      title: `Reset ${name}?`, label: '', confirm: 'Reset', danger: true, input: 'none',
      text: 'Your changes to this color scheme are removed.',
      onsubmit: () => studio.resetScheme(id)
    };
  }

  async function imported() {
    const file = picker?.files?.[0];
    if (picker) picker.value = '';
    if (!file || await studio.importFile(file)) return;
    ui.prompt = {
      title: 'Could not import', label: '', confirm: 'OK', input: 'none',
      text: 'This file is not a mumh5 theme.',
      onsubmit: () => {}
    };
  }
</script>

<div class="bar">
  {#if studio.waiting}
    <span class="open">{studio.draft?.name} has unsaved changes.</span>
    <button class="btn primary" onclick={e => openCreator(e, () => studio.stepAside())}>Continue editing</button>
    <button class="btn" onclick={() => studio.dropWaiting()}>Discard</button>
  {:else if studio.draft}
    <span class="open">A theme is open in the creator.</span>
    <button class="btn primary" onclick={e => openCreator(e, () => studio.stepAside())}>Back to the creator</button>
  {:else}
    <button class="btn primary" onclick={e => openCreator(e, () => studio.create())}>Create theme</button>
    {#if scheme}
      {@const s = scheme}
      <button class="btn" title="Change the colors of this scheme" onclick={e => openCreator(e, () => studio.editScheme(s.id))}>Edit {s.name}</button>
      {#if studio.edits[s.id]}
        <button class="btn" title="Back to the colors it came with" onclick={() => askReset(s.id, s.name)}>Reset {s.name}</button>
      {/if}
    {/if}
    <button class="btn" title="Add a theme from a .json file" onclick={() => picker?.click()}>Import</button>
  {/if}
  <input bind:this={picker} type="file" accept=".json,application/json" aria-label="Import theme file" hidden onchange={imported} />
</div>

{#if studio.list.length}
  <span class="own-label" id="own-themes">Your themes</span>
  <div class="cards" role="radiogroup" aria-labelledby="own-themes">
    {#each studio.list as t (t.id)}
      {@const on = store.settings.theme === t.id}
      <div class="own" class:active={on}>
        <button class="pick" role="radio" aria-checked={on} aria-label={t.name} onclick={() => use(t)}>
          <span class="mini" style={themeVars(t.colors)} aria-hidden="true">
            <span class="m-rail"><span></span><span></span></span>
            <span class="m-side"><i></i><i class="sel"></i><i></i></span>
            <span class="m-chat"><span class="m-head"></span><i class="a"></i><i></i><i class="short"></i><span class="m-box"></span></span>
          </span>
          <span class="name">{t.name}</span>
        </button>
        <div class="tools">
          <button class="edit" disabled={!!studio.draft} aria-label="Edit {t.name}" onclick={e => openCreator(e, () => studio.edit(t.id))}>Edit</button>
          <button class="icon-btn" aria-label="Export {t.name}" title="Save as a file to share" onclick={e => studio.exportFile(t.id, e.currentTarget.ownerDocument)}><Icon name="download" size={15} /></button>
          <button class="icon-btn" disabled={!!studio.draft} aria-label="Delete {t.name}" title="Delete" onclick={() => askRemove(t)}><Icon name="trash" size={15} /></button>
        </div>
      </div>
    {/each}
  </div>
{/if}

<style>
  .bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 10px; }
  .open { font-size: 13px; color: var(--text-dim); }
  .own-label { display: block; margin: 16px 0 0; font-size: 13px; font-weight: 600; color: var(--text-dim); }
  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 10px; margin: 8px 0 6px; }
  .own { display: flex; flex-direction: column; min-width: 0; border: 1px solid var(--line); background: var(--bg-0); }
  .own.active { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
  .pick { display: flex; flex-direction: column; gap: 2px; padding: 8px 8px 2px; text-align: left; min-width: 0; }
  .name { margin-top: 6px; font-weight: 600; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .tools { display: flex; align-items: center; gap: 2px; padding: 0 4px 4px 8px; }
  .edit { flex: 1; text-align: left; font-size: 13px; color: var(--link); }
  .edit:disabled { color: var(--text-faint); }
  .tools .icon-btn { width: 28px; height: 28px; }
  .mini { display: flex; height: 84px; overflow: hidden; border: 1px solid var(--line); }
  .m-rail { width: 16%; background: var(--rail); display: flex; flex-direction: column; align-items: center; gap: 4px; padding-top: 5px; }
  .m-rail span { width: 60%; aspect-ratio: 1; background: var(--accent); }
  .m-rail span + span { background: var(--bg-3); }
  .m-side { width: 30%; background: var(--bg-1); display: flex; flex-direction: column; gap: 5px; padding: 8px 5px; }
  .m-side i { height: 5px; background: var(--text-faint); width: 70%; }
  .m-side i.sel { background: var(--accent); width: 85%; }
  .m-chat { flex: 1; background: var(--bg-2); display: flex; flex-direction: column; gap: 5px; padding: 0 6px 6px; }
  .m-head { height: 10px; margin: 0 -6px 2px; background: var(--bg-1); border-bottom: 1px solid var(--line); }
  .m-chat i { height: 4px; background: var(--text-dim); width: 80%; }
  .m-chat i.a { background: var(--accent); width: 35%; }
  .m-chat i.short { width: 55%; }
  .m-box { margin-top: auto; height: 10px; background: var(--bg-3); border: 1px solid var(--line); }
</style>
