<script lang="ts">
  import { onDestroy } from 'svelte';
  import { MAX_BANNER_ZOOM, bannerSourceRect, type BannerCrop } from '../lib/images.ts';

  // Drag the picture into the 5:1 frame and zoom it; what the frame shows is what gets sent
  let { blob, crop: initial, busy = false, onsave, oncancel, onerror }:
    { blob: Blob; crop: BannerCrop; busy?: boolean; onsave: (crop: BannerCrop) => void; oncancel: () => void; onerror: () => void } = $props();

  // svelte-ignore state_referenced_locally
  let crop = $state<BannerCrop>({ ...initial });
  // The parent keys this component on the picture
  // svelte-ignore state_referenced_locally
  const url = URL.createObjectURL(blob);
  onDestroy(() => URL.revokeObjectURL(url));

  let natural = $state<{ w: number; h: number } | null>(null);
  let frameW = $state(0);
  const rect = $derived(natural ? bannerSourceRect(natural.w, natural.h, crop) : null);
  const scale = $derived(rect && frameW ? frameW / rect.sw : 0);

  const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));

  // Moves by picture pixels; a side without anything left over stays put
  function moveBy(dx: number, dy: number, from = crop) {
    if (!natural || !rect) return;
    const ox = natural.w - rect.sw, oy = natural.h - rect.sh;
    crop = { ...from, x: ox > 0 ? clamp(from.x + dx / ox) : 0.5, y: oy > 0 ? clamp(from.y + dy / oy) : 0.5 };
  }

  // Zooms around the middle of the frame
  function setZoom(zoom: number) {
    if (!natural || !rect) return;
    const z = clamp(zoom, 1, MAX_BANNER_ZOOM);
    const cx = rect.sx + rect.sw / 2, cy = rect.sy + rect.sh / 2;
    const next = bannerSourceRect(natural.w, natural.h, { x: 0, y: 0, zoom: z });
    const ox = natural.w - next.sw, oy = natural.h - next.sh;
    crop = { zoom: z, x: ox > 0 ? clamp((cx - next.sw / 2) / ox) : 0.5, y: oy > 0 ? clamp((cy - next.sh / 2) / oy) : 0.5 };
  }

  let drag = $state<{ id: number; x: number; y: number; from: BannerCrop } | null>(null);
  function down(e: PointerEvent) {
    if (e.button !== 0 || !scale) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, from: { ...crop } };
  }
  function move(e: PointerEvent) {
    if (!drag || drag.id !== e.pointerId || !scale) return;
    // The picture follows the pointer, so the window onto it goes the other way
    moveBy(-(e.clientX - drag.x) / scale, -(e.clientY - drag.y) / scale, drag.from);
  }
  const up = (e: PointerEvent) => { if (drag?.id === e.pointerId) drag = null; };

  function key(e: KeyboardEvent) {
    if (!rect) return;
    const step = (e.shiftKey ? 0.1 : 0.02) * rect.sw;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[e.key]) moveBy(...moves[e.key]);
    else if (e.key === '+' || e.key === '=') setZoom(crop.zoom * 1.1);
    else if (e.key === '-') setZoom(crop.zoom / 1.1);
    else return;
    e.preventDefault();
  }

  // Not passive, so the dialog does not scroll while zooming
  let frame = $state<HTMLDivElement>();
  $effect(() => {
    const el = frame;
    if (!el) return;
    const wheel = (e: WheelEvent) => { e.preventDefault(); setZoom(crop.zoom * Math.exp(-e.deltaY * 0.0015)); };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  });
</script>

<div class="frame" class:moving={!!drag} bind:this={frame} bind:clientWidth={frameW} role="slider" tabindex="0"
  aria-label="Banner picture position. Drag or use the arrow keys to move it, the wheel or plus and minus to zoom."
  aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(crop.x * 100)}
  aria-valuetext="{Math.round(crop.x * 100)}% across, {Math.round(crop.y * 100)}% down, zoom {crop.zoom.toFixed(1)}"
  onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up} onkeydown={key}>
  <img src={url} alt="" draggable="false"
    onload={e => { const img = e.currentTarget as HTMLImageElement; natural = { w: img.naturalWidth, h: img.naturalHeight }; }} {onerror}
    style:width={natural && scale ? `${natural.w * scale}px` : '100%'}
    style:left={rect ? `${-rect.sx * scale}px` : '0'} style:top={rect ? `${-rect.sy * scale}px` : '0'} />
</div>
<div class="row">
  <label class="zoom">
    <span>Zoom</span>
    <input type="range" min="1" max={MAX_BANNER_ZOOM} step="0.01" value={crop.zoom} disabled={!natural} oninput={e => setZoom(+e.currentTarget.value)} />
  </label>
  <button class="btn" disabled={busy} onclick={oncancel}>Cancel</button>
  <button class="btn primary" disabled={busy || !natural} onclick={() => onsave({ ...crop })}>{busy ? 'Preparing...' : 'Use this part'}</button>
</div>

<style>
  .frame {
    position: relative; overflow: hidden; aspect-ratio: 5; margin-top: 4px;
    border: 1px solid var(--line-strong); background: var(--bg-0);
    cursor: grab; touch-action: none; user-select: none;
  }
  .frame.moving { cursor: grabbing; }
  .frame:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  img { position: absolute; max-width: none; pointer-events: none; }
  .row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 10px; }
  .zoom { flex: 1; display: flex; align-items: center; gap: 8px; min-width: 160px; font-size: 14px; }
  .zoom input { flex: 1; min-width: 0; }
</style>
