// WebKitGTK (the Linux desktop app) plays only streams of real capture devices in media
// elements, and those only unmuted: a muted video that is small or off screen is suspended.
// Streams made by the page (canvas.captureStream, WebAudio destinations) never play. So the
// pictures of native shares are painted onto canvases laid over the video elements that show
// them, and their sound goes straight to WebAudio.

export interface Painter {
  readonly width: number;
  readonly height: number;
  add(canvas: HTMLCanvasElement): void;
  remove(canvas: HTMLCanvasElement): void;
  setVolume(volume: number): void;
}

const painters = new WeakMap<MediaStream, Painter>();
export const registerPainter = (stream: MediaStream, painter: Painter) => painters.set(stream, painter);
export const painterOf = (stream: MediaStream | null | undefined) => stream ? painters.get(stream) : undefined;

// The WebKitGTK shell, the one place without WebRTC in the page (the native share path)
const webkitGtk = () => typeof RTCPeerConnection === 'undefined';

/** Plays a video element without sound in a way WebKitGTK does not suspend. */
export function quiet(video: HTMLMediaElement): void {
  if (!webkitGtk() || !(video instanceof HTMLVideoElement)) return;
  video.muted = false;
  video.volume = 0;
}

const overlays = new WeakMap<HTMLVideoElement, { canvas: HTMLCanvasElement; painter: Painter; stop: () => void }>();

/** The size of the picture shown by a video element, also when a native painter draws it. */
export function pictureSize(video: HTMLVideoElement | undefined): [number, number] {
  if (!video) return [0, 0];
  if (video.videoWidth) return [video.videoWidth, video.videoHeight];
  const o = overlays.get(video);
  return o ? [o.painter.width, o.painter.height] : [0, 0];
}

function detach(video: HTMLVideoElement): void {
  const o = overlays.get(video);
  if (!o) return;
  overlays.delete(video);
  o.stop();
}

// A canvas over the video: same box, same transform, no pointer events, so everything the
// video element does for the page (size, zoom, clicks) stays with the video.
function overlay(video: HTMLVideoElement, painter: Painter): void {
  const doc = video.ownerDocument;
  const win = doc.defaultView ?? window;
  const canvas = doc.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  const place = () => {
    const parent = video.parentElement;
    if (!parent) return;
    if (canvas.parentElement !== parent) video.after(canvas);
    if (win.getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
    const style = win.getComputedStyle(video);
    canvas.style.cssText = [
      'position:absolute', 'pointer-events:none', 'object-fit:contain', 'background:transparent',
      `left:${video.offsetLeft}px`, `top:${video.offsetTop}px`,
      `width:${video.offsetWidth}px`, `height:${video.offsetHeight}px`,
      `transform:${style.transform}`, `transform-origin:${style.transformOrigin}`,
      `z-index:${style.zIndex === 'auto' ? 'auto' : style.zIndex}`
    ].join(';');
  };
  place();
  const resized = new win.ResizeObserver(place);
  resized.observe(video);
  if (video.parentElement) resized.observe(video.parentElement);
  const changed = new win.MutationObserver(place);
  changed.observe(video, { attributes: true, attributeFilter: ['style', 'class'] });
  painter.add(canvas);
  overlays.set(video, {
    canvas, painter,
    stop: () => { painter.remove(canvas); resized.disconnect(); changed.disconnect(); canvas.remove(); }
  });
}

/** Shows a stream in a media element; the action behind the stage's pictures and players. */
export function showStream(node: HTMLMediaElement, stream: MediaStream | null): void {
  if (node instanceof HTMLVideoElement) detach(node);
  const painter = painterOf(stream);
  if (painter) {
    node.srcObject = null;
    if (node instanceof HTMLVideoElement) overlay(node, painter);
    return;
  }
  node.srcObject = stream;
  quiet(node);
  if (stream) node.play().catch(() => {});
}

/** Svelte action form of showStream. */
export function media(node: HTMLMediaElement, stream: MediaStream | null) {
  let current = stream;
  showStream(node, stream);
  return {
    update(next: MediaStream | null) { if (next !== current) { current = next; showStream(node, next); } },
    destroy() { if (node instanceof HTMLVideoElement) detach(node); }
  };
}
