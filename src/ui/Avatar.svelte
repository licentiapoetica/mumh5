<script lang="ts">
  let { name, size = 32, speaking = false }: { name: string; size?: number; speaking?: boolean } = $props();

  const hue = $derived([...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 360);
</script>

<span class="avatar" class:speaking style:width="{size}px" style:height="{size}px"
  style:font-size="{Math.round(size * 0.45)}px" style:background="hsl({hue} 45% 38%)">
  {(name.trim()[0] ?? '?').toUpperCase()}
</span>

<style>
  .avatar {
    flex: none; display: inline-flex; align-items: center; justify-content: center;
    font-weight: 700; color: #fff; user-select: none; box-shadow: 0 0 0 2px transparent;
    transition: box-shadow 80ms;
  }
  .speaking { box-shadow: 0 0 0 2px var(--speaking); }
</style>
