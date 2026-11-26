// Unified uploaded/linked media, PDF rendering and privacy; no Mumble server needed.
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import assert from 'node:assert/strict';

function pdf(): string {
  const stream = '0.15 0.4 0.7 rg 20 20 160 100 re f';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 150] /Resources << >> /Contents 4 0 R >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let result = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((body, i) => { offsets.push(result.length); result += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const start = result.length;
  result += `xref\n0 5\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}`;
  return result + `trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
}

const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium', headless: true });
try {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem('mumh5.identities', JSON.stringify({ identities: [], defaultId: null, setupDone: true })));
  const hits: string[] = [];
  await page.context().route('http://media.example/**', route => {
    hits.push(route.request().url());
    return route.fulfill({ status: 404, body: '' });
  });
  await page.goto(server.resolvedUrls!.local[0]);
  await page.evaluate(async pdf => {
    const sessionPath = '/src/lib/session.svelte.ts', filePath = '/src/lib/files.svelte.ts', htmlPath = '/src/lib/html.ts', settingsPath = '/src/lib/settings.svelte.ts';
    const { session } = await import(sessionPath);
    const { files } = await import(filePath);
    const { renderIncoming } = await import(htmlPath);
    const { store } = await import(settingsPath);
    store.settings.arrangement = 'side';
    store.settings.autoDownload = 0;
    const canvas = document.createElement('canvas');
    canvas.width = 240; canvas.height = 160;
    canvas.getContext('2d')!.fillRect(20, 20, 100, 80);
    const picture = canvas.toDataURL('image/png');
    const imageBlob = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), 'image/png'));
    const wav = new Uint8Array(44 + 8000), view = new DataView(wav.buffer);
    wav.set(new TextEncoder().encode('RIFF'), 0); view.setUint32(4, wav.length - 8, true);
    wav.set(new TextEncoder().encode('WAVEfmt '), 8); view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 8000, true); view.setUint32(28, 8000, true);
    view.setUint16(32, 1, true); view.setUint16(34, 8, true); wav.set(new TextEncoder().encode('data'), 36); view.setUint32(40, 8000, true); wav.fill(128, 44);
    const stream = canvas.captureStream(10), recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
    const chunks: Blob[] = [];
    recorder.ondataavailable = event => chunks.push(event.data);
    const stopped = new Promise<void>(resolve => { recorder.onstop = () => resolve(); });
    recorder.start();
    canvas.getContext('2d')!.fillRect(30, 30, 40, 40);
    await new Promise(resolve => setTimeout(resolve, 200));
    recorder.stop(); await stopped; stream.getTracks().forEach(track => track.stop());
    const specimens = [
      ['song.wav', 'audio/wav', new Blob([wav], { type: 'audio/wav' })],
      ['photo.png', 'image/png', imageBlob],
      ['movie.webm', 'video/webm', new Blob(chunks, { type: 'video/webm' })],
      ['report.pdf', 'application/pdf', new Blob([pdf], { type: 'application/octet-stream' })],
      ['unnamed-type.pdf', 'application/octet-stream', new Blob([pdf])],
      ['broken.pdf', 'application/pdf', new Blob(['broken'])],
      ['notes.docx', 'application/octet-stream', new Blob(['document contents'])],
      ['unsafe.html', 'text/html', new Blob(['<script>window.__unsafeRan=true</script>'])]
    ] as const;
    const embeds = specimens.map(([name, mime, blob], index) => {
      const meta = { i: `fixture-${index}`, n: name, m: mime, s: blob.size, h: '', p: [] };
      files.transfers[meta.i] = { state: 'ready', got: blob.size, url: URL.createObjectURL(blob), error: '', rate: 0, sources: 0 };
      return { kind: 'file', url: `file:${meta.i}`, name, file: meta };
    });
    const inline = renderIncoming(`<p>Inline picture</p><img src="${picture}" alt="pasted.png"/>`, [], true);
    const description = renderIncoming(`<img src="${picture}"/>`, []);
    if (!description.html.includes('<img')) throw new Error('Description images must stay inline');
    store.settings.mediaLinks = 'off';
    session.logs = { 'ch:0': [
      { id: 1, kind: 'text', author: 'Test', authorSession: null, self: true, time: Date.now(), reactions: [], html: 'Uploaded files', embeds },
      { id: 2, kind: 'text', author: 'Test', authorSession: null, self: true, time: Date.now(), reactions: [], ...inline }
    ] };
    session.status = 'connected';
  }, pdf());
  const card = (name: string) => page.locator('.media-card').filter({ has: page.locator('.name', { hasText: name }) });
  await card('report.pdf').getByText('Page 1 of 1', { exact: true }).waitFor();
  await card('unnamed-type.pdf').getByText('Page 1 of 1', { exact: true }).waitFor();
  await card('broken.pdf').getByText('Preview unavailable. Download to open this PDF.').waitFor();
  const pixels = await card('report.pdf').locator('canvas').evaluate(canvas => {
    const c = canvas as HTMLCanvasElement;
    const pixel = c.getContext('2d')!.getImageData(c.width / 2, c.height / 2, 1, 1).data;
    return { blue: pixel[2] > pixel[0] + 50, height: c.getBoundingClientRect().height };
  });
  assert.ok(pixels.blue && pixels.height <= 300, 'PDF preview renders real page pixels in a small window');
  await page.waitForFunction(() => (document.querySelector('audio')?.duration ?? 0) >= 1);
  await page.waitForFunction(() => (document.querySelector('video')?.videoWidth ?? 0) > 0);
  for (const name of ['song.wav', 'movie.webm']) {
    const player = card(name);
    assert.equal(await player.locator('audio[controls], video[controls]').count(), 0, 'browser controls are replaced by themed controls');
    await player.getByRole('button', { name: `Play ${name}`, exact: true }).click();
    await player.getByRole('button', { name: `Pause ${name}`, exact: true }).click();
    await player.getByRole('button', { name: `Mute ${name}`, exact: true }).click();
    assert.equal(await player.locator('audio, video').evaluate(el => (el as HTMLMediaElement).muted), true);
    await player.getByRole('slider', { name: `Volume for ${name}`, exact: true }).fill('0.4');
    assert.equal(await player.locator('audio, video').evaluate(el => (el as HTMLMediaElement).volume), 0.4);
  }
  await card('song.wav').getByRole('slider', { name: 'Seek in song.wav', exact: true }).fill('0.5');
  await page.waitForFunction(() => document.querySelector('audio')!.currentTime >= 0.49);
  for (const name of ['song.wav', 'photo.png', 'movie.webm', 'report.pdf', 'notes.docx', 'unsafe.html', 'pasted.png']) {
    await card(name).getByRole('link', { name: `Download ${name}`, exact: true }).waitFor();
  }
  assert.equal(await card('notes.docx').locator('iframe, canvas, audio, video').count(), 0);
  assert.equal(await page.evaluate(() => (window as any).__unsafeRan), undefined);
  const download = page.waitForEvent('download');
  await card('notes.docx').getByRole('link', { name: 'Download notes.docx', exact: true }).click();
  assert.equal((await download).suggestedFilename(), 'notes.docx');
  await card('pasted.png').locator('img').click();
  await page.getByRole('dialog', { name: 'Image', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Close image', exact: true }).click();
  console.log('ok: shared audio, video, pictures, inline pictures, PDFs and documents use unified cards');
  await page.evaluate(async () => {
    const sessionPath = '/src/lib/session.svelte.ts', htmlPath = '/src/lib/html.ts', settingsPath = '/src/lib/settings.svelte.ts';
    const { session } = await import(sessionPath);
    const { renderIncoming } = await import(htmlPath);
    const { store } = await import(settingsPath);
    store.settings.mediaLinks = 'click';
    session.logs['ch:0'].push({ id: 3, kind: 'text', author: 'Test', authorSession: null, self: true, time: Date.now(), reactions: [],
      ...renderIncoming('<a href="http://media.example/remote.png">remote.png</a>', []) });
  });
  await card('remote.png').locator('.load').waitFor();
  assert.deepEqual(hits, [], 'untrusted media loads nothing before a click');
  await card('remote.png').locator('.load').click();
  await card('remote.png').getByText('Could not load preview').waitFor();
  await card('remote.png').getByRole('link', { name: 'Open remote.png', exact: true }).waitFor();
  assert.equal(hits.length, 1, 'click loads only the selected remote media');
  const remoteImage = await card('pasted.png').locator('img').getAttribute('src');
  await page.context().route('http://media.example/open.png', route => route.fulfill({
    contentType: 'image/png', body: Buffer.from(remoteImage!.split(',')[1], 'base64')
  }));
  await page.evaluate(async () => {
    const sessionPath = '/src/lib/session.svelte.ts', htmlPath = '/src/lib/html.ts';
    const { session } = await import(sessionPath);
    const { renderIncoming } = await import(htmlPath);
    session.logs['ch:0'].push({ id: 4, kind: 'text', author: 'Test', authorSession: null, self: true, time: Date.now(), reactions: [],
      ...renderIncoming('<a href="http://media.example/open.png">open.png</a>', []) });
  });
  const remote = card('open.png');
  assert.equal(await remote.locator('a.save').count(), 0, 'unloaded remote media has no open action');
  await remote.locator('.load').click();
  await remote.locator('img').evaluate(img => (img as HTMLImageElement).decode());
  const open = remote.getByRole('link', { name: 'Open open.png', exact: true });
  assert.equal(await open.getAttribute('download'), null, 'remote actions do not promise a browser download');
  assert.equal(await remote.getByRole('link', { name: 'Download open.png', exact: true }).count(), 0);
  const popup = page.waitForEvent('popup');
  await open.click();
  const media = await popup;
  await media.waitForLoadState();
  assert.equal(media.url(), 'http://media.example/open.png');
  assert.equal(await media.evaluate(() => document.contentType), 'image/png', 'remote action opens actual cross-origin media');
  await media.close();
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 800 });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(null)))));
    const overflow = await page.locator('.media-card').evaluateAll(cards => Math.max(...cards.map(el => el.scrollWidth - el.clientWidth)));
    assert.ok(overflow < 2, `cards fit at ${width}px`);
  }
  assert.deepEqual(errors, []);
  console.log('ok: local download, remote open, image zoom, PDF failure, remote privacy and responsive cards');
} finally {
  await browser.close();
  await server.close();
}
