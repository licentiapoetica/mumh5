// Animated WebP from still ones. Browsers encode still WebP (canvas.toBlob) but no animation, so
// each frame is encoded on its own and its bitstream chunks are put into ANMF frames:
// RIFF WEBP, VP8X (animation, alpha), ANIM (loop forever), one ANMF per frame.
// https://developers.google.com/speed/webp/docs/riff_container

export interface WebpFrame {
  x: number; y: number; width: number; height: number;  // x and y even, as the format stores them halved
  duration: number;  // ms
  still: Uint8Array;  // a still WebP of this rectangle, as canvas.toBlob makes it
}

const fourcc = (b: Uint8Array, at: number) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);
const u32 = (b: Uint8Array, at: number) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;

// The image data chunks of a still WebP (ALPH, VP8 , VP8L), headers and padding included
export function bitstreamChunks(still: Uint8Array): Uint8Array {
  if (still.length < 20 || fourcc(still, 0) !== 'RIFF' || fourcc(still, 8) !== 'WEBP') throw new Error('not a WebP');
  const parts: Uint8Array[] = [];
  for (let at = 12; at + 8 <= still.length;) {
    const size = u32(still, at + 4);
    const end = at + 8 + size + (size & 1);
    if (end > still.length + (size & 1)) throw new Error('broken WebP');
    if (['ALPH', 'VP8 ', 'VP8L'].includes(fourcc(still, at))) parts.push(still.subarray(at, Math.min(end, still.length)));
    at = end;
  }
  if (!parts.some(p => fourcc(p, 0) !== 'ALPH')) throw new Error('no image in WebP');
  return concat(parts);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

class Writer {
  bytes: number[] = [];
  u8(v: number) { this.bytes.push(v & 255); }
  u16(v: number) { this.u8(v); this.u8(v >> 8); }
  u24(v: number) { this.u16(v); this.u8(v >> 16); }
  u32(v: number) { this.u16(v); this.u16(v >>> 16); }
  tag(s: string) { for (const c of s) this.u8(c.charCodeAt(0)); }
}

function chunk(tag: string, body: Uint8Array): Uint8Array {
  const w = new Writer();
  w.tag(tag);
  w.u32(body.length);
  const head = Uint8Array.from(w.bytes);
  return concat(body.length & 1 ? [head, body, new Uint8Array(1)] : [head, body]);
}

export function writeAnimatedWebp(width: number, height: number, alpha: boolean, frames: WebpFrame[]): Uint8Array {
  const vp8x = new Writer();
  vp8x.u8(0x02 | (alpha ? 0x10 : 0));
  vp8x.u24(0);
  vp8x.u24(width - 1);
  vp8x.u24(height - 1);
  const anim = new Writer();
  anim.u32(0);  // background, which browsers ignore
  anim.u16(0);  // loop forever
  const parts = [chunk('VP8X', Uint8Array.from(vp8x.bytes)), chunk('ANIM', Uint8Array.from(anim.bytes))];
  for (const f of frames) {
    const head = new Writer();
    head.u24(f.x >> 1);
    head.u24(f.y >> 1);
    head.u24(f.width - 1);
    head.u24(f.height - 1);
    head.u24(Math.min(0xffffff, Math.round(f.duration)));
    // Not blended: the rectangle replaces what was there, see-through parts included. Not disposed.
    head.u8(0x02);
    parts.push(chunk('ANMF', concat([Uint8Array.from(head.bytes), bitstreamChunks(f.still)])));
  }
  const body = concat(parts);
  const riff = new Writer();
  riff.tag('RIFF');
  riff.u32(body.length + 4);
  riff.tag('WEBP');
  return concat([Uint8Array.from(riff.bytes), body]);
}
