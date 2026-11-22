<script lang="ts">
  import Background from './Background.svelte';
  import { store, type BackgroundDesign, type BackgroundFit } from '../lib/settings.svelte.ts';
  import { backgroundImage, BACKGROUND_TYPES } from '../lib/background.svelte.ts';

  const designs: { id: BackgroundDesign; name: string }[] = [
    { id: 'none', name: 'None' }, { id: 'image', name: 'Image' },
    { id: 'gradient', name: 'Gradient' }, { id: 'grid', name: 'Grid' }, { id: 'dots', name: 'Dots' }
  ];
  let fileInput: HTMLInputElement;

  async function upload(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file && await backgroundImage.import(file)) {
      store.settings.backgroundDesign = 'image';
      store.saveSettings();
    }
  }

  async function remove() {
    if (await backgroundImage.remove() && store.settings.backgroundDesign === 'image') {
      store.settings.backgroundDesign = 'none';
      store.saveSettings();
    }
  }
</script>

<h3>Background</h3>
<p class="help">For chat, the start screen and Rooms. Images stay on this device.</p>
<div class="designs" role="group" aria-label="Background design">
  {#each designs as design (design.id)}
    <button class="btn" class:primary={store.settings.backgroundDesign === design.id}
      aria-pressed={store.settings.backgroundDesign === design.id}
      onclick={() => { store.settings.backgroundDesign = design.id; store.saveSettings(); }}>{design.name}</button>
  {/each}
</div>

{#if store.settings.backgroundDesign === 'image' || backgroundImage.url}
  <div class="image-controls">
    <input class="file-input" type="file" accept={BACKGROUND_TYPES} aria-label="Background image" bind:this={fileInput} onchange={upload} disabled={backgroundImage.busy} />
    <button class="btn" disabled={backgroundImage.busy} onclick={() => fileInput.click()}>{backgroundImage.busy ? 'Loading image...' : backgroundImage.url ? 'Change image' : 'Choose image'}</button>
    {#if backgroundImage.url}<button class="btn" disabled={backgroundImage.busy} onclick={remove}>Remove image</button>{/if}
    {#if backgroundImage.name}<span class="filename">{backgroundImage.name}</span>{/if}
  </div>
  {#if store.settings.backgroundDesign === 'image'}
    <p class="help">PNG, JPEG, WebP, GIF or AVIF, up to 20 MB.</p>
    <label for="background-fit">Image fit</label>
    <select id="background-fit" value={store.settings.backgroundFit}
      onchange={e => { store.settings.backgroundFit = e.currentTarget.value as BackgroundFit; store.saveSettings(); }}>
      <option value="cover">Fill</option><option value="contain">Fit</option><option value="tile">Tile</option>
    </select>
  {/if}
{/if}
{#if backgroundImage.error}<p class="error" role="alert">{backgroundImage.error}</p>{/if}

{#if store.settings.backgroundDesign !== 'none'}
  {#if store.settings.backgroundDesign !== 'image'}
    <label for="background-color">Design color</label>
    <input id="background-color" type="color" value={store.settings.backgroundColor}
      oninput={e => { store.settings.backgroundColor = e.currentTarget.value; store.saveSettings(); }} />
  {/if}
  <label for="background-strength">Background strength <span>{store.settings.backgroundStrength}%</span></label>
  <input id="background-strength" type="range" min="0" max="60" step="5" value={store.settings.backgroundStrength}
    oninput={e => { store.settings.backgroundStrength = Number(e.currentTarget.value); store.saveSettings(); }} />
  <div class="preview" data-background role="img" aria-label="Background preview">
    <Background />
    <strong>Your background</strong><span>Lower the strength for clearer text.</span>
  </div>
{/if}

<style>
  h3 { margin: 22px 0 0; font-size: 15px; font-weight: 650; }
  .help { margin: 6px 0 0; font-size: 13px; color: var(--text-dim); }
  .designs, .image-controls { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; align-items: center; }
  .file-input { display: none; }
  .filename { font-size: 13px; color: var(--text-dim); overflow-wrap: anywhere; min-width: 0; }
  label, select, input[type="range"] { max-width: 320px; }
  label span { float: right; color: var(--text-dim); }
  input[type="color"] { width: 64px; padding: 4px; }
  .preview { display: flex; flex-direction: column; justify-content: center; min-height: 120px; margin-top: 10px; padding: 20px; border: 1px solid var(--line); background: var(--bg-2); }
  .preview span { color: var(--text-dim); font-size: 13px; margin-top: 4px; }
</style>
