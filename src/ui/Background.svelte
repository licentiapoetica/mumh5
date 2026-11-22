<script lang="ts">
  import { store } from '../lib/settings.svelte.ts';
  import { backgroundImage } from '../lib/background.svelte.ts';

  const design = $derived(store.settings.backgroundDesign);
  const image = $derived(design === 'image' ? backgroundImage.url : null);
  const strength = $derived(Math.max(0, Math.min(0.6, (Number(store.settings.backgroundStrength) || 0) / 100)));
  // Color inputs produce hex; validate persisted values before interpolating them into CSS.
  const color = $derived(/^#[\da-f]{6}$/i.test(store.settings.backgroundColor) ? store.settings.backgroundColor : '#5865f2');
  const paint = $derived(image ? `url("${image}")` : design === 'gradient'
    ? `radial-gradient(ellipse at top left, ${color}, transparent 75%), radial-gradient(ellipse at bottom right, var(--accent), transparent 75%)`
    : design === 'grid' ? `linear-gradient(${color} 1px, transparent 1px), linear-gradient(90deg, ${color} 1px, transparent 1px)`
    : design === 'dots' ? `radial-gradient(${color} 1.5px, transparent 1.5px)` : null);
  const fit = $derived(store.settings.backgroundFit);
</script>

{#if paint}
  <div class="background-art" aria-hidden="true" data-design={design}
    style:background-image={paint} style:opacity={strength}
    style:background-size={image ? fit === 'tile' ? 'auto' : fit === 'contain' ? 'contain' : 'cover' : design === 'grid' ? '32px 32px' : design === 'dots' ? '20px 20px' : 'cover'}
    style:background-repeat={image && fit === 'tile' || design === 'grid' || design === 'dots' ? 'repeat' : 'no-repeat'}></div>
{/if}

<style>
  :global([data-background]) { position: relative; isolation: isolate; }
  .background-art { position: absolute; inset: 0; z-index: -1; pointer-events: none; background-position: center; }
</style>
