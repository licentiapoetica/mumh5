// Compares two web gateway binaries on this machine: same Murmur, same load, alternating runs
// (base, new, new, base, ...), medians, relative thresholds. Absolute numbers from shared CI
// runners do not compare between runs, the ratio between two builds measured side by side does.
//   bun tools/perf/compare.ts --base path/to/old/mumh5-web --new path/to/new/mumh5-web
//     --server 127.0.0.1:64750 [--dist dist] [--base-dist DIR] [--new-dist DIR] [--rounds 3]
//     [--port 18210] [--clients 20] [--talkers 5] [--seconds 20] [--visits 50] [--concurrency 20]
//     [--summary FILE] [--json FILE] [--max-cpu 25] [--max-pss 20] [--max-latency 25]
//     [--max-throughput 50] [--keepalive-ceiling 10]
// Prints a table, appends it as Markdown to --summary (GITHUB_STEP_SUMMARY in CI) and exits 1
// when a metric got worse than its threshold allows.
import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { resolve } from 'node:path';
import { cpuTicks, pssKiB, tick } from './sample.ts';

const arg = (name: string, fallback: string) => { const i = Bun.argv.indexOf(`--${name}`); return i > 0 ? Bun.argv[i + 1] : fallback; };
const num = (name: string, fallback: number) => Number(arg(name, String(fallback)));
const here = new URL('.', import.meta.url).pathname;
const frontend = resolve(here, '../..');

const bins = { base: resolve(arg('base', '')), new: resolve(arg('new', '')) };
const dist = resolve(arg('dist', resolve(frontend, 'dist')));
const dists = { base: resolve(arg('base-dist', dist)), new: resolve(arg('new-dist', dist)) };
const server = arg('server', '127.0.0.1:64750');
const rounds = num('rounds', 3);
const port = num('port', 18210);
const clients = num('clients', 20), talkers = num('talkers', 5), seconds = num('seconds', 20);
const visits = num('visits', 50), concurrency = num('concurrency', 20), keepalive = num('keepalive', 200);
// Percent a median may get worse by. Defaults sit above what A/A runs (one binary against itself)
// showed on a busy machine; see docs/TESTING.md.
const limits = {
  cpu: num('max-cpu', 25), pss: num('max-pss', 20), latency: num('max-latency', 25), throughput: num('max-throughput', 50)
};
// Latencies below a millisecond swing by large ratios, so a latency only counts as worse when it
// also lost this many ms. Keep-alive requests must stay under the ceiling whatever base shows:
// Nagle with delayed ACKs put about 40 ms on each one (#115).
const latencySlackMs = num('latency-slack', 2);
const keepaliveCeilingMs = num('keepalive-ceiling', 10);
// Murmur sends each talker's packets to every other client in the channel
const minDelivered = num('min-delivered', 0.9);

for (const [side, path] of Object.entries(bins)) if (!existsSync(path)) throw new Error(`--${side}: no gateway binary at ${path}`);
for (const [side, path] of Object.entries(dists)) if (!existsSync(`${path}/index.html`)) throw new Error(`${side} dist has no index.html: ${path}`);

type Side = 'base' | 'new';
type Run = {
  cpuUsPerPacket: number; cpuMsPerVisit: number; pssPeakMiB: number; keepaliveP50: number; staticP50: number;
  visitsPerSecond: number; delivered: number; MiBPerVisit: number;
};

const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

async function waitPort(p: number, child: Bun.Subprocess) {
  const until = performance.now() + 15000;
  while (performance.now() < until) {
    if (child.exitCode !== null) throw new Error(`gateway exited with ${child.exitCode}`);
    const ok = await new Promise<boolean>(done => {
      const s = connect(p, '127.0.0.1', () => { s.destroy(); done(true); });
      s.on('error', () => done(false));
    });
    if (ok) return;
    await Bun.sleep(100);
  }
  throw new Error(`gateway did not listen on ${p}`);
}

// Sequential GETs of the page on one keep-alive connection; the first request is left out
function keepAliveP50(p: number, count: number): Promise<number> {
  return new Promise((done, fail) => {
    const socket = connect(p, '127.0.0.1');
    const times: number[] = [];
    let buf = Buffer.alloc(0), started = 0;
    const send = () => { started = performance.now(); socket.write(`GET / HTTP/1.1\r\nHost: 127.0.0.1:${p}\r\n\r\n`); };
    socket.on('connect', send);
    socket.on('error', fail);
    socket.on('data', chunk => {
      buf = Buffer.concat([buf, chunk]);
      const end = buf.indexOf('\r\n\r\n');
      if (end < 0) return;
      const head = buf.subarray(0, end).toString();
      const length = /\r\ncontent-length:\s*(\d+)/i.exec(head);
      if (!length) { socket.destroy(); fail(new Error(`no Content-Length: ${head.split('\r\n')[0]}`)); return; }
      if (buf.length < end + 4 + Number(length[1])) return;
      times.push(performance.now() - started);
      buf = buf.subarray(end + 4 + Number(length[1]));
      if (times.length < count) send();
      else { socket.destroy(); done(median(times.slice(1))); }
    });
  });
}

async function runOnce(side: Side, round: number): Promise<Run> {
  const p = port + (side === 'base' ? 0 : 1);
  const gateway = Bun.spawn([bins[side]], {
    env: {
      ...process.env, MUMH5_PORT: String(p), MUMH5_BIND: '127.0.0.1', MUMH5_STUN_PORT: '0', MUMH5_SERVERS: server,
      MUMH5_STATIC: dists[side], MUMH5_MAX_PER_ADDRESS: String(clients + 8), MUMH5_MAX_CONNECTIONS: String(clients + 50)
    },
    stdout: 'ignore', stderr: 'inherit'
  });
  try {
    await waitPort(p, gateway);
    const pid = gateway.pid;

    // Voice through the gateway; CPU and memory only while the bots talk
    const load = Bun.spawn([process.execPath, 'tools/perf/load.ts', '--server', server, '--gateway', `ws://127.0.0.1:${p}/api/connect`,
      '--clients', String(clients), '--talkers', String(talkers), '--seconds', String(seconds), '--name', `cmp${round}${side}`],
    { cwd: frontend, stdout: 'pipe', stderr: 'pipe' });
    let ticks0 = 0, ticks1 = 0, peak = 0, talking = false;
    const poll = setInterval(() => { if (talking) peak = Math.max(peak, pssKiB(pid)); }, 250);
    const markers = (async () => {
      const decoder = new TextDecoder();
      let text = '';
      for await (const chunk of load.stderr) {
        text += decoder.decode(chunk);
        if (!talking && text.includes('talking\n')) { ticks0 = cpuTicks(pid); talking = true; }
        if (text.includes('stopped\n')) { ticks1 = cpuTicks(pid); talking = false; break; }
      }
      return text;
    })();
    const [out, err, code] = await Promise.all([new Response(load.stdout).text(), markers, load.exited]);
    clearInterval(poll);
    if (code !== 0 || !ticks1) throw new Error(`load.ts failed (${code}): ${err.trim()}`);
    const voice = JSON.parse(out.trim().split('\n').pop()!);
    const expected = voice.sentPackets * (clients - 1);
    const delivered = voice.receivedPackets / Math.max(1, expected);

    const keepaliveP50 = await keepAliveP50(p, keepalive);

    const visit = async (n: number) => {
      const http = Bun.spawn([process.execPath, 'tools/perf/http.ts', '--base', `http://127.0.0.1:${p}/`, '--dir', dists[side],
        '--visits', String(n), '--concurrency', String(concurrency)], { cwd: frontend, stdout: 'pipe', stderr: 'inherit' });
      const httpOut = await new Response(http.stdout).text();
      if (await http.exited !== 0) throw new Error('http.ts failed');
      return JSON.parse(httpOut.trim().split('\n').pop()!);
    };
    // The first visits are much slower (page cache, Bun's JIT); they are not measured
    await visit(Math.min(5, visits));
    const ticks2 = cpuTicks(pid);
    const stat = await visit(visits);
    const cpuMsPerVisit = (cpuTicks(pid) - ticks2) / tick * 1000 / visits;

    return {
      cpuUsPerPacket: (ticks1 - ticks0) / tick * 1e6 / Math.max(1, voice.receivedPackets),
      pssPeakMiB: peak / 1024, keepaliveP50, cpuMsPerVisit, staticP50: stat.p50, visitsPerSecond: stat.visitsPerSecond,
      delivered, MiBPerVisit: stat.MiBPerVisit
    };
  } finally {
    gateway.kill();
    await gateway.exited;
  }
}

const runs: Record<Side, Run[]> = { base: [], new: [] };
for (let r = 0; r < rounds; r++) {
  // ABBA order, so a slow drift of the machine falls on both sides alike
  for (const side of (r % 2 ? ['new', 'base'] : ['base', 'new']) as Side[]) {
    const run = await runOnce(side, r);
    runs[side].push(run);
    console.error(`round ${r + 1}/${rounds} ${side}: ${JSON.stringify(Object.fromEntries(Object.entries(run).map(([k, v]) => [k, round(v, 2)])))}`);
  }
}

type Metric = { key: keyof Run; label: string; unit: string; better: 'lower' | 'higher'; limit: number; slack?: number; ceiling?: number };
const metrics: Metric[] = [
  { key: 'cpuUsPerPacket', label: 'Gateway CPU per forwarded voice packet', unit: 'us', better: 'lower', limit: limits.cpu },
  { key: 'pssPeakMiB', label: 'Gateway memory under voice load (peak PSS)', unit: 'MiB', better: 'lower', limit: limits.pss },
  { key: 'keepaliveP50', label: 'Keep-alive request latency (p50)', unit: 'ms', better: 'lower', limit: limits.latency, slack: latencySlackMs, ceiling: keepaliveCeilingMs },
  { key: 'cpuMsPerVisit', label: 'Gateway CPU per static visit', unit: 'ms', better: 'lower', limit: limits.cpu },
  { key: 'staticP50', label: `Static file latency (p50, ${concurrency} parallel)`, unit: 'ms', better: 'lower', limit: limits.latency, slack: latencySlackMs },
  { key: 'visitsPerSecond', label: 'Static throughput (whole visits per second)', unit: '/s', better: 'higher', limit: limits.throughput }
];

const rows: { m: Metric; base: number; next: number; change: number; verdict: string; bad: boolean }[] = [];
for (const m of metrics) {
  const base = median(runs.base.map(r => r[m.key])), next = median(runs.new.map(r => r[m.key]));
  const change = (next - base) / base * 100;
  const worse = m.better === 'lower' ? change : -change;
  const reasons: string[] = [];
  if (worse > m.limit && (m.slack === undefined || next - base > m.slack)) reasons.push(`worse by more than ${m.limit} %`);
  if (m.ceiling !== undefined && next > m.ceiling) reasons.push(`above ${m.ceiling} ${m.unit}`);
  rows.push({ m, base, next, change, bad: reasons.length > 0, verdict: reasons.length ? `regression: ${reasons.join(', ')}` : 'ok' });
}
// A gateway that forwards nothing would look cheap per packet
const lost = (Object.keys(runs) as Side[]).filter(s => runs[s].some(r => r.delivered < minDelivered));
const failed = rows.some(r => r.bad) || lost.includes('new');

const fmt = (n: number) => (Math.abs(n) >= 100 ? round(n, 0) : Math.abs(n) >= 10 ? round(n, 1) : round(n, 2)).toString();
const sign = (n: number) => `${n > 0 ? '+' : ''}${round(n, 1)} %`;
const lines = [
  '### Gateway performance: base vs new',
  '',
  `Medians of ${rounds} alternating runs each on this runner. ${clients} clients through the gateway, ${talkers} talking for ${seconds} s; ` +
    `static visits: ${visits} x page and all assets, ${concurrency} parallel.`,
  '',
  '| Metric | Base | New | Change | Threshold | Verdict |',
  '|---|---|---|---|---|---|',
  ...rows.map(r => `| ${r.m.label} | ${fmt(r.base)} ${r.m.unit} | ${fmt(r.next)} ${r.m.unit} | ${sign(r.change)} | ${r.m.better === 'lower' ? '+' : '-'}${r.m.limit} %` +
    `${r.m.slack ? ` and ${r.m.slack} ${r.m.unit}` : ''}${r.m.ceiling ? `, at most ${r.m.ceiling} ${r.m.unit}` : ''} | ${r.verdict} |`),
  '',
  `Voice delivered (received / expected): base ${runs.base.map(r => round(r.delivered, 3)).join(', ')}; new ${runs.new.map(r => round(r.delivered, 3)).join(', ')}` +
    `${lost.length ? ` (below ${minDelivered} on ${lost.join(' and ')}: the voice numbers of that side are not valid)` : ''}.`,
  `Static bytes per visit: base ${round(median(runs.base.map(r => r.MiBPerVisit)))} MiB, new ${round(median(runs.new.map(r => r.MiBPerVisit)))} MiB.`,
  '',
  failed ? '**Result: regression.**' : 'Result: no regression beyond the thresholds.',
  ''
];
const text = lines.join('\n');
console.log(text);
const summary = arg('summary', '');
if (summary) appendFileSync(summary, `${text}\n`);
const json = arg('json', '');
if (json) writeFileSync(json, JSON.stringify({ runs, rows: rows.map(r => ({ key: r.m.key, base: r.base, new: r.next, change: r.change, verdict: r.verdict })), failed }, null, 2));
process.exit(failed ? 1 : 0);
