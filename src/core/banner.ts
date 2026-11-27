// The banner on a profile card: a color, a picture, or both. Like the display name it travels in
// the owner's comment as an empty image other clients show as nothing:
// <img src="data:,mumh5banner:<rrggbb or nothing>:<picture as base64url or nothing>" width="0" height="0"/>
// Murmur does not count data: sources against the text limit, so the picture only has to fit the
// image message limit.
import { stripDisplayName } from './display-name.ts';

export interface Banner { color: string; image: Uint8Array | null }

// Every client downloads the comments of everyone on the server, so the picture stays small
export const MAX_BANNER_BYTES = 24 * 1024;

const ONE = /<img\b[^>]*\bsrc="data:,mumh5banner:([0-9a-fA-F]{6})?:([A-Za-z0-9_-]*)"[^>]*>/;
const ALL = new RegExp(ONE.source, 'g');

export const stripBanner = (comment: string) => comment.replace(ALL, '');

// The comment as people should read it, without what mumh5 hides in it
export const stripProfileMarks = (comment: string) => stripBanner(stripDisplayName(comment));

function toB64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64Url(text: string): Uint8Array {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

// Only formats every browser shows; anything else in someone's comment is ignored
export function imageType(b: Uint8Array): string | null {
  if (b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
    && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  return null;
}

export function cleanColor(raw: string): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(raw.trim());
  return m ? `#${m[1].toLowerCase()}` : '';
}

// The marker for a banner, '' for none (the card then keeps its color made from the name)
export function bannerMark(banner: Banner): string {
  const color = cleanColor(banner.color).slice(1);
  const image = banner.image && banner.image.length <= MAX_BANNER_BYTES && imageType(banner.image) ? toB64Url(banner.image) : '';
  if (!color && !image) return '';
  return `<img src="data:,mumh5banner:${color}:${image}" width="0" height="0"/>`;
}

export function withBanner(comment: string, mark: string): string {
  return stripBanner(comment) + mark;
}

// Comes from other people's comments: only a checked color and a picture of a known format pass
export function parseBanner(comment: string): Banner | null {
  const m = ONE.exec(comment);
  if (!m) return null;
  const color = m[1] ? `#${m[1].toLowerCase()}` : '';
  let image: Uint8Array | null = null;
  if (m[2]) {
    try {
      const bytes = fromB64Url(m[2]);
      if (bytes.length <= MAX_BANNER_BYTES && imageType(bytes)) image = bytes;
    } catch { /* not base64 */ }
  }
  return color || image ? { color, image } : null;
}

// A data: URL is fine for pictures under the CSP and needs no cleanup like an object URL
export function bannerImageUrl(image: Uint8Array): string {
  const b64 = toB64Url(image).replace(/-/g, '+').replace(/_/g, '/');
  return `data:${imageType(image)};base64,${b64}${'='.repeat((4 - b64.length % 4) % 4)}`;
}
