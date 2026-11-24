<script lang="ts">
  import Background from './Background.svelte';
  import PickColor from './PickColor.svelte';
  import type { BackgroundDesign, BackgroundFit } from '../lib/settings.svelte.ts';
  import {
    BACKGROUND_TYPES, MARK_RANGE, SPACING_RANGE, editedBackground, patternSize, setBackgroundStyle, type BackgroundArea
  } from '../lib/background.svelte.ts';

  // name: prefix for labels of a second editor ('' keeps the chat's labels as they were)
  let { area, name = '' }: { area: BackgroundArea; name?: string } = $props();

  const designs: { id: BackgroundDesign; name: string }[] = [
    { id: 'none', name: 'None' }, { id: 'image', name: 'Image' },
    { id: 'gradient', name: 'Gradient' }, { id: 'grid', name: 'Grid' }, { id: 'dots', name: 'Dots' }
  ];
  const edited = $derived(editedBackground(area));
  const style = $derived(edited.style);
  const image = $derived(edited.image);
  const pattern = $derived(style.design === 'grid' || style.design === 'dots');
  const size = $derived(patternSize(style));
  const id = (s: string) => (area === 'main' ? `background-${s}` : `${area}-background-${s}`);
  const label = (s: string) => (name ? `${name} ${s.toLowerCase()}` : s);
  let fileInput = $state<HTMLInputElement>();

  // A new design starts from its own pattern size
  const pick = (design: BackgroundDesign) => setBackgroundStyle(area, design === style.design ? { design } : { design, mark: null, spacing: null });

  async function upload(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file && await image.import(file)) setBackgroundStyle(area, { design: 'image' });
  }

  async function remove() {
    if (await image.remove() && style.design === 'image') setBackgroundStyle(area, { design: 'none' });
  }
</script>

<div class="designs" role="group" aria-label={label('Background design')}>
  {#each designs as design (design.id)}
    <button class="btn" class:primary={style.design === design.id} aria-pressed={style.design === design.id}
      onclick={() => pick(design.id)}>{design.name}</button>
  {/each}
</div>

{#if style.design === 'image' || image.url}
  <div class="image-controls">
    <input class="file-input" type="file" accept={BACKGROUND_TYPES} aria-label={label('Background image')} bind:this={fileInput} onchange={upload} disabled={image.busy} />
    <button class="btn" disabled={image.busy} onclick={() => fileInput?.click()}>{image.busy ? 'Loading image...' : image.url ? 'Change image' : 'Choose image'}</button>
    {#if image.url}<button class="btn" disabled={image.busy} onclick={remove}>Remove image</button>{/if}
    {#if image.name}<span class="filename">{image.name}</span>{/if}
  </div>
  {#if style.design === 'image'}
    <p class="help">PNG, JPEG, WebP, GIF or AVIF, up to 20 MB.</p>
    <label for={id('fit')}>Image fit</label>
    <select id={id('fit')} value={style.fit}
      onchange={e => setBackgroundStyle(area, { fit: e.currentTarget.value as BackgroundFit })}>
      <option value="cover">Fill</option><option value="contain">Fit</option><option value="tile">Tile</option>
    </select>
  {/if}
{/if}
{#if image.error}<p class="error" role="alert">{image.error}</p>{/if}

{#if style.design !== 'none'}
  {#if style.design !== 'image'}
    <label for={id('color')}>{label('Design color')}</label>
    <div class="color-row">
      <input id={id('color')} type="color" value={style.color}
        oninput={e => setBackgroundStyle(area, { color: e.currentTarget.value })} />
      <PickColor label="Pick the design color from the screen" onpick={color => setBackgroundStyle(area, { color })} />
    </div>
  {/if}
  {#if pattern}
    <label for={id('mark')}>{style.design === 'dots' ? 'Dot size' : 'Line width'} <span>{size.mark} px</span></label>
    <input id={id('mark')} type="range" min={MARK_RANGE[0]} max={MARK_RANGE[1]} step="0.5" value={size.mark}
      oninput={e => setBackgroundStyle(area, { mark: Number(e.currentTarget.value) })} />
    <label for={id('spacing')}>Spacing <span>{size.spacing} px</span></label>
    <input id={id('spacing')} type="range" min={SPACING_RANGE[0]} max={SPACING_RANGE[1]} step="2" value={size.spacing}
      oninput={e => setBackgroundStyle(area, { spacing: Number(e.currentTarget.value) })} />
  {/if}
  <label for={id('strength')}>{label('Background strength')} <span>{style.strength}%</span></label>
  <input id={id('strength')} type="range" min="0" max="60" step="5" value={style.strength}
    oninput={e => setBackgroundStyle(area, { strength: Number(e.currentTarget.value) })} />
  <div class="preview" data-background role="img" aria-label={label('Background preview')}>
    <Background {area} source={edited} />
    <strong>{name || 'Your background'}</strong><span>Lower the strength for clearer text.</span>
  </div>
{/if}

<style>
  .help { margin: 6px 0 0; font-size: 13px; color: var(--text-dim); }
  .designs, .image-controls { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; align-items: center; }
  .file-input { display: none; }
  .filename { font-size: 13px; color: var(--text-dim); overflow-wrap: anywhere; min-width: 0; }
  label, select, input[type="range"] { max-width: 320px; }
  label span { float: right; color: var(--text-dim); }
  input[type="color"] { width: 64px; padding: 4px; }
  .color-row { display: flex; align-items: center; gap: 8px; }
  .preview { display: flex; flex-direction: column; justify-content: center; min-height: 120px; margin-top: 10px; padding: 20px; border: 1px solid var(--line); background: var(--bg-2); }
  .preview span { color: var(--text-dim); font-size: 13px; margin-top: 4px; }
</style>
