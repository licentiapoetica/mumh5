// HTTP throughput of a web gateway's static files: whole visits, the page plus every file in the
// build's assets folder (bundles differ in how they split, so single files do not compare).
//   bun tools/perf/http.ts --base http://127.0.0.1:8080/ --dir path/to/dist [--visits 100] [--concurrency 50]
// Prints one JSON line: requests and MiB per second, latency percentiles in ms.
import { readdirSync } from 'node:fs';

const arg = (name: string, fallback: string) => { const i = Bun.argv.indexOf(`--${name}`); return i > 0 ? Bun.argv[i + 1] : fallback; };
const base = arg('base', 'http://127.0.0.1:8080/');
const dir = arg('dir', '');
const visits = Number(arg('visits', '100'));
const concurrency = Number(arg('concurrency', '50'));

const urls = [base, ...readdirSync(`${dir}/assets`).map(f => new URL(`assets/${f}`, base).href)];
const queue = Array.from({ length: visits }, () => urls).flat();
let bytes = 0;
const latencies: number[] = [];
let next = 0;
const started = performance.now();
await Promise.all(Array.from({ length: concurrency }, async () => {
  while (next < queue.length) {
    const url = queue[next++];
    const t = performance.now();
    const res = await fetch(url);
    const size = (await res.arrayBuffer()).byteLength;
    bytes += size;
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    latencies.push(performance.now() - t);
  }
}));
const seconds = (performance.now() - started) / 1000;
latencies.sort((a, b) => a - b);
const p = (q: number) => Math.round(latencies[Math.min(latencies.length - 1, Math.floor(q * latencies.length))] * 10) / 10;
console.log(JSON.stringify({ visits, filesPerVisit: urls.length, MiBPerVisit: Math.round(bytes / visits / 1048576 * 10) / 10, rps: Math.round(queue.length / seconds), MiBps: Math.round(bytes / seconds / 1048576), visitsPerSecond: Math.round(visits / seconds * 10) / 10, p50: p(0.5), p95: p(0.95), p99: p(0.99) }));
