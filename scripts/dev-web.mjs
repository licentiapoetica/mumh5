import { spawn } from 'node:child_process';
import { createServer } from 'vite';

// The browser build for development: the Rust gateway (crates/web, built and started with cargo)
// on 127.0.0.1:8080 and the Vite dev server, which forwards /api to it (vite.config.ts). Without
// MUMH5_SERVERS the gateway allows any server, private addresses included; it only listens on
// this machine.
const env = { MUMH5_STUN_BIND: '127.0.0.1', MUMH5_STATIC: 'dist-web', ...process.env, MUMH5_PORT: '8080', MUMH5_BIND: '127.0.0.1' };
if (!env.MUMH5_SERVERS && !env.MUMH5_ALLOW_ANY) Object.assign(env, { MUMH5_ALLOW_ANY: '1', MUMH5_ALLOW_PRIVATE: '1' });

const gateway = spawn('cargo', ['run', '--locked', '-p', 'mumh5-web'], { stdio: 'inherit', env });
gateway.on('error', e => { console.error(`Could not start cargo (${e.message}). The gateway needs Rust, see rust-toolchain.toml.`); process.exit(1); });
gateway.on('exit', code => { console.error(`The gateway stopped (exit code ${code}). Is port 8080 in use?`); process.exit(1); });

const server = await createServer({ mode: 'web' });
await server.listen();
server.printUrls();

const stop = () => { gateway.removeAllListeners('exit'); gateway.kill(); server.close().finally(() => process.exit(0)); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
