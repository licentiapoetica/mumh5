// Samples a process and all its descendants (Linux /proc): CPU use and proportional memory (PSS,
// so shared libraries count once across the tree, as with Electron's or WebKit's helper processes).
//   bun tools/perf/sample.ts --pid 1234 --seconds 30 [--interval 0.5]
// Prints one JSON line: average and peak CPU (% of one core), average and peak PSS in MiB, processes.
import { readFileSync, readdirSync } from 'node:fs';

const arg = (name: string, fallback: string) => { const i = Bun.argv.indexOf(`--${name}`); return i > 0 ? Bun.argv[i + 1] : fallback; };
const root = Number(arg('pid', '0'));
const seconds = Number(arg('seconds', '30'));
const interval = Number(arg('interval', '0.5'));
const tick = 100; // USER_HZ on Linux

function tree(pid: number): number[] {
  const all = [pid];
  for (let i = 0; i < all.length; i++) {
    try {
      for (const task of readdirSync(`/proc/${all[i]}/task`)) {
        const children = readFileSync(`/proc/${all[i]}/task/${task}/children`, 'utf8').trim();
        if (children) all.push(...children.split(/\s+/).map(Number));
      }
    } catch { /* gone */ }
  }
  return [...new Set(all)];
}
const cpuTicks = (pid: number) => {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const f = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    return Number(f[11]) + Number(f[12]); // utime + stime
  } catch { return 0; }
};
const pssKiB = (pid: number) => {
  try { return Number(/^Pss:\s+(\d+)/m.exec(readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8'))?.[1] ?? 0); } catch { return 0; }
};

const total = () => { const pids = tree(root); return { pids, ticks: pids.reduce((n, p) => n + cpuTicks(p), 0), pss: pids.reduce((n, p) => n + pssKiB(p), 0) }; };
let last = total();
let lastAt = performance.now();
const cpu: number[] = [], pss: number[] = [];
let processes = last.pids.length;
const startTicks = last.ticks, startAt = lastAt;
const end = startAt + seconds * 1000;
while (performance.now() < end) {
  await Bun.sleep(interval * 1000);
  const now = total(), at = performance.now();
  // Ticks of processes that ended are lost, so a falling total is not counted as negative use
  cpu.push(Math.max(0, now.ticks - last.ticks) / tick / ((at - lastAt) / 1000) * 100);
  pss.push(now.pss / 1024);
  processes = Math.max(processes, now.pids.length);
  last = now; lastAt = at;
}
const avg = (v: number[]) => v.reduce((a, b) => a + b, 0) / Math.max(1, v.length);
const round = (n: number) => Math.round(n * 10) / 10;
console.log(JSON.stringify({
  seconds, processes,
  cpuAvgPct: round(Math.max(0, last.ticks - startTicks) / tick / ((lastAt - startAt) / 1000) * 100),
  cpuPeakPct: round(Math.max(0, ...cpu)),
  pssAvgMiB: round(avg(pss)), pssPeakMiB: round(Math.max(0, ...pss))
}));
