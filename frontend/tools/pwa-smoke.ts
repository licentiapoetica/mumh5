// Checks the installable web build on a running gateway, directly and behind a path prefix:
// global theme/font styles, every precached asset (workers, worklets, PDF, audio, WASM),
// service-worker scope, offline reload and the deployed-build marker used for update checks.
//   MUMH5_TEST_URL=http://127.0.0.1:18080 bun tools/pwa-smoke.ts
import { chromium, type Browser } from 'playwright-core';

const upstream = new URL(Bun.env.MUMH5_TEST_URL ?? 'http://127.0.0.1:18080');
const prefix = '/mumh5/';

// A reverse proxy that serves the gateway below a subpath, as an operator's nginx would.
const proxy = Bun.serve({
  port: 0,
  hostname: '127.0.0.1',
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/mumh5') return Response.redirect(prefix, 301);
    if (!url.pathname.startsWith(prefix)) return new Response('outside prefix', { status: 404 });
    const target = new URL(url.pathname.slice(prefix.length - 1) + url.search, upstream);
    const headers = new Headers(req.headers);
    headers.set('host', upstream.host);
    headers.delete('origin');
    return fetch(target, { method: req.method, headers, body: req.body, redirect: 'manual' });
  }
});

async function check(browser: Browser, base: string) {
  const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 800 } });
  const failures: string[] = [];
  try {
    const page = await context.newPage();
    page.on('console', m => { if (Bun.env.DEBUG) console.log('console:', m.text()); });
    page.on('pageerror', e => failures.push(`page error: ${e.message}`));
    page.on('response', r => { if (r.status() >= 400 && !r.url().includes('/api/')) failures.push(`${r.status()} ${r.url()}`); });
    await page.route(url => !url.href.startsWith(base), route => route.abort());
    await page.goto(base);
    await page.locator('.app').waitFor();

    const style = await page.evaluate(async () => {
      await document.fonts.ready;
      const root = getComputedStyle(document.documentElement);
      return { font: getComputedStyle(document.body).fontFamily, inter: document.fonts.check('16px "Inter Variable"'), bg: root.getPropertyValue('--bg-0').trim(), display: getComputedStyle(document.querySelector('.app')!).display };
    });
    if (!style.font.includes('Inter') || !style.inter) throw new Error(`Bundled Inter font not applied: ${JSON.stringify(style)}`);
    if (!/^#[0-9a-f]{6}$/i.test(style.bg) || style.display !== 'flex') throw new Error(`Global theme/component styles missing: ${JSON.stringify(style)}`);
    console.log(`PASS ${base} global theme, component styles and bundled font`);

    const scope = await page.evaluate(() => Promise.race([
      navigator.serviceWorker.ready.then(r => r.scope),
      new Promise<string>(resolve => setTimeout(async () => resolve(`not ready; registrations=${(await navigator.serviceWorker.getRegistrations()).length}`), 15000))
    ]));
    if (scope !== base) throw new Error(`Service worker scope ${scope}, expected ${base}`);
    const files = await page.evaluate(async () => {
      const sw = await (await fetch('./sw.js')).text();
      const list: string[] = JSON.parse(sw.match(/const FILES = (\[.*?\]);/s)![1]);
      const bad: string[] = [];
      for (const f of list) { const r = await fetch(f); if (!r.ok) bad.push(`${r.status} ${f}`); }
      return { count: list.length, bad, kinds: ['worklet', 'worker', 'pdf.worker', '.wasm', 'audio-pack'].filter(k => !list.some(f => f.includes(k))) };
    });
    if (files.bad.length || files.kinds.length) throw new Error(`Precache problems: ${JSON.stringify(files)}`);
    console.log(`PASS ${base} service worker scope and ${files.count} precached assets (workers, worklets, PDF, WASM, audio)`);

    const marker = await page.evaluate(async () => {
      const meta = document.querySelector<HTMLMetaElement>('meta[name="mumh5-build"]')?.content;
      const served = (await (await fetch('./version.json', { cache: 'no-store' })).json()).build;
      return { meta, served };
    });
    if (!marker.meta || marker.meta !== marker.served) throw new Error(`Build marker mismatch: ${JSON.stringify(marker)}`);
    console.log(`PASS ${base} deployed-build marker matches version.json`);

    // Controlled reload, then offline reload from the cache.
    await page.reload();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await context.setOffline(true);
    failures.length = 0;
    await page.reload();
    await page.locator('.app').waitFor();
    const offline = await page.evaluate(() => getComputedStyle(document.querySelector('.app')!).display);
    if (offline !== 'flex') throw new Error('Offline reload lost component styles');
    await context.setOffline(false);
    console.log(`PASS ${base} offline reload from the service worker cache`);
    const real = failures.filter(f => !f.startsWith('page error: Failed to fetch') && !f.includes('NetworkError'));
    if (real.length) throw new Error(real.join('\n'));
  } finally {
    await context.close();
  }
}

const browser = await chromium.launch({ executablePath: Bun.env.CHROMIUM_PATH ?? '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-gpu', '--mute-audio'] });
try {
  await check(browser, `${upstream.origin}/`);
  await check(browser, `http://127.0.0.1:${proxy.port}${prefix}`);
  console.log('PASS PWA/subpath smoke');
} finally {
  await browser.close();
  proxy.stop(true);
}
