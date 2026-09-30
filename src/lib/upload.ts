export interface UploadResult {
  url: string;
  name: string;
  mime: string;
  inline: boolean;
  size: number;
  expires_at: number;
  delete_token: string;
}

export interface UploadInfo {
  allowed_mimes: string[];
  allowed_extensions: string[];
  max_bytes: number;
}

const endpoint = (host: string) => host.replace(/\/+$/, '') + '/api/chat/upload';

// Allowed types and limits of the upload host; also serves as a key check.
export async function fetchUploadInfo(host: string, key: string): Promise<UploadInfo> {
  const r = await fetch(endpoint(host), { headers: { 'X-API-Key': key } });
  const body = await r.json().catch(() => null);
  if (r.status === 401) throw new Error('Key rejected');
  if (!r.ok || !body?.success) throw new Error(body?.msg || `Unexpected response (HTTP ${r.status})`);
  return body;
}

// Client-side pre-check; the host verifies the real type again after upload
export function checkFile(info: UploadInfo, file: File): string | null {
  const ext = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase() ?? '';
  const typeOk = file.type ? info.allowed_mimes.includes(file.type) : info.allowed_extensions.includes(ext);
  if (!typeOk) return `${file.name}: file type not allowed on this upload host`;
  if (file.size > info.max_bytes) return `${file.name}: too large (max ${Math.round(info.max_bytes / 1048576)} MB)`;
  return null;
}

// Value for <input type=file accept>
export function acceptAttr(info: UploadInfo | null): string {
  if (!info) return '';
  return [...info.allowed_mimes, ...info.allowed_extensions.map(e => '.' + e)].join(',');
}

// Upload one file to a f0ckm chat-upload endpoint. XHR instead of fetch for upload progress.
export function uploadFile(
  host: string, key: string, file: File, expiry: string, onProgress: (fraction: number) => void
): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', endpoint(host));
    xhr.setRequestHeader('X-API-Key', key);
    xhr.setRequestHeader('X-Filename', encodeURIComponent(file.name));
    xhr.setRequestHeader('X-Upload-Expiry', expiry);
    if (file.type) xhr.setRequestHeader('Content-Type', file.type);
    xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.onerror = () => reject(new Error('Network error'));
    xhr.onload = () => {
      let body: any = null;
      try { body = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
      if (xhr.status === 200 && body?.success) resolve(body);
      else reject(new Error(body?.msg || `Upload failed (HTTP ${xhr.status})`));
    };
    xhr.send(file);
  });
}

const readDataUrl = (file: Blob) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result));
  r.onerror = () => reject(r.error);
  r.readAsDataURL(file);
});

// JPEG data URI of an image, scaled down until it fits in maxChars. Mumble clients render
// inline data: images, which is also how the desktop client sends pasted pictures.
export async function makeInlineImage(file: File, maxChars: number, sizes = [1280, 1024, 800, 640, 480, 320, 200, 120]): Promise<string | null> {
  if (!/^image\/(png|jpeg|gif|webp|avif|bmp)$/.test(file.type) || maxChars < 2000) return null;
  // Small enough as it is: send the original (keeps GIF animation and PNG transparency)
  if (/^image\/(png|jpeg|gif|webp)$/.test(file.type) && Math.ceil(file.size / 3) * 4 + 40 < maxChars) {
    return readDataUrl(file);
  }
  try {
    const bmp = await createImageBitmap(file);
    for (const size of sizes) {
      const scale = Math.min(1, size / Math.max(bmp.width, bmp.height));
      if (scale === 1 && size !== sizes[0] && Math.max(bmp.width, bmp.height) < size) continue;
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bmp.width * scale));
      canvas.height = Math.max(1, Math.round(bmp.height * scale));
      canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
      for (const q of [0.85, 0.7, 0.5]) {
        const uri = canvas.toDataURL('image/jpeg', q);
        if (uri.length < maxChars) return uri;
      }
    }
  } catch { /* undecodable image */ }
  return null;
}

// Small preview next to an f0ckm link, for vanilla Mumble clients
export function makeThumbnail(file: File, maxChars: number): Promise<string | null> {
  return makeInlineImage(file, maxChars, [320, 200, 120]);
}

// Square server icon: center-cropped, scaled to 128x128, as a small WebP data URI
export async function makeServerIcon(file: File, size = 128): Promise<string> {
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, size, size);
  bmp.close();
  const webp = canvas.toDataURL('image/webp', 0.85);
  // Browsers without WebP encoding fall back to PNG
  return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/png');
}

