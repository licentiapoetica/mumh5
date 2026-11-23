<script lang="ts">
  import { areaBackground, backgroundCss, type AreaBackground, type BackgroundArea } from '../lib/background.svelte.ts';

  // area: which setting applies; source: an explicit style instead (the settings preview)
  let { area = 'main', source, strip = false }: { area?: BackgroundArea; source?: AreaBackground; strip?: boolean } = $props();

  const from = $derived(source ?? areaBackground(area));
  const css = $derived(from && backgroundCss(from.style, from.image.url, strip));
</script>

{#if css}
  <div class="background-art" aria-hidden="true" data-design={css.design} data-area={area}
    style:background-image={css.paint} style:opacity={css.opacity}
    style:background-size={css.size} style:background-repeat={css.repeat}></div>
{/if}

<style>
  :global([data-background]) { position: relative; isolation: isolate; }
  .background-art { position: absolute; inset: 0; z-index: -1; pointer-events: none; background-position: center; }
</style>
