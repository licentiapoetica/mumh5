// The Rust web gateway (crates/web) for the browser tests: built with cargo unless MUMH5_GATEWAY
// names a binary, serving dist-web unless MUMH5_STATIC says otherwise.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');

export function gatewayBinary(): string {
  if (process.env.MUMH5_GATEWAY) return path.resolve(process.env.MUMH5_GATEWAY);
  const built = spawnSync('cargo', ['build', '--locked', '-p', 'mumh5-web', '--message-format=json-render-diagnostics'],
    { cwd: root, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (built.status !== 0) throw new Error(`cargo build -p mumh5-web failed${built.error ? `: ${built.error.message}` : ''}`);
  for (const line of built.stdout.split('\n')) {
    try {
      const msg = JSON.parse(line);
      if (msg.reason === 'compiler-artifact' && msg.target?.name === 'mumh5-web' && msg.executable) return msg.executable;
    } catch { /* not a cargo message */ }
  }
  throw new Error('cargo did not name the mumh5-web binary');
}

export interface Gateway { process: ChildProcess; url: string; port: number }

// Resolves once the gateway prints its address. MUMH5_PORT=0 picks a free port.
export async function startGateway(env: Record<string, string | undefined>): Promise<Gateway> {
  const child = spawn(gatewayBinary(), [], {
    cwd: root, stdio: ['ignore', 'pipe', 'inherit'],
    env: { MUMH5_STATIC: path.join(root, 'dist-web'), ...env }
  });
  const url = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('The gateway did not start in time')); }, 20000);
    let out = '';
    child.stdout!.on('data', d => {
      out += d;
      const m = /mumh5: (http:\/\/\S+)/.exec(out);
      if (m) { clearTimeout(timer); resolve(m[1]); }
    });
    child.on('exit', code => { clearTimeout(timer); reject(new Error(`The gateway exited with ${code}`)); });
  });
  return { process: child, url, port: Number(new URL(url).port) };
}
