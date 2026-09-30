import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { generateIdentity, identityFromP12, identityToP12, certCommonName, type Identity } from './identity.ts';
import { describeCert, type CertDetails } from './certs.ts';

export interface StoredIdentity extends Identity {
  id: string;
  name: string;
  createdAt: string;
}

interface StoreFile {
  identities: StoredIdentity[];
  defaultId: string | null;
  setupDone: boolean;
}

export interface IdentitySummary {
  id: string;
  name: string;
  fingerprint: string;
  isDefault: boolean;
  cert: CertDetails;
}

// Where the desktop Mumble client (1.5+) keeps its settings, including its certificate
export function mumbleSettingsPaths(): string[] {
  const home = os.homedir();
  return [
    path.join(process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), 'Mumble', 'Mumble', 'mumble_settings.json'),
    path.join(home, 'Library', 'Application Support', 'Mumble', 'Mumble', 'mumble_settings.json'),
    path.join(process.env.XDG_CONFIG_HOME ?? path.join(home, '.config'), 'Mumble', 'Mumble', 'mumble_settings.json')
  ];
}

// Client identities (certificates), stored with owner-only permissions in the app's data folder
export class IdentityStore {
  private data: StoreFile | null = null;
  private file: string;
  private legacyFile: string;

  constructor(dir: string) {
    this.file = path.join(dir, 'identities.json');
    this.legacyFile = path.join(dir, 'identity.json');
  }

  private async load(): Promise<StoreFile> {
    if (this.data) return this.data;
    try {
      this.data = JSON.parse(await fs.readFile(this.file, 'utf8')) as StoreFile;
    } catch {
      this.data = { identities: [], defaultId: null, setupDone: false };
      // Earlier versions generated one identity silently; keep it, but still run the setup wizard
      try {
        const legacy = JSON.parse(await fs.readFile(this.legacyFile, 'utf8')) as Identity;
        const id = { ...legacy, id: randomUUID(), name: certCommonName(legacy.certPem) || 'My identity', createdAt: new Date().toISOString() };
        this.data.identities.push(id);
        this.data.defaultId = id.id;
        await this.save();
      } catch { /* no legacy identity */ }
    }
    return this.data;
  }

  private async save(): Promise<void> {
    await fs.writeFile(this.file, JSON.stringify(this.data), { mode: 0o600 });
  }

  private summary(d: StoreFile, i: StoredIdentity): IdentitySummary {
    return { id: i.id, name: i.name, fingerprint: i.fingerprint, isDefault: i.id === d.defaultId, cert: describeCert(i.certPem) };
  }

  async list(): Promise<{ identities: IdentitySummary[]; setupDone: boolean }> {
    const d = await this.load();
    return { identities: d.identities.map(i => this.summary(d, i)), setupDone: d.setupDone };
  }

  // The identity to connect with: the requested one, else the default, else a new one
  async get(id?: string | null): Promise<StoredIdentity> {
    const d = await this.load();
    const found = d.identities.find(i => i.id === id) ?? d.identities.find(i => i.id === d.defaultId) ?? d.identities[0];
    if (found) return found;
    const created = await this.add(generateIdentity(os.userInfo().username), os.userInfo().username);
    return d.identities.find(i => i.id === created.id)!;
  }

  private async add(identity: Identity, name: string): Promise<IdentitySummary> {
    const d = await this.load();
    const existing = d.identities.find(i => i.fingerprint === identity.fingerprint);
    if (existing) throw new Error(`This certificate is already stored as "${existing.name}".`);
    const stored: StoredIdentity = { ...identity, id: randomUUID(), name: name.trim() || 'Identity', createdAt: new Date().toISOString() };
    d.identities.push(stored);
    d.defaultId ??= stored.id;
    await this.save();
    return this.summary(d, stored);
  }

  create(name: string, email: string): Promise<IdentitySummary> {
    return this.add(generateIdentity(name, email), name);
  }

  importP12(bytes: Uint8Array, password: string, name: string): Promise<IdentitySummary> {
    const identity = identityFromP12(bytes, password);
    return this.add(identity, name || certCommonName(identity.certPem));
  }

  // Finds the desktop client's certificate; returns its name if one exists
  async findMumbleCertificate(): Promise<{ path: string; name: string } | null> {
    for (const p of mumbleSettingsPaths()) {
      try {
        const settings = JSON.parse(await fs.readFile(p, 'utf8'));
        if (typeof settings.certificate !== 'string' || !settings.certificate) continue;
        const identity = identityFromP12(new Uint8Array(Buffer.from(settings.certificate, 'base64')), '');
        return { path: p, name: certCommonName(identity.certPem) || 'Mumble certificate' };
      } catch { /* not there or unreadable */ }
    }
    return null;
  }

  async importFromMumble(name: string): Promise<IdentitySummary> {
    const found = await this.findMumbleCertificate();
    if (!found) throw new Error('No certificate from the desktop Mumble client was found.');
    const settings = JSON.parse(await fs.readFile(found.path, 'utf8'));
    return this.importP12(new Uint8Array(Buffer.from(settings.certificate, 'base64')), '', name || found.name);
  }

  async exportP12(id: string, password: string): Promise<{ bytes: Uint8Array; name: string }> {
    const d = await this.load();
    const i = d.identities.find(x => x.id === id);
    if (!i) throw new Error('Identity not found.');
    return { bytes: identityToP12(i, password, i.name), name: i.name };
  }

  async setDefault(id: string): Promise<void> {
    const d = await this.load();
    if (d.identities.some(i => i.id === id)) d.defaultId = id;
    await this.save();
  }

  async rename(id: string, name: string): Promise<void> {
    const d = await this.load();
    const i = d.identities.find(x => x.id === id);
    if (i && name.trim()) i.name = name.trim();
    await this.save();
  }

  async remove(id: string): Promise<void> {
    const d = await this.load();
    d.identities = d.identities.filter(i => i.id !== id);
    if (d.defaultId === id) d.defaultId = d.identities[0]?.id ?? null;
    await this.save();
  }

  async finishSetup(): Promise<void> {
    const d = await this.load();
    d.setupDone = true;
    await this.save();
  }
}
