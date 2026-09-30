<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';

  let { title, onclose, children, footer, width = 460 }:
    { title: string; onclose: () => void; children: Snippet; footer?: Snippet; width?: number } = $props();
</script>

<svelte:window onkeydown={e => { if (e.key === 'Escape') onclose(); }} />

<div class="backdrop" role="presentation" onmousedown={e => { if (e.target === e.currentTarget) onclose(); }}>
  <div class="modal" role="dialog" aria-modal="true" aria-label={title} style:max-width="{width}px">
    <header>
      <h2>{title}</h2>
      <button class="icon-btn" onclick={onclose} aria-label="Close"><Icon name="x" /></button>
    </header>
    <div class="body">{@render children()}</div>
    {#if footer}<footer>{@render footer()}</footer>{/if}
  </div>
</div>

<style>
  .backdrop {
    position: fixed; inset: 0; z-index: 100; background: rgb(0 0 0 / 0.6);
    display: flex; align-items: center; justify-content: center; padding: 16px;
  }
  .modal {
    width: 100%; max-height: calc(100vh - 32px); display: flex; flex-direction: column;
    background: var(--bg-1); border: 1px solid var(--line); box-shadow: 0 16px 48px rgb(0 0 0 / 0.5);
  }
  header { display: flex; align-items: center; justify-content: space-between; padding: 16px 16px 0 20px; }
  h2 { margin: 0; font-size: 18px; }
  .body { padding: 4px 20px 20px; overflow-y: auto; }
  footer { display: flex; justify-content: flex-end; gap: 8px; padding: 14px 20px; background: var(--bg-0); border-top: 1px solid var(--line); }
</style>
