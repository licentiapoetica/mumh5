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
  // Small enough as it is: send the original
  const original = await originalImage(file, maxChars);
  if (original) return original;
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

// The original picture as a data URI when it fits as it is (keeps GIF animation, PNG transparency)
export async function originalImage(file: File, maxChars: number): Promise<string | null> {
  if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type) || Math.ceil(file.size / 3) * 4 + 40 >= maxChars) return null;
  return readDataUrl(file);
}

// A still from a video as a JPEG data URI that fits in maxChars, for the announcement
export async function videoPoster(file: Blob, maxChars: number): Promise<string | null> {
  if (maxChars < 2000) return null;
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  const wait = (event: string) => new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), 8000);
    video.addEventListener(event, () => { clearTimeout(timer); resolve(); }, { once: true });
    video.addEventListener('error', () => { clearTimeout(timer); reject(new Error('undecodable')); }, { once: true });
  });
  try {
    video.muted = true;
    video.preload = 'auto';
    video.src = url;
    await wait('loadeddata');
    // A moment in, past a black first frame
    const at = Number.isFinite(video.duration) ? Math.min(1, video.duration / 10) : 0;
    if (at > 0) {
      video.currentTime = at;
      await wait('seeked');
    }
    for (const size of [640, 480, 320, 200]) {
      const scale = Math.min(1, size / Math.max(video.videoWidth, video.videoHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);
      for (const q of [0.8, 0.6, 0.45]) {
        const uri = canvas.toDataURL('image/jpeg', q);
        if (uri.length < maxChars) return uri;
      }
    }
  } catch { /* not a video this browser can decode */ } finally {
    video.removeAttribute('src');
    URL.revokeObjectURL(url);
  }
  return null;
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


// A profile picture: square, cut from the middle, small enough for the server's image limit.
// PNG keeps transparency when it fits; otherwise JPEG on a dark background. Both formats are
// ones the desktop Mumble client can show.
export async function makeAvatar(file: Blob, maxBytes: number): Promise<Uint8Array | null> {
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const encode = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
    new Promise<Blob | null>(res => canvas.toBlob(res, type, quality));
  try {
    for (const size of [256, 192, 128, 96]) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = Math.min(size, side);
      const ctx = canvas.getContext('2d')!;
      ctx.imageSmoothingQuality = 'high';
      const draw = () => ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, canvas.width, canvas.height);
      draw();
      const png = await encode(canvas, 'image/png');
      if (png && png.size <= maxBytes && png.size <= 96 * 1024) return new Uint8Array(await png.arrayBuffer());
      ctx.fillStyle = '#1a1b1f';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      draw();
      for (const quality of [0.88, 0.75, 0.6]) {
        const jpeg = await encode(canvas, 'image/jpeg', quality);
        if (jpeg && jpeg.size <= maxBytes) return new Uint8Array(await jpeg.arrayBuffer());
      }
    }
    return null;
  } finally {
    bmp.close();
  }
}
