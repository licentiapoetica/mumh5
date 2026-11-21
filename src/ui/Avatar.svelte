<script lang="ts">
  import { store } from '../lib/settings.svelte.ts';

  // src: the person's picture (an object URL); the letter shows without one or when it cannot be decoded
  // keep: the picture is the point here (chat, members, profiles, voice tiles), so the sphere setting does not replace it
  let { name, size = 32, speaking = false, src = null, keep = false }: { name: string; size?: number; speaking?: boolean; src?: string | null; keep?: boolean } = $props();

  const hue = $derived([...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 360);
  let failed = $state<string | null>(null);
  const picture = $derived(src && failed !== src ? src : null);
  const sphere = $derived(!keep && store.settings.avatars === 'spheres');
  const ball = $derived(Math.round(size * 0.72));
</script>

{#if sphere}
  <!-- The same box as a picture, so rows do not move when the setting changes -->
  <span class="avatar orb" class:speaking style:width="{size}px" style:height="{size}px">
    <span class="ball" style:width="{ball}px" style:height="{ball}px"></span>
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
  /* clip-path, since border-radius is off everywhere */
  .ball {
    --ball: var(--accent);
    display: block; clip-path: circle(50%);
    background: radial-gradient(circle at 35% 30%, color-mix(in srgb, #fff 72%, var(--ball)), var(--ball) 48%, color-mix(in srgb, #000 48%, var(--ball)));
  }
  .orb.speaking { box-shadow: none; }
  .orb.speaking .ball { --ball: var(--speaking); }
</style>
