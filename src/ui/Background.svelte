<script lang="ts">
  import { areaBackground, backgroundCss, type AreaBackground, type BackgroundArea } from '../lib/background.svelte.ts';

  // area: which setting applies; source: an explicit style instead (the settings preview)
  // reach: paint as tall as this many px, from the bottom up, so a short bar shows the lower edge
  // of a taller surface as if that surface went on
  let { area = 'main', source, reach }: { area?: BackgroundArea; source?: AreaBackground; reach?: number } = $props();

  const from = $derived(source ?? areaBackground(area));
  const css = $derived(from && backgroundCss(from.style, from.image.url));
</script>

{#if css}
  <div class="background-art" aria-hidden="true" data-design={css.design} data-area={area}
    style:background-image={css.paint} style:opacity={css.opacity}
    style:background-size={css.size} style:background-repeat={css.repeat}
    style:top={reach ? 'auto' : undefined} style:height={reach ? `${reach}px` : undefined}></div>
{/if}

<style>
  :global([data-background]) { position: relative; isolation: isolate; }
  .background-art { position: absolute; inset: 0; z-index: -1; pointer-events: none; background-position: center; }
</style>
