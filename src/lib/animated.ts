// Animated pictures. Browsers decode GIF, animated WebP and APNG frame by frame (ImageDecoder) but
// cannot encode any animation, so frames are cut and scaled here and written as animated WebP
// (frames encoded as still WebP by the browser) or, where the browser has no WebP encoder, GIF.
import * as gifencModule from 'gifenc';
import { writeAnimatedWebp, type WebpFrame } from './webp-anim.ts';

// Vite takes gifenc's ES build; Node (the tests) its CommonJS one, which has the functions on default
type Gifenc = typeof gifencModule;
const { GIFEncoder, applyPalette, quantize } = ('GIFEncoder' in gifencModule ? gifencModule : (gifencModule as unknown as { default: Gifenc }).default);

// Browsers stretch shorter frames to 100 ms
const MIN_DELAY = 20;
// Longer animations are cut there (about 10 s at 30 fps), which bounds memory and encoding time
const MAX_FRAMES = 300;

export interface Frame { rgba: Uint8ClampedArray; delay: number }
export interface Frames { width: number; height: number; frames: Frame[] }
export interface SourceRect { sx: number; sy: number; sw: number; sh: number }

function sniff(b: Uint8Array): string | null {
  if (b.length > 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif';
  if (b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
    && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  return null;
}

// The frames of an animation, each cut to rect and scaled to width by height. null when the
// picture is not animated or this browser cannot decode it frame by frame. background fills
// transparent parts; without it transparency is kept.
export async function decodeFrames(file: Blob, rect: (w: number, h: number) => SourceRect, width: number, height: number, background?: string): Promise<Frames | null> {
  if (typeof ImageDecoder === 'undefined') return null;
  const data = new Uint8Array(await file.arrayBuffer());
  const type = sniff(data);
  if (!type || !(await ImageDecoder.isTypeSupported(type))) return null;
  const decoder = new ImageDecoder({ data, type });
  try {
    await decoder.tracks.ready;
    const track = decoder.tracks.selectedTrack;
    if (!track?.animated) return null;
    await decoder.completed;
    const count = track.frameCount;
    if (count < 2) return null;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.imageSmoothingQuality = 'high';
    const frames: Frame[] = [];
    for (let i = 0; i < Math.min(count, MAX_FRAMES); i++) {
      const { image } = await decoder.decode({ frameIndex: i, completeFramesOnly: true });
      try {
        // Microseconds; a frame without a duration plays as browsers play it, 100 ms
        const delay = image.duration ? image.duration / 1000 : 100;
        const r = rect(image.displayWidth, image.displayHeight);
        ctx.clearRect(0, 0, width, height);
        if (background) {
          ctx.fillStyle = background;
          ctx.fillRect(0, 0, width, height);
        }
        ctx.drawImage(image, r.sx, r.sy, r.sw, r.sh, 0, 0, width, height);
        frames.push({ rgba: ctx.getImageData(0, 0, width, height).data, delay });
      } finally {
        image.close();
      }
    }
    return { width, height, frames };
  } finally {
    decoder.close();
  }
}

// Frames at another size, through a canvas
function scaled(src: Frames, width: number, height: number): Frames {
  if (width === src.width && height === src.height) return src;
  const from = document.createElement('canvas');
  from.width = src.width;
  from.height = src.height;
  const fctx = from.getContext('2d')!;
  const to = document.createElement('canvas');
  to.width = width;
  to.height = height;
  const tctx = to.getContext('2d', { willReadFrequently: true })!;
  tctx.imageSmoothingQuality = 'high';
  return {
    width, height,
    frames: src.frames.map(f => {
      fctx.putImageData(new ImageData(new Uint8ClampedArray(f.rgba), src.width, src.height), 0, 0);
      tctx.clearRect(0, 0, width, height);
      tctx.drawImage(from, 0, 0, width, height);
      return { rgba: tctx.getImageData(0, 0, width, height).data, delay: f.delay };
    })
  };
}

// step keeps every step-th frame, each lasting as long as the ones it replaces
// loss: how different (squared distance) a pixel may be and still count as unchanged
export function encodeGif(src: Frames, colors: number, step: number, transparent: boolean, loss = 300): Uint8Array {
  const gif = GIFEncoder();
  const { width, height } = src;
  const frames: Frame[] = [];
  for (let i = 0; i < src.frames.length; i += step) {
    let delay = 0;
    for (let j = i; j < Math.min(src.frames.length, i + step); j++) delay += src.frames[j].delay;
    frames.push({ rgba: src.frames[i].rgba, delay: Math.max(MIN_DELAY, delay) });
  }
  if (transparent) {
    for (const f of frames) {
      const palette = quantize(f.rgba, colors, { format: 'rgba4444', oneBitAlpha: true });
      const index = applyPalette(f.rgba, palette, 'rgba4444');
      const clear = palette.findIndex(c => c[3] === 0);
      // Each frame is whole, so the one before is cleared rather than shown through
      gif.writeFrame(index, width, height, { palette, delay: f.delay, transparent: clear >= 0, transparentIndex: Math.max(0, clear), dispose: 2 });
    }
  } else {
    // One palette for all frames, from a sample of them, and one more entry for "as before": a
    // frame only carries what changed, and long runs of that entry compress to almost nothing
    const palette = quantize(sample(frames, 12), colors - 1);
    const keep = palette.length;
    let shown: Uint8Array | null = null;
    for (const f of frames) {
      const index = applyPalette(f.rgba, palette);
      if (!shown) {
        gif.writeFrame(index, width, height, { palette: [...palette, [0, 0, 0]], delay: f.delay, dispose: 1 });
        shown = index;
        continue;
      }
      // Nearly the same color as shown counts as unchanged, which hides dithering noise
      for (let p = 0; p < index.length; p++) {
        if (index[p] === shown[p] || distance(palette[index[p]], palette[shown[p]]) < loss) index[p] = keep;
        else shown[p] = index[p];
      }
      gif.writeFrame(index, width, height, { delay: f.delay, transparent: true, transparentIndex: keep, dispose: 1 });
    }
  }
  gif.finish();
  return gif.bytes();
}

const distance = (a: number[], b: number[]) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

// Pixels of up to count frames spread over the animation, for one palette
function sample(frames: Frame[], count: number): Uint8ClampedArray {
  const picked = frames.filter((_, i) => i % Math.max(1, Math.floor(frames.length / count)) === 0).slice(0, count);
  const out = new Uint8ClampedArray(picked.reduce((n, f) => n + f.rgba.length, 0));
  let at = 0;
  for (const f of picked) { out.set(f.rgba, at); at += f.rgba.length; }
  return out;
}

// Whether any pixel is see-through; opaque animations take the smaller way of encoding
export const hasTransparency = (src: Frames) => src.frames.some(f => { for (let i = 3; i < f.rgba.length; i += 4) if (f.rgba[i] < 128) return true; return false; });

interface Try { width: number; height: number; colors: number; step: number; loss: number }

// Dropping frames shows quickly, so it comes last and never below 8 frames a second
const SLOWEST = 125;

// The best looking GIF under maxBytes. More loss, smaller and fewer colors come first, then every
// other frame, then a shorter animation. A failed try tells roughly how large others with the same
// loss and frames would be, so hopeless ones are skipped.
export function fitGif(src: Frames, sizes: [number, number][], maxBytes: number, transparent = hasTransparency(src)): Uint8Array | null {
  const average = src.frames.reduce((n, f) => n + Math.max(MIN_DELAY, f.delay), 0) / src.frames.length;
  const steps = average * 2 <= SLOWEST ? [1, 2] : [1];
  const tries: Try[] = [];
  for (const step of steps) for (const [width, height] of sizes) for (const loss of [300, 1500, 4000]) for (const colors of [128, 64]) tries.push({ width, height, colors, step, loss });
  // How much loss and dropped frames save depends on the animation (many GIFs change their dither
  // in every frame, which loss hides), so the estimate is kept per loss and step
  const weight = (t: Try) => t.width * t.height * Math.log2(t.colors);
  const rate = new Map<string, number>();
  const kind = (t: Try) => `${t.step}:${t.loss}`;
  const sized = new Map<number, Frames>();
  const at = (t: Try) => {
    if (!sized.has(t.width)) sized.set(t.width, scaled(src, t.width, t.height));
    return sized.get(t.width)!;
  };
  for (const t of tries) {
    const known = rate.get(kind(t));
    if (known !== undefined && known * weight(t) > maxBytes * 1.3) continue;
    const bytes = encodeGif(at(t), t.colors, t.step, transparent, t.loss);
    if (bytes.length <= maxBytes) return bytes;
    rate.set(kind(t), Math.min(known ?? Infinity, bytes.length / weight(t)));
  }
  // Still too large: the beginning, as long as fits
  const last = tries[tries.length - 1];
  const all = at(last);
  let count = all.frames.length;
  while (count > 2) {
    const bytes = encodeGif({ ...all, frames: all.frames.slice(0, count) }, last.colors, last.step, transparent, last.loss);
    if (bytes.length <= maxBytes) return bytes;
    count = Math.min(count - 1, Math.floor(count * Math.max(0.5, maxBytes / bytes.length * 0.95)));
  }
  return null;
}

// ─── Animated WebP ─────────────────────────────────────────────────────────────
// Far better looking than GIF (all colors, soft edges), where the browser encodes still WebP;
// Safari does not, and gets GIF.

let webpSupport: Promise<boolean> | null = null;
export function canEncodeWebp(): Promise<boolean> {
  return webpSupport ??= new Promise(res => {
    const c = document.createElement('canvas');
    c.width = c.height = 2;
    c.toBlob(b => res(b?.type === 'image/webp'), 'image/webp', 0.8);
  });
}

// The smallest rectangle around pixels that differ from what is shown by more than tolerance
export function changedBox(shown: Uint8ClampedArray, next: Uint8ClampedArray, width: number, height: number, tolerance: number): { x: number; y: number; w: number; h: number } | null {
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const a = shown[i + 3], b = next[i + 3];
      const differs = Math.abs(a - b) > tolerance || ((a | b) && (Math.abs(shown[i] - next[i]) > tolerance
        || Math.abs(shown[i + 1] - next[i + 1]) > tolerance || Math.abs(shown[i + 2] - next[i + 2]) > tolerance));
      if (differs) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

function grouped(src: Frames, step: number): Frame[] {
  const frames: Frame[] = [];
  for (let i = 0; i < src.frames.length; i += step) {
    let delay = 0;
    for (let j = i; j < Math.min(src.frames.length, i + step); j++) delay += src.frames[j].delay;
    frames.push({ rgba: src.frames[i].rgba, delay: Math.max(MIN_DELAY, delay) });
  }
  return frames;
}

// Each frame carries only the rectangle that changed; a frame without changes lengthens the one before
export async function encodeWebp(src: Frames, quality: number, step: number, tolerance: number): Promise<Uint8Array> {
  const { width, height } = src;
  const alpha = hasTransparency(src);
  const shown = new Uint8ClampedArray(width * height * 4);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const out: WebpFrame[] = [];
  for (const f of grouped(src, step)) {
    const box = out.length ? changedBox(shown, f.rgba, width, height, tolerance) : { x: 0, y: 0, w: width, h: height };
    if (!box) {
      out[out.length - 1].duration += f.delay;
      continue;
    }
    const x = box.x & ~1, y = box.y & ~1, w = box.x + box.w - x, h = box.y + box.h - y;
    const part = new Uint8ClampedArray(w * h * 4);
    for (let row = 0; row < h; row++) {
      const from = ((y + row) * width + x) * 4;
      part.set(f.rgba.subarray(from, from + w * 4), row * w * 4);
      shown.set(f.rgba.subarray(from, from + w * 4), from);
    }
    canvas.width = w;
    canvas.height = h;
    ctx.putImageData(new ImageData(part, w, h), 0, 0);
    const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/webp', quality));
    if (blob?.type !== 'image/webp') throw new Error('this browser does not encode WebP');
    out.push({ x, y, width: w, height: h, duration: f.delay, still: new Uint8Array(await blob.arrayBuffer()) });
  }
  return writeAnimatedWebp(width, height, alpha, out);
}

// Like fitGif: lower quality, more tolerance and a smaller size first, then every other frame
// (not below 8 fps), then a shorter animation. Quality stays at 0.55 or more except at the
// smallest size.
export async function fitWebp(src: Frames, sizes: [number, number][], maxBytes: number): Promise<Uint8Array | null> {
  const average = src.frames.reduce((n, f) => n + Math.max(MIN_DELAY, f.delay), 0) / src.frames.length;
  const steps = average * 2 <= SLOWEST ? [1, 2] : [1];
  type WebpTry = { width: number; height: number; quality: number; step: number; tolerance: number };
  const tries: WebpTry[] = [];
  for (const step of steps) {
    sizes.forEach(([width, height], i) => {
      const qualities = i === sizes.length - 1 ? [0.85, 0.7, 0.55, 0.4] : [0.85, 0.7, 0.55];
      for (const tolerance of [4, 10]) for (const quality of qualities) tries.push({ width, height, quality, step, tolerance });
    });
  }
  const sized = new Map<number, Frames>();
  const at = (t: WebpTry) => {
    if (!sized.has(t.width)) sized.set(t.width, scaled(src, t.width, t.height));
    return sized.get(t.width)!;
  };
  // Bytes per pixel, kept per setting, since sizes scale about with the pixels
  const rate = new Map<string, number>();
  const kind = (t: WebpTry) => `${t.step}:${t.tolerance}:${t.quality}`;
  for (const t of tries) {
    const known = rate.get(kind(t));
    if (known !== undefined && known * t.width * t.height > maxBytes * 1.3) continue;
    const bytes = await encodeWebp(at(t), t.quality, t.step, t.tolerance);
    if (bytes.length <= maxBytes) return bytes;
    rate.set(kind(t), Math.min(known ?? Infinity, bytes.length / (t.width * t.height)));
  }
  const last = tries[tries.length - 1];
  const all = at(last);
  let count = all.frames.length;
  while (count > 2) {
    const bytes = await encodeWebp({ ...all, frames: all.frames.slice(0, count) }, last.quality, last.step, last.tolerance);
    if (bytes.length <= maxBytes) return bytes;
    count = Math.min(count - 1, Math.floor(count * Math.max(0.5, maxBytes / bytes.length * 0.95)));
  }
  return null;
}
