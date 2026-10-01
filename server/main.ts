// Starts the web proxy from environment variables (see the README, "Browser version").
import path from 'node:path';
import { existsSync } from 'node:fs';
import { configFromEnv, startProxy } from './proxy.ts';

const config = configFromEnv(process.env);
// The web build sits next to this script's folder, both in the repository and when bundled
config.staticDir ??= [path.resolve(import.meta.dirname, '../dist-web')].find(d => existsSync(path.join(d, 'index.html'))) ?? null;

try {
  const { port, stunPort } = await startProxy(config);
  console.log(`mumh5 proxy listening on http://${config.bind}:${port}`);
  console.log(config.allowAny ? `Allowed servers: any${config.allowPrivate ? ', private addresses included' : ' public address'}` : `Allowed servers: ${config.servers.map(s => `${s.host}:${s.port}`).join(', ')}`);
  if (config.sendProxy) console.log('Announcing client addresses with the PROXY protocol; the allowed servers must expect it');
  console.log(stunPort ? `STUN for screen sharing on UDP port ${stunPort} (must be reachable from the internet)` : 'STUN is off; screen sharing between browser users will only work on the same network');
  console.log(config.staticDir ? `Serving the web app from ${config.staticDir}` : 'No web build found (npm run build:web); serving the API only');
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
