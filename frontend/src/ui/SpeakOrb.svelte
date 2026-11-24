<script lang="ts">
  import { LAMP, lampStops } from '../lib/lamp.ts';
  import { orbLook } from '../lib/custom-themes.ts';
  import { studio } from '../lib/theme-studio.svelte.ts';

  // The speaking indicator, as the theme shows it. box: the room it has, in px
  let { speaking = false, box }: { speaking?: boolean; box: number } = $props();

  const look = $derived(orbLook(studio.shown?.indicator, speaking));
  const px = $derived(Math.round(box * look.size / 100));
  const glass = $props.id();
  // Colors stay CSS so a theme change needs no redraw
  const stops = $derived(lampStops(speaking).map(([other, amount]) => `color-mix(in srgb, ${look.color}, ${other} ${amount * 100}%)`));
</script>

{#if look.shape !== 'none'}
  <svg class="ball" viewBox="0 0 64 64" width={px} height={px} aria-hidden="true" data-shape={look.shape}
    style:filter={look.glow ? `drop-shadow(0 0 ${look.glow}px ${look.color})` : undefined}>
    {#if look.shape === 'sphere'}
      <radialGradient id={glass} gradientUnits="userSpaceOnUse" fx={LAMP.fx} fy={LAMP.fy} fr={LAMP.fr} cx={LAMP.cx} cy={LAMP.cy} r={LAMP.r}>
        <stop offset="0" style:stop-color={stops[0]} />
        <stop offset="1" style:stop-color={stops[1]} />
      </radialGradient>
      <circle cx={LAMP.cx} cy={LAMP.cy} r={LAMP.radius} fill="url(#{glass})" />
      {#if look.border}
        <circle cx={LAMP.cx} cy={LAMP.cy} r={LAMP.rimRadius} fill="none" stroke={look.color} stroke-width={LAMP.rimWidth} stroke-opacity={LAMP.rimOpacity} />
      {/if}
    {:else if look.shape === 'dot'}
      <circle cx={LAMP.cx} cy={LAMP.cy} r={LAMP.radius} fill={look.color} />
    {:else if look.shape === 'ring'}
      <circle cx={LAMP.cx} cy={LAMP.cy} r="26" fill="none" stroke={look.color} stroke-width="8" />
    {:else}
      <rect x="5" y="5" width="54" height="54" fill={look.color} />
    {/if}
  </svg>
{/if}

<style>
  .ball { display: block; overflow: visible; }
</style>
