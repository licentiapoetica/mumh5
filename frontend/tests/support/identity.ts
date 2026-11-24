// Test-only client certificates for the server tests, made with the openssl command line tool
// (the desktop app makes identities in Rust; the old app used node-forge).
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function generateIdentity(name: string): { certPem: string; keyPem: string } {
  const dir = mkdtempSync(join(tmpdir(), 'mumh5-test-id-'));
  try {
    const run = Bun.spawnSync(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2',
      '-subj', `/CN=${name.replace(/[/=\\]/g, '_') || 'mumh5 user'}`, '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem'),
      '-addext', 'extendedKeyUsage=clientAuth'], { stderr: 'pipe' });
    if (run.exitCode !== 0) throw new Error(`openssl failed: ${run.stderr.toString()}`);
    return { certPem: readFileSync(join(dir, 'cert.pem'), 'utf8'), keyPem: readFileSync(join(dir, 'key.pem'), 'utf8') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
