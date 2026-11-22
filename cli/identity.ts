import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { generateIdentity, certFingerprint, type Identity } from '../electron/identity.ts';

export async function botIdentity(directory: string, name: string): Promise<Identity> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, 'identity.json');
  try {
    const value = JSON.parse(await readFile(file, 'utf8'));
    if (typeof value.certPem !== 'string' || typeof value.keyPem !== 'string') throw new Error('Invalid client identity');
    return { certPem: value.certPem, keyPem: value.keyPem, fingerprint: certFingerprint(value.certPem) };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  const identity = generateIdentity(name);
  try { await writeFile(file, JSON.stringify(identity), { mode: 0o600, flag: 'wx' }); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'EEXIST') return botIdentity(directory, name); throw e; }
  return identity;
}

export function normalizeFingerprint(value: string): string { return value.replace(/:/g, '').toLowerCase(); }

// Called before Authenticate, so a changed certificate never receives credentials.
export async function trustServer(directory: string, host: string, port: number, info: { fingerprint: string; authorized: boolean }, trustNew: boolean, expected?: string): Promise<void> {
  const file = path.join(directory, 'known-servers.json'), key = JSON.stringify([host.toLowerCase(), port]);
  let pins: Record<string, string> = {};
  try { pins = JSON.parse(await readFile(file, 'utf8')); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  const fingerprint = normalizeFingerprint(info.fingerprint), saved = pins[key];
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw new Error('Server did not provide a SHA-256 certificate fingerprint');
  if (expected) {
    if (normalizeFingerprint(expected) !== fingerprint) throw new Error(`Server certificate does not match --server-fingerprint: ${info.fingerprint}`);
  } else if (saved && saved !== fingerprint) {
    throw new Error(`Server certificate changed: ${info.fingerprint}. Verify it and supply --server-fingerprint to replace the pin.`);
  } else if (!saved && !info.authorized && !trustNew) {
    throw new Error(`Untrusted server certificate: ${info.fingerprint}. Verify it, then use --server-fingerprint or --trust-new for this first connection.`);
  }
  if (saved === fingerprint) return;
  pins[key] = fingerprint;
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(pins), { mode: 0o600 });
  await rename(temporary, file);
}
