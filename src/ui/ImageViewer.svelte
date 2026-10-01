<script lang="ts">
  import { ui } from '../lib/ui.svelte.ts';

  // An image from the chat or a description, as large as the window allows. A click anywhere
  // or Escape closes it.
  const src = $derived(ui.image);
  const remote = $derived(!!src && /^https?:/i.test(src));
</script>

<svelte:window onkeydown={e => { if (src && e.key === 'Escape') { e.stopPropagation(); ui.image = null; } }} />

{#if src}
  <div class="viewer" role="dialog" aria-modal="true" aria-label="Image">
    <button class="shade" aria-label="Close image" onclick={() => (ui.image = null)}></button>
    <img {src} alt="" />
    {#if remote}<a class="open" href={src} target="_blank" rel="noopener noreferrer">Open original</a>{/if}
  </div>
{/if}

<style>
  .viewer { position: fixed; inset: 0; z-index: 300; display: flex; align-items: center; justify-content: center; padding: 16px; }
  .shade { position: absolute; inset: 0; background: rgb(0 0 0 / 0.85); cursor: zoom-out; }
  img { position: relative; max-width: 100%; max-height: 100%; object-fit: contain; pointer-events: none; box-shadow: 0 16px 48px rgb(0 0 0 / 0.6); }
  .open { position: absolute; bottom: 14px; left: 50%; transform: translateX(-50%); padding: 4px 10px; font-size: 13px; color: #fff; background: rgb(0 0 0 / 0.7); }
</style>
