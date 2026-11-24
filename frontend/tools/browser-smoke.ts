import { chromium } from 'playwright-core';
const base = Bun.env.MUMH5_TEST_URL ?? 'http://127.0.0.1:18080';
const denied = await fetch(`${base}/api/ping`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://unrelated.example' }, body: JSON.stringify({ host: '127.0.0.1', port: 64750 }) });
if (denied.status !== 403) throw new Error('Gateway accepted a foreign browser origin');
const unlisted = await fetch(`${base}/api/ping`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ host: '127.0.0.1', port: 1 }) });
if (unlisted.status !== 400) throw new Error('Gateway accepted an unlisted target');
console.log('PASS gateway origin and target restrictions');
const browser = await chromium.launch({ executablePath: Bun.env.CHROMIUM_PATH ?? '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-gpu', '--mute-audio', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const errors: string[] = [];
try {
 const page = await context.newPage();
 page.on('pageerror', e => errors.push(e.message));
 await page.route('https://**/*', route => route.abort());
 await page.goto(base);
 await page.getByRole('button', { name: /Create a new identity/ }).click();
 await page.getByLabel('Name', { exact: true }).fill('browser-smoke');
 await page.getByRole('button', { name: 'Create', exact: true }).click();
 await page.getByRole('button', { name: 'Skip for now' }).click();
 await page.getByRole('button', { name: 'Done', exact: true }).click();
 const layout = await page.locator('.app').evaluate(el => getComputedStyle(el).display);
 if (layout !== 'flex') throw new Error(`Component CSS missing: app display=${layout}`);
 console.log('PASS styled browser identity wizard backed by Rust');
 await page.getByRole('button', { name: 'Add a server', exact: true }).click();
 await page.getByLabel('Username', { exact: true }).fill('browser-smoke');
 await page.getByRole('button', { name: 'Save and connect' }).click();
 await page.getByText('Root', { exact: true }).first().waitFor();
 console.log('PASS Rust WebSocket/TLS gateway and rendered channel tree');
 // Chat is reached through the room in the Stacked layout.
 const chat = page.locator('[contenteditable=true]').first();
 if (!await chat.isVisible()) {
  console.log('Navigation:', await page.locator('button').evaluateAll(buttons => buttons.map(b => ({ text: b.textContent?.trim(), title: b.title, label: b.getAttribute('aria-label') }))));
  const tab = page.getByRole('button', { name: /Chat/ }).first(); if (await tab.count()) await tab.click();
 }
 await chat.fill('mumh5 browser integration message'); await chat.press('Enter');
 await page.locator('.msg').filter({ hasText: 'mumh5 browser integration message' }).waitFor();
 console.log('PASS send chat and render message');
 const pins = await page.evaluate(() => localStorage.getItem('mumh5.pins'));
 if (!pins?.includes('127.0.0.1')) throw new Error('TOFU certificate pin was not stored');
 const save = await page.evaluate(() => JSON.parse(localStorage.getItem('mumh5.settings') ?? '{}').saveChatHistory);
 if (save === true) throw new Error('Chat saving must be opt in');
 console.log('PASS server pin persistence and chat history opt in');
 const wave = new Uint8Array(44 + 9600); const view = new DataView(wave.buffer);
 const ascii = (at: number, text: string) => wave.set(new TextEncoder().encode(text), at);
 ascii(0, 'RIFF'); view.setUint32(4, wave.length - 8, true); ascii(8, 'WAVEfmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 48000, true); view.setUint32(28, 96000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); ascii(36, 'data'); view.setUint32(40, 9600, true);
 let pdf = '%PDF-1.4\n'; const offsets = [0];
 const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 150] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>', '<< /Length 45 >>\nstream\nBT /F1 12 Tf 10 100 Td (mumh5 PDF) Tj ET\nendstream', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
 objects.forEach((obj, n) => { offsets.push(pdf.length); pdf += `${n + 1} 0 obj\n${obj}\nendobj\n`; });
 const xref = pdf.length; pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10, '0')} 00000 n `).join('\n')}\ntrailer << /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
 await page.locator('input[type=file][multiple]').setInputFiles([{ name: 'sample.wav', mimeType: 'audio/wav', buffer: Buffer.from(wave) }, { name: 'sample.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pdf) }]);
 const audioCard = page.locator('.media-card').filter({ has: page.locator('.name', { hasText: 'sample.wav' }) });
 await audioCard.locator('.media-player').waitFor(); await audioCard.getByRole('link', { name: 'Download sample.wav', exact: true }).waitFor();
 const pdfCard = page.locator('.media-card').filter({ has: page.locator('.name', { hasText: 'sample.pdf' }) });
 await pdfCard.locator('canvas:not([hidden])').waitFor(); await pdfCard.getByRole('link', { name: 'Download sample.pdf', exact: true }).waitFor();
 console.log('PASS unified audio card, download controls and rendered PDF preview');
 await page.setViewportSize({ width: 390, height: 844 });
 if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) throw new Error('Phone layout overflows horizontally');
 console.log('PASS responsive phone layout');
 await page.setViewportSize({ width: 1280, height: 800 });

 await page.screenshot({ path: `${new URL('../../', import.meta.url).pathname}.tooling/browser-smoke.png` });
 if (errors.length) throw new Error(errors.join('\n'));
 console.log('PASS browser smoke');
} finally { await browser.close(); }
