<script lang="ts">
  // Drag handle on one edge of a panel. `edge` is the side the handle sits on: a panel on
  // the right of the window is resized from its left edge and vice versa. Width is remembered.
  let { width = $bindable(), edge, min, max, initial, storageKey, label }:
    { width: number; edge: 'left' | 'right'; min: number; max: () => number; initial: number; storageKey: string; label: string } = $props();

  let resizing = $state(false);

  function setWidth(w: number) {
    width = Math.round(Math.max(min, Math.min(max(), w)));
    try { localStorage.setItem(storageKey, String(width)); } catch { /* storage unavailable */ }
  }

  function start(e: PointerEvent) {
    e.preventDefault();
    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture(e.pointerId);
    resizing = true;
    document.body.style.userSelect = 'none';
    const box = (handle.parentElement as HTMLElement).getBoundingClientRect();
    const move = (ev: PointerEvent) => setWidth(edge === 'left' ? box.right - ev.clientX : ev.clientX - box.left);
    const up = () => {
      resizing = false;
      document.body.style.userSelect = '';
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  }

  function onkeydown(e: KeyboardEvent) {
    const grow = edge === 'left' ? 'ArrowLeft' : 'ArrowRight';
    const shrink = edge === 'left' ? 'ArrowRight' : 'ArrowLeft';
    if (e.key === grow) setWidth(width + 16);
    else if (e.key === shrink) setWidth(width - 16);
    else return;
    e.preventDefault();
  }
</script>

<svelte:window onresize={() => setWidth(width)} />

<!-- Focusable separator is the ARIA window-splitter pattern -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div class="resize {edge}" class:active={resizing} role="separator" aria-orientation="vertical" aria-label={label}
  aria-valuenow={width} aria-valuemin={min} aria-valuemax={max()} tabindex="0" title="Drag to resize, double-click to reset"
  onpointerdown={start} ondblclick={() => setWidth(initial)} {onkeydown}></div>

<style>
  .resize { position: absolute; z-index: 5; top: 0; bottom: 0; width: 8px; cursor: col-resize; touch-action: none; }
  .resize.left { left: -4px; }
  .resize.right { right: -4px; }
  .resize:hover, .resize:focus-visible, .resize.active {
    background: linear-gradient(to right, transparent 3px, var(--accent) 3px, var(--accent) 5px, transparent 5px);
    outline: none;
  }
</style>
