<script lang="ts">
  import { store } from '../lib/settings.svelte.ts';
  import { LAMP, lampStops } from '../lib/lamp.ts';

  // src: the person's picture (an object URL); the letter shows without one or when it cannot be decoded
  // keep: the picture is the point here (chat, members, profiles, voice tiles), so the sphere setting does not replace it
  let { name, size = 32, speaking = false, src = null, keep = false }: { name: string; size?: number; speaking?: boolean; src?: string | null; keep?: boolean } = $props();

  const hue = $derived([...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 360);
  let failed = $state<string | null>(null);
  const picture = $derived(src && failed !== src ? src : null);
  const sphere = $derived(!keep && store.settings.avatars === 'spheres');
  const ball = $derived(Math.round(size * 0.8));
  const glass = $props.id();
  // Colors stay CSS so a theme change needs no redraw
  const stops = $derived(lampStops(speaking).map(([other, amount]) => `color-mix(in srgb, var(--accent), ${other} ${amount * 100}%)`));
</script>

{#if sphere}
  <!-- The same box as a picture, so rows do not move when the setting changes -->
  <span class="avatar orb" class:speaking style:width="{size}px" style:height="{size}px">
    <svg class="ball" viewBox="0 0 64 64" width={ball} height={ball} aria-hidden="true">
      <radialGradient id={glass} gradientUnits="userSpaceOnUse" fx={LAMP.fx} fy={LAMP.fy} fr={LAMP.fr} cx={LAMP.cx} cy={LAMP.cy} r={LAMP.r}>
        <stop offset="0" style:stop-color={stops[0]} />
        <stop offset="1" style:stop-color={stops[1]} />
      </radialGradient>
      <circle cx={LAMP.cx} cy={LAMP.cy} r={LAMP.radius} fill="url(#{glass})" />
      {#if !speaking}
        <circle cx={LAMP.cx} cy={LAMP.cy} r={LAMP.rimRadius} fill="none" stroke="var(--accent)" stroke-width={LAMP.rimWidth} stroke-opacity={LAMP.rimOpacity} />
      {/if}
    </svg>
  </span>
{:else}
  <span class="avatar" class:speaking class:picture style:width="{size}px" style:height="{size}px"
    style:font-size="{Math.round(size * 0.45)}px" style:background={picture ? undefined : `hsl(${hue} 45% 38%)`}>
    {#if picture}
      <img src={picture} alt="" draggable="false" onerror={() => (failed = picture)} />
    {:else}
      {(name.trim()[0] ?? '?').toUpperCase()}
    {/if}
  </span>
{/if}

<style>
  .avatar {
    flex: none; display: inline-flex; align-items: center; justify-content: center; overflow: hidden;
    font-weight: 650; color: #fff; user-select: none; box-shadow: 0 0 0 2px transparent;
    transition: box-shadow 80ms;
  }
  .avatar.picture { background: var(--bg-3); }
  img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .speaking { box-shadow: 0 0 0 2px var(--speaking); }
  .ball { display: block; }
  .orb.speaking { box-shadow: none; }
</style>
