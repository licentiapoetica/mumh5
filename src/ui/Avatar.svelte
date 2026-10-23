<script lang="ts">
  // src: the person's picture (an object URL); the letter shows without one or when it cannot be decoded
  let { name, size = 32, speaking = false, src = null }: { name: string; size?: number; speaking?: boolean; src?: string | null } = $props();

  const hue = $derived([...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 360);
  let failed = $state<string | null>(null);
  const picture = $derived(src && failed !== src ? src : null);
</script>

<span class="avatar" class:speaking class:picture style:width="{size}px" style:height="{size}px"
  style:font-size="{Math.round(size * 0.45)}px" style:background={picture ? undefined : `hsl(${hue} 45% 38%)`}>
  {#if picture}
    <img src={picture} alt="" draggable="false" onerror={() => (failed = picture)} />
  {:else}
    {(name.trim()[0] ?? '?').toUpperCase()}
  {/if}
</span>

<style>
  .avatar {
    flex: none; display: inline-flex; align-items: center; justify-content: center; overflow: hidden;
    font-weight: 650; color: #fff; user-select: none; box-shadow: 0 0 0 2px transparent;
    transition: box-shadow 80ms;
  }
  .avatar.picture { background: var(--bg-3); }
  img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .speaking { box-shadow: 0 0 0 2px var(--speaking); }
</style>
