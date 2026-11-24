<script lang="ts">
  import SectionHead from './SectionHead.svelte';
  import { store } from '../lib/settings.svelte.ts';
  import { CORNER_PARTS, CORNER_PRESETS, cornerPreset, cornerValue, withCorner, type CornerPart } from '../lib/corners.ts';

  function set(id: CornerPart, value: number) {
    store.settings.corners = withCorner($state.snapshot(store.settings.corners), id, value);
    store.saveSettings();
  }

  function preset(px: number) {
    store.settings.corners = cornerPreset(px);
    store.saveSettings();
  }

  const isPreset = (px: number) => {
    const wanted = cornerPreset(px);
    return CORNER_PARTS.every(p => cornerValue(store.settings.corners, p) === (wanted[p.id] ?? 0));
  };
</script>

<SectionHead title="Rounded corners" part="appearance.corners" />
<span class="pick-label" id="corners-all">All elements</span>
<div class="shades" role="group" aria-labelledby="corners-all">
  {#each CORNER_PRESETS as p (p.name)}
    <button class:on={isPreset(p.px)} aria-pressed={isPreset(p.px)} onclick={() => preset(p.px)}>{p.name}</button>
  {/each}
</div>
<div class="parts">
  {#each CORNER_PARTS as p (p.id)}
    {@const value = cornerValue(store.settings.corners, p)}
    <div class="part">
      <label for="corner-{p.id}">{p.name}</label>
      <output for="corner-{p.id}">{value ? `${value}${p.unit}` : 'Off'}</output>
      <input id="corner-{p.id}" type="range" min="0" max={p.max} step="1" {value}
        aria-valuetext={value ? `${value}${p.unit}` : 'Off'}
        oninput={e => set(p.id, e.currentTarget.valueAsNumber)} />
      <span class="note">{p.note}</span>
    </div>
  {/each}
</div>

<style>
  .pick-label { display: block; margin: 12px 0 6px; font-size: 13px; font-weight: 600; color: var(--text-dim); }
  .shades { display: flex; flex-wrap: wrap; width: fit-content; max-width: 100%; border: 1px solid var(--line); }
  /* Grow, so a wrapped row fills the width on phones */
  .shades button { flex: 1 1 auto; min-width: 64px; min-height: var(--control-h); padding: 0 12px; font-size: 14px; color: var(--text-dim); }
  .shades button:hover { background: var(--bg-hover); color: var(--text); }
  .shades button.on { background: var(--accent); color: var(--accent-text); }
  .parts { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(230px, 100%), 1fr)); gap: 14px 20px; margin-top: 14px; }
  .part { display: grid; grid-template-columns: 1fr auto; align-items: baseline; column-gap: 8px; min-width: 0; }
  .part label { margin: 0; font-size: 13px; font-weight: 600; color: var(--text); }
  output { font-size: 12px; color: var(--text-dim); font-variant-numeric: tabular-nums; }
  .part input { grid-column: 1 / -1; margin: 4px 0 2px; }
  .note { grid-column: 1 / -1; font-size: 12px; color: var(--text-dim); }
</style>
