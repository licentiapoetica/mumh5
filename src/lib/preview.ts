import { native, type LinkPreviewData } from './native.ts';
import { store } from './settings.svelte.ts';

// One request per URL and mode per app run
const cache = new Map<string, Promise<LinkPreviewData | null>>();

// The mode in effect: previews through the upload host need its key, without one they are off.
// Never falls back to fetching directly, that would show linked sites the user's IP.
export function previewMode(): 'host' | 'direct' | 'off' {
  const { linkPreviews, uploadHost, uploadKey } = store.settings;
  return linkPreviews === 'host' && !(uploadHost && uploadKey) ? 'off' : linkPreviews;
}

export function linkPreview(url: string): Promise<LinkPreviewData | null> {
  const { uploadHost, uploadKey } = store.settings;
  const mode = previewMode();
  if (mode === 'off') return Promise.resolve(null);
  const id = `${mode}|${url}`;
  let p = cache.get(id);
  if (!p) {
    p = mode === 'direct'
      ? (native?.linkPreview(url) ?? Promise.resolve(null)).catch(() => null)
      : fetch(`${uploadHost.replace(/\/+$/, '')}/api/chat/preview?url=${encodeURIComponent(url)}`, { headers: { 'X-API-Key': uploadKey } })
          .then(r => r.json())
          .then(d => (d?.success ? d as LinkPreviewData : null))
          .catch(() => null);
    cache.set(id, p);
  }
  return p;
}
