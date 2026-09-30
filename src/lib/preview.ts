import { native, type LinkPreviewData } from './native.ts';
import { store } from './settings.svelte.ts';

// One request per URL and mode per app run
const cache = new Map<string, Promise<LinkPreviewData | null>>();

export function linkPreview(url: string): Promise<LinkPreviewData | null> {
  const { linkPreviews, uploadHost, uploadKey } = store.settings;
  const mode = linkPreviews === 'host' && !(uploadHost && uploadKey) ? 'off' : linkPreviews;
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
