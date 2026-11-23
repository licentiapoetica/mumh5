<script lang="ts">
  import { ui } from '../lib/ui.svelte.ts';

  // An image from the chat or a description, as large as the window allows. The wheel zooms
  // toward the pointer and dragging moves a zoomed image. A click closes it, except on the
  // picture while zoomed. Escape always closes.
  const src = $derived(ui.image);
  const remote = $derived(!!src && /^https?:/i.test(src));

  // Below a slight movement a press is still a click.
  const DRAG_PX = 4;

  let img = $state<HTMLImageElement>();
  let scale = $state(1);
  let x = $state(0);
  let y = $state(0);
  let dragging = $state(false);
  let press: { id: number; startX: number; startY: number; lastX: number; lastY: number; zoomed: boolean; moved: boolean } | null = null;

  $effect(() => {
    void src;
    scale = 1;
    x = 0;
    y = 0;
    dragging = false;
    press = null;
  });

  // Enough to see single pixels of a large picture that had to shrink to fit.
  function maxScale(el: HTMLImageElement): number {
    const shrunk = el.offsetWidth ? el.naturalWidth / el.offsetWidth : 1;
    return Math.max(8, 4 * shrunk);
  }

  // The picture stays centered on an axis where it fits, and cannot leave the window on one where it does not.
  function keepInView() {
    if (!img) return;
    const freeX = Math.max(0, (img.offsetWidth * scale - window.innerWidth) / 2);
    const freeY = Math.max(0, (img.offsetHeight * scale - window.innerHeight) / 2);
    x = Math.min(freeX, Math.max(-freeX, x));
    y = Math.min(freeY, Math.max(-freeY, y));
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    if (!img) return;
    const pixels = e.deltaMode === 1 ? e.deltaY * 40 : e.deltaMode === 2 ? e.deltaY * 800 : e.deltaY;
    // A trackpad pinch arrives as ctrl+wheel with much smaller steps.
    const next = Math.min(maxScale(img), Math.max(1, scale * Math.exp(-pixels * (e.ctrlKey ? 0.01 : 0.002))));
    if (next === scale) return;
    const fromCenterX = e.clientX - window.innerWidth / 2;
    const fromCenterY = e.clientY - window.innerHeight / 2;
    x = fromCenterX - (fromCenterX - x) * (next / scale);
    y = fromCenterY - (fromCenterY - y) * (next / scale);
    scale = next;
    keepInView();
  }

  function onPointerDown(e: PointerEvent & { currentTarget: HTMLButtonElement }) {
    if (e.button !== 0) return;
    press = { id: e.pointerId, startX: e.clientX, startY: e.clientY, lastX: e.clientX, lastY: e.clientY, zoomed: scale > 1, moved: false };
    if (press.zoomed) e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent) {
    if (!press || press.id !== e.pointerId || !press.zoomed) return;
    if (!press.moved && Math.hypot(e.clientX - press.startX, e.clientY - press.startY) < DRAG_PX) return;
    press.moved = true;
    dragging = true;
    x += e.clientX - press.lastX;
    y += e.clientY - press.lastY;
    press.lastX = e.clientX;
    press.lastY = e.clientY;
    keepInView();
  }

  // The press is kept for the click that follows, but must no longer follow the mouse.
  function onPointerEnd() {
    dragging = false;
    if (press) press.id = -1;
  }

  function onPicture(e: MouseEvent): boolean {
    const r = img?.getBoundingClientRect();
    return !!r && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  }

  function onClick(e: MouseEvent) {
    const held = press;
    press = null;
    if (held?.moved) return;
    if (held?.zoomed && onPicture(e)) return;
    ui.image = null;
  }
</script>

<svelte:window
  onkeydown={e => { if (src && e.key === 'Escape') { e.stopPropagation(); ui.image = null; } }}
  onresize={keepInView}
/>

{#if src}
  <div class="viewer" role="dialog" aria-modal="true" aria-label="Image">
    <button
      class="shade"
      class:zoomed={scale > 1}
      class:dragging
      aria-label="Close image"
      onwheel={onWheel}
      onpointerdown={onPointerDown}
      onpointermove={onPointerMove}
      onpointerup={onPointerEnd}
      onpointercancel={onPointerEnd}
      onclick={onClick}
    ></button>
    <img bind:this={img} {src} alt="" draggable="false" style:transform="translate({x}px, {y}px) scale({scale})" />
    {#if remote}<a class="open" href={src} target="_blank" rel="noopener noreferrer">Open original</a>{/if}
  </div>
{/if}

<style>
  .viewer { position: fixed; inset: 0; z-index: 300; display: flex; align-items: center; justify-content: center; padding: 16px; overflow: hidden; }
  .shade { position: absolute; inset: 0; background: rgb(0 0 0 / 0.85); cursor: zoom-out; touch-action: none; }
  .shade.zoomed { cursor: grab; }
  .shade.dragging { cursor: grabbing; }
  img { position: relative; max-width: 100%; max-height: 100%; object-fit: contain; pointer-events: none; user-select: none; }
  .open { position: absolute; bottom: 14px; left: 50%; transform: translateX(-50%); padding: 4px 10px; font-size: 13px; color: #fff; background: rgb(0 0 0 / 0.7); }
</style>
