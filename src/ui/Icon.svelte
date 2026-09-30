<script lang="ts">
  import { ICON_PATHS as paths } from '../lib/icons.ts';

  let { name, size = 20 }: { name: string; size?: number } = $props();
</script>

<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
  stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true">
  <path d={paths[name] ?? ''} />
</svg>
