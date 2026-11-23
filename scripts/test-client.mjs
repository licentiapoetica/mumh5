import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import electronPath from 'electron';

// A local test client: the built app on a profile of its own (kept between runs, so the
// identity wizard only shows once), with the test Murmur saved and joined at start.
// Usage: npm run build && npm run test-client [host:port]
const server = process.argv[2] ?? process.env.MUMH5_TEST_SERVER ?? 'localhost:64739';
const port = server.split(':')[1] ?? '64739';

// Start the test server when it exists but is stopped, create it when it does not
const state = spawnSync('docker', ['inspect', '-f', '{{.State.Running}}', 'mumh5-test-murmur'], { encoding: 'utf8' });
if (state.status !== 0) {
  spawnSync('docker', ['run', '-d', '--name', 'mumh5-test-murmur', '-p', `${port}:64738`, '-p', `${port}:64738/udp`,
    '-e', 'MUMBLE_CONFIG_AUTOBANATTEMPTS=0', '-e', 'MUMBLE_SUPERUSER_PASSWORD=testsuper', 'mumblevoip/mumble-server'], { stdio: 'inherit' });
} else if (state.stdout.trim() !== 'true') {
  spawnSync('docker', ['start', 'mumh5-test-murmur'], { stdio: 'inherit' });
}

// The mumh5-e2e prefix marks it as a process that is safe to stop
const profile = path.join(tmpdir(), 'mumh5-e2e-test-client');
mkdirSync(profile, { recursive: true });
const { ELECTRON_RUN_AS_NODE, ...env } = process.env;
spawn(electronPath, ['.', `--user-data-dir=${profile}`], { stdio: 'inherit', env: { ...env, MUMH5_TEST_SERVER: server } })
  .on('exit', code => process.exit(code ?? 0));
