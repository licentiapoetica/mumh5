import { desktop, type LinkPreviewData } from './native.ts';
import { store } from './settings.svelte.ts';

// One request per URL per app run
const cache = new Map<string, Promise<LinkPreviewData | null>>();

// The mode in effect. Fetching needs the desktop app (a web page cannot read other sites);
// an older stored choice ("through the upload host") counts as off, never as fetching directly.
export function previewMode(): 'direct' | 'off' {
  return store.settings.linkPreviews === 'direct' && desktop ? 'direct' : 'off';
}

export function linkPreview(url: string): Promise<LinkPreviewData | null> {
  if (previewMode() === 'off') return Promise.resolve(null);
  let p = cache.get(url);
  if (!p) {
    p = (desktop?.linkPreview(url) ?? Promise.resolve(null)).catch(() => null);
    cache.set(url, p);
  }
  return p;
}
