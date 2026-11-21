<script lang="ts">
  import Icon from './Icon.svelte';

  // A stream picture that zooms: the wheel zooms toward the pointer, dragging pans, two
  // fingers pinch, and while zoomed and hovered a panel (bottom right; a magnifier button before) shows
  // the whole picture with the part in view framed. Used on the stage and in the separate stream
  // window, so it measures with its own window's observers and has no app-wide menus.
  let { stream, zoom = $bindable(1), video = $bindable(), ondblclick }: {
    stream: MediaStream | null;
    zoom?: number;
    video?: HTMLVideoElement;
    ondblclick?: (e: MouseEvent) => void;
  } = $props();

  const MAX_ZOOM = 8;
  // Pan as a fraction of the video box, so it survives full screen and resizes
  let panX = $state(0);
  let panY = $state(0);
  let boxW = $state(0);
  let boxH = $state(0);
  let srcW = $state(0);
  let srcH = $state(0);
  let dragging = $state(false);

  // Mobile browsers do not always honour autoplay for a stream attached later, so play is asked for too
  function media(node: HTMLMediaElement, s: MediaStream | null) {
    const attach = (next: MediaStream | null) => {
      node.srcObject = next;
      if (next) node.play().catch(() => {});
    };
    attach(s);
    return { update(next: MediaStream | null) { if (node.srcObject !== next) attach(next); } };
  }

  // The observer comes from the element's own window: the separate stream window has its own
  function measure(node: HTMLElement) {
    const win = (node.ownerDocument.defaultView ?? window) as Window & typeof globalThis;
    const read = () => { boxW = node.clientWidth; boxH = node.clientHeight; };
    const ro = new win.ResizeObserver(read);
    ro.observe(node);
    read();
    return { destroy: () => ro.disconnect() };
  }
  function readSource() {
    srcW = video?.videoWidth ?? 0;
    srcH = video?.videoHeight ?? 0;
  }

  // Picture size as a fraction of the video box (the rest is letterbox)
  function pictureShare(): [number, number] {
    const ratio = srcW && srcH && boxW && boxH ? (srcW / srcH) / (boxW / boxH) : 1;
    return [Math.min(1, ratio), Math.min(1, 1 / ratio)];
  }
  // Keeps the picture (not its letterbox bars) covering the box; centred while it is smaller
  function clampPan(s: number, x: number, y: number): [number, number] {
    const [a, b] = pictureShare();
    const axis = (p: number, f: number) => s * f >= 1
      ? Math.min(-s * (1 - f) / 2, Math.max(1 - s * (1 + f) / 2, p))
      : (1 - s) / 2;
    return [axis(x, a), axis(y, b)];
  }
  const view = $derived(clampPan(zoom, panX, panY));

  // A new stream starts unzoomed
  $effect(() => { void stream; zoom = 1; panX = 0; panY = 0; });

  // Zooms so that the point at (qx, qy), as a fraction of the untransformed box, stays put
  function zoomAround(s: number, qx: number, qy: number) {
    if (!boxW || !boxH) return;
    readSource();
    const next = Math.min(MAX_ZOOM, Math.max(1, s));
    const cx = (qx - view[0]) / zoom, cy = (qy - view[1]) / zoom;
    [panX, panY] = clampPan(next, qx - cx * next, qy - cy * next);
    zoom = next;
  }
  function zoomAt(s: number, clientX: number, clientY: number) {
    if (!video || !boxW || !boxH) return;
    const r = video.getBoundingClientRect();
    zoomAround(s, (clientX - r.left) / boxW + view[0], (clientY - r.top) / boxH + view[1]);
  }
  const zoomCentre = (s: number) => zoomAround(s, 0.5, 0.5);

  // Non-passive, so the wheel does not also scroll the page
  function wheelZoom(node: HTMLElement) {
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
      zoomAt(zoom * Math.exp(-dy * 0.002), e.clientX, e.clientY);
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return { destroy: () => node.removeEventListener('wheel', onWheel) };
  }

  const pointers = new Map<number, { x: number; y: number }>();
  function pointerDown(e: PointerEvent) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragging = zoom > 1 || pointers.size > 1;
  }
  function pointerMove(e: PointerEvent) {
    const last = pointers.get(e.pointerId);
    if (!last) return;
    if (pointers.size === 2) {
      const [p, q] = [...pointers.values()];
      const before = Math.hypot(p.x - q.x, p.y - q.y);
      last.x = e.clientX; last.y = e.clientY;
      const after = Math.hypot(p.x - q.x, p.y - q.y);
      if (before > 0) zoomAt(zoom * after / before, (p.x + q.x) / 2, (p.y + q.y) / 2);
      return;
    }
    const dx = e.clientX - last.x, dy = e.clientY - last.y;
    last.x = e.clientX; last.y = e.clientY;
    if (zoom > 1 && boxW && boxH) [panX, panY] = clampPan(zoom, view[0] + dx / boxW, view[1] + dy / boxH);
  }
  function pointerUp(e: PointerEvent) {
    pointers.delete(e.pointerId);
    if (!pointers.size) dragging = false;
  }

  // The part of the picture in view, as fractions of the picture, for the frame on the map
  const seen = $derived.by(() => {
    const [a, b] = pictureShare();
    const part = (p: number, f: number) => {
      const from = ((-p / zoom) - (1 - f) / 2) / f, to = (((1 - p) / zoom) - (1 - f) / 2) / f;
      return [Math.max(0, from), Math.min(1, to)];
    };
    const [x0, x1] = part(view[0], a), [y0, y1] = part(view[1], b);
    return { left: x0 * 100, top: y0 * 100, width: (x1 - x0) * 100, height: (y1 - y0) * 100 };
  });
  // A click or drag on the map centres the view on that point of the picture
  function mapPoint(e: PointerEvent) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const u = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), v = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    const [a, b] = pictureShare();
    [panX, panY] = clampPan(zoom, 0.5 - zoom * ((1 - a) / 2 + u * a), 0.5 - zoom * ((1 - b) / 2 + v * b));
  }
  function mapDown(e: PointerEvent) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    mapPoint(e);
  }
  const mapMove = (e: PointerEvent) => { if ((e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) mapPoint(e); };
</script>

<!-- svelte-ignore a11y_media_has_caption -->
<video class="main" bind:this={video} use:media={stream} use:wheelZoom use:measure autoplay playsinline muted {ondblclick}
  class:zoomed={zoom > 1} class:dragging onloadedmetadata={readSource} onresize={readSource}
  onpointerdown={pointerDown} onpointermove={pointerMove} onpointerup={pointerUp} onpointercancel={pointerUp}
  style:transform={zoom > 1 ? `translate(${view[0] * 100}%, ${view[1] * 100}%) scale(${zoom})` : undefined}></video>
{#if zoom > 1}
<div class="zoom" role="group" aria-label="Zoom">
  <!-- svelte-ignore a11y_media_has_caption -->
  <div class="map" role="presentation" style:aspect-ratio={srcW && srcH ? `${srcW} / ${srcH}` : '16 / 9'}
    onpointerdown={mapDown} onpointermove={mapMove}>
    <video use:media={stream} autoplay playsinline muted></video>
    <span class="seen" style:left="{seen.left}%" style:top="{seen.top}%" style:width="{seen.width}%" style:height="{seen.height}%"></span>
  </div>
  <div class="zoom-row">
    <button class="icon-btn" title="Zoom out" aria-label="Zoom out" disabled={zoom <= 1} onclick={() => zoomCentre(zoom / 1.5)}><Icon name="zoom-out" size={16} /></button>
    <input type="range" min="1" max={MAX_ZOOM} step="0.01" value={zoom} oninput={e => zoomCentre(Number(e.currentTarget.value))}
      aria-label="Zoom" aria-valuetext="{Math.round(zoom * 100)}%" title="{Math.round(zoom * 100)}%" />
    <button class="icon-btn" title="Zoom in" aria-label="Zoom in" disabled={zoom >= MAX_ZOOM} onclick={() => zoomCentre(zoom * 1.5)}><Icon name="zoom-in" size={16} /></button>
  </div>
</div>
{:else}
<button class="icon-btn zoom-btn" title="Zoom in (or scroll on the picture)" aria-label="Zoom in" onclick={() => zoomCentre(2)}><Icon name="zoom-in" size={16} /></button>
{/if}

<style>
  /* The parent is positioned and clips: the stage's .pic, or the separate window's body */
  .main { flex: 1; min-width: 0; min-height: 0; width: 100%; height: 100%; object-fit: contain; background: #000; display: block;
    transform-origin: 0 0; touch-action: none; }
  .main.zoomed { cursor: grab; }
  .main.dragging { cursor: grabbing; }
  /* Over the picture, so its colours are fixed dark ones */
  .zoom { position: absolute; right: 8px; bottom: 8px; z-index: 1; width: min(220px, 45%); padding: 6px; display: flex; flex-direction: column; gap: 4px;
    background: rgb(0 0 0 / 0.75); border: 1px solid rgb(255 255 255 / 0.15); box-shadow: var(--shadow-pop);
    opacity: 0; pointer-events: none; transition: opacity 0.15s var(--ease); }
  /* Opacity, not visibility, so the keyboard can still reach it. A drag that leaves the picture keeps it.
     div:hover because the separate window is in quirks mode, where a bare :hover matches nothing */
  :global(div:hover) > .zoom, .zoom:active, .zoom:has(:focus-visible), .main.dragging ~ .zoom { opacity: 1; pointer-events: auto; }
  @media (hover: none) { .zoom { opacity: 1; pointer-events: auto; } }
  .map { position: relative; width: 100%; overflow: hidden; background: #000; cursor: pointer; touch-action: none; }
  .map video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; pointer-events: none; }
  .seen { position: absolute; border: 2px solid var(--accent); background: color-mix(in srgb, var(--accent) 18%, transparent); pointer-events: none; }
  /* Before zooming only a button, on hover like the other picture controls; touch screens have no hover */
  .zoom-btn { position: absolute; right: 8px; bottom: 8px; z-index: 1; color: #ddd; background: rgb(0 0 0 / 0.75); border: 1px solid rgb(255 255 255 / 0.15);
    opacity: 0; visibility: hidden; transition: opacity 0.15s var(--ease), visibility 0.15s; }
  .zoom-btn:hover { color: #fff; background: rgb(0 0 0 / 0.9); }
  :global(div:hover) > .zoom-btn, .zoom-btn:focus-visible { opacity: 1; visibility: visible; }
  @media (hover: none) { .zoom-btn { opacity: 1; visibility: visible; } }
  .zoom-row { display: flex; align-items: center; gap: 4px; }
  .zoom-row input { flex: 1; min-width: 0; padding: 0; }
  .zoom-row .icon-btn { flex: none; color: #ddd; }
  .zoom-row .icon-btn:disabled { opacity: 0.4; }
</style>
