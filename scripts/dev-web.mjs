import { spawn } from 'node:child_process';
import { createServer } from 'vite';

// The browser build for development: the web proxy on 127.0.0.1:8080 and the Vite dev server,
// which forwards /api to it (vite.config.ts). Without MUMH5_SERVERS the proxy allows any
// server, private addresses included; it only listens on this machine.
const env = { MUMH5_STUN_BIND: '127.0.0.1', ...process.env, MUMH5_PORT: '8080', MUMH5_BIND: '127.0.0.1' };
if (!env.MUMH5_SERVERS && !env.MUMH5_ALLOW_ANY) Object.assign(env, { MUMH5_ALLOW_ANY: '1', MUMH5_ALLOW_PRIVATE: '1' });

const proxy = spawn(process.execPath, ['server/main.ts'], { stdio: 'inherit', env });
proxy.on('exit', code => { console.error(`The proxy stopped (exit code ${code}). Is port 8080 in use?`); process.exit(1); });

const server = await createServer({ mode: 'web' });
await server.listen();
server.printUrls();

const stop = () => { proxy.removeAllListeners('exit'); proxy.kill(); server.close().finally(() => process.exit(0)); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
