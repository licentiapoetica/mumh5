// Check the emitted PDF module/worker over HTTP and Electron's file:// origin.
import { chromium, _electron as electron, type Page } from 'playwright-core';
import electronPath from 'electron';
import { build, preview } from 'vite';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const temp = await mkdtemp(path.join(tmpdir(), 'mumh5-pdf-build-'));
const fixture = path.resolve(`.pdf-build-${path.basename(temp)}.html`);
const output = path.join(temp, 'dist');
try {
  const csp = (await readFile('index.html', 'utf8')).match(/<meta http-equiv="Content-Security-Policy"[^>]+>/)![0];
  // An inline script is deliberately avoided, just as in the app's CSP.
  const modulePath = fixture.replace(/\.html$/, '.ts');
  await writeFile(modulePath, `import { mount } from '/node_modules/svelte/src/index-client.js';
import PdfPreview from '/src/ui/PdfPreview.svelte';
const pdf = '%PDF-1.4\\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\\n3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 200 150] /Resources << >> /Contents 4 0 R >> endobj\\n4 0 obj << /Length 38 >> stream\\n0.15 0.4 0.7 rg 20 20 160 100 re f\\nendstream endobj\\ntrailer << /Root 1 0 R >>\\n%%EOF';
mount(PdfPreview, { target: document.body, props: { name: 'production.pdf', url: URL.createObjectURL(new Blob([pdf])) } });`);
  await writeFile(fixture, `<!doctype html><html><head>${csp}</head><body><script type="module" src="./${path.basename(modulePath)}"></script></body></html>`);
  try {
    await build({ logLevel: 'error', build: { outDir: output, emptyOutDir: true, rolldownOptions: { input: fixture } } });
  } finally {
    await rm(modulePath, { force: true });
    await rm(fixture, { force: true });
  }
  async function check(page: Page) {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.getByText('Page 1 of 1', { exact: true }).waitFor();
    const blue = await page.locator('canvas').evaluate(canvas => {
      const c = canvas as HTMLCanvasElement;
      const p = c.getContext('2d')!.getImageData(c.width / 2, c.height / 2, 1, 1).data;
      return p[2] > p[0] + 50;
    });
    assert.ok(blue, 'production worker renders PDF page pixels');
    assert.deepEqual(errors, []);
  }
  const server = await preview({ logLevel: 'error', build: { outDir: output }, preview: { host: '127.0.0.1', port: 0 } });
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium', headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`${server.resolvedUrls!.local[0]}${path.basename(fixture)}`);
    await check(page);
    console.log('ok: production PDF preview over HTTP');
  } finally {
    await browser.close();
    await new Promise<void>(resolve => server.httpServer.close(() => resolve()));
  }
  const shell = path.join(temp, 'shell.cjs');
  await writeFile(shell, `const { app, BrowserWindow } = require('electron');
app.whenReady().then(() => { const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } }); win.loadFile(process.env.MUMH5_PDF_FILE); });
app.on('window-all-closed', () => app.quit());`);
  const { ELECTRON_RUN_AS_NODE, WAYLAND_DISPLAY, XDG_SESSION_TYPE, ...env } = process.env;
  const app = await electron.launch({ executablePath: electronPath as unknown as string,
    args: [shell, `--user-data-dir=${path.join(temp, 'profile')}`, '--ozone-platform=x11'],
    env: { ...env, MUMH5_PDF_FILE: path.join(output, path.basename(fixture)) } as Record<string, string> });
  try {
    await check(await app.firstWindow());
    console.log('ok: production PDF preview in hidden Electron window over file://');
  } finally { await app.close(); }
} finally {
  await rm(fixture, { force: true });
  await rm(temp, { recursive: true, force: true });
}
