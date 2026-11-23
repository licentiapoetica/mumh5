<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';

  // height: a fixed size for dialogs whose content changes (sections, tabs), so it does not jump
  // body: the scrolling element, for dialogs that move between sections
  // actions: more buttons beside Close
  // windowed: fills a window of its own, which Escape or a click beside it must not close
  let { title, onclose, children, footer, actions, width = 460, height, body = $bindable(), windowed = false }:
    { title: string; onclose: () => void; children: Snippet; footer?: Snippet; actions?: Snippet; width?: number; height?: number; body?: HTMLDivElement; windowed?: boolean } = $props();

  // The window this dialog is in, which is not always the app's
  function escapeCloses(node: HTMLElement) {
    if (windowed) return;
    const view = node.ownerDocument.defaultView ?? window;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onclose(); };
    view.addEventListener('keydown', key);
    return { destroy: () => view.removeEventListener('keydown', key) };
  }
</script>

<div class="backdrop" class:windowed role="presentation" use:escapeCloses
  onmousedown={e => { if (!windowed && e.target === e.currentTarget) onclose(); }}>
  <div class="modal" role="dialog" aria-modal={windowed ? undefined : 'true'} aria-label={title} style:max-width="{width}px"
    style:height={height ? `${height}px` : undefined} class:fixed={!!height}>
    <header>
      <h2>{title}</h2>
      <span class="head-tools">
        {@render actions?.()}
        <button class="icon-btn" onclick={onclose} aria-label="Close"><Icon name="x" /></button>
      </span>
    </header>
    <div class="body" bind:this={body}>{@render children()}</div>
    {#if footer}<footer>{@render footer()}</footer>{/if}
  </div>
</div>

<style>
  .backdrop {
    position: fixed; inset: 0; z-index: 100; background: rgb(0 0 0 / 0.6);
    display: flex; align-items: center; justify-content: center; padding: 16px;
    animation: fade 140ms var(--ease);
  }
  .modal {
    width: 100%; max-height: calc(100vh - 32px); display: flex; flex-direction: column;
    background: var(--bg-1); border: 1px solid var(--line-strong);
    animation: rise 160ms var(--ease);
  }
  header { flex: none; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 18px 14px 0 24px; }
  h2 { margin: 0; font-size: 17px; font-weight: 650; min-width: 0; overflow-wrap: anywhere; }
  .head-tools { flex: none; display: flex; align-items: center; gap: 2px; }
  .backdrop.windowed { padding: 0; background: var(--bg-1); animation: none; }
  .windowed .modal { max-width: none !important; height: 100vh !important; max-height: 100vh; border: 0; border-radius: 0 !important; animation: none; }
  .windowed .modal > header, .windowed .modal > footer { border-radius: 0 !important; }
  .body { padding: 8px 24px 24px; overflow-y: auto; }
  /* Fill the fixed height (max-height still caps it) and keep the scrollbar's room, so short content is not wider */
  .modal.fixed .body { flex: 1; scrollbar-gutter: stable; }
  footer { flex: none; display: flex; justify-content: flex-end; gap: 8px; padding: 14px 24px; background: var(--bg-0); border-top: 1px solid var(--line); }
  /* Steps without buttons leave no empty bar */
  footer:empty { display: none; }
  /* Phones: one full-width button per row, the main action on top, notes above the buttons */
  @media (max-width: 480px) {
    footer { flex-direction: column-reverse; align-items: stretch; padding: 12px 16px; }
    footer > :global(span:empty) { display: none; }
    footer > :global(:not(button)) { order: 1; text-align: center; }
  }
  @keyframes fade { from { opacity: 0; } }
  @keyframes rise { from { opacity: 0; transform: translateY(6px); } }
</style>
