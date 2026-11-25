// Page load of the browser build in Chromium: fresh profile per run, time until the app is usable
// (the identity setup's first button), JS heap, requests and bytes.
//   bun tools/perf/webui.ts --base http://127.0.0.1:8080/ [--runs 7]
// Prints one JSON line with medians.
import { chromium } from 'playwright-core';

const arg = (name: string, fallback: string) => { const i = Bun.argv.indexOf(`--${name}`); return i > 0 ? Bun.argv[i + 1] : fallback; };
const base = arg('base', 'http://127.0.0.1:8080/');
const runs = Number(arg('runs', '7'));
const browser = await chromium.launch({ executablePath: Bun.env.CHROMIUM_PATH ?? '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-gpu'] });
const rows: Record<string, number>[] = [];
try {
  for (let i = 0; i < runs; i++) {
    const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
    const page = await context.newPage();
    await page.route(url => !url.href.startsWith(base), route => route.abort());
    let requests = 0, bytes = 0;
    page.on('requestfinished', async r => { requests++; const s = await r.sizes().catch(() => null); if (s) bytes += s.responseBodySize + s.responseHeadersSize; });
    const cdp = await context.newCDPSession(page);
    await cdp.send('Performance.enable');
    const t0 = Date.now();
    await page.goto(base);
    await page.getByRole('button', { name: /Create a new identity/ }).waitFor();
    const usable = Date.now() - t0;
    const nav = await page.evaluate(() => { const n = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming; const fcp = performance.getEntriesByName('first-contentful-paint')[0]; return { domContentLoaded: n.domContentLoadedEventEnd, load: n.loadEventEnd, fcp: fcp?.startTime ?? 0 }; });
    await page.waitForTimeout(3000);
    const metrics = Object.fromEntries(((await cdp.send('Performance.getMetrics')).metrics as { name: string; value: number }[]).map(m => [m.name, m.value]));
    rows.push({ usableMs: usable, domContentLoadedMs: nav.domContentLoaded, loadMs: nav.load, fcpMs: nav.fcp, jsHeapUsedMiB: metrics.JSHeapUsedSize / 1048576, nodes: metrics.Nodes, scriptMs: metrics.ScriptDuration * 1000, layoutMs: metrics.LayoutDuration * 1000, requests, MiB: bytes / 1048576 });
    await context.close();
  }
} finally { await browser.close(); }
const median = (k: string) => { const v = rows.map(r => r[k]).sort((a, b) => a - b); return Math.round(v[Math.floor(v.length / 2)] * 10) / 10; };
console.log(JSON.stringify(Object.fromEntries(Object.keys(rows[0]).map(k => [k, median(k)]))));
