import fs from 'node:fs';
import path from 'node:path';

// What people cannot easily type in again. Browser storage is not enough for these: the dev and
// packaged builds have separate origins, a second open copy gets an empty one, and Chromium may
// replace a database it cannot open.
export const SAVED_KEYS = ['mumh5.servers', 'mumh5.pins', 'mumh5.tokens', 'mumh5.identityNames', 'mumh5.nicknames', 'mumh5.displayNames'];
const MAX_VALUE = 16 * 1024 * 1024;

export const isSavedKey = (key: unknown): key is string => typeof key === 'string' && SAVED_KEYS.includes(key);
export const isSavedValue = (raw: unknown): raw is string => typeof raw === 'string' && raw.length <= MAX_VALUE;

type Values = Record<string, string>;
type Server = { id?: unknown; host?: unknown; port?: unknown; username?: unknown };

function parse(raw: string): unknown {
  try { return JSON.parse(raw); } catch { return undefined; }
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

const sameServer = (a: Server, b: Server) => a.id === b.id ||
  (String(a.host).toLowerCase() === String(b.host).toLowerCase() && a.port === b.port && a.username === b.username);

// Combines this file with what one origin's browser storage still holds; nothing is dropped
export function mergeSaved(key: string, stored: string, local: string): string {
  const a = parse(stored);
  const b = parse(local);
  if (b === undefined) return stored;
  if (a === undefined) return local;
  if (key === 'mumh5.servers') {
    if (!Array.isArray(a) || !Array.isArray(b)) return Array.isArray(a) ? stored : local;
    const extra = b.filter((s: Server) => !a.some((x: Server) => sameServer(x, s)));
    return extra.length ? JSON.stringify([...a, ...extra]) : stored;
  }
  if (!isRecord(a) || !isRecord(b)) return isRecord(a) ? stored : local;
  const out: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const old = out[k];
    out[k] = Array.isArray(old) && Array.isArray(v) ? [...new Set([...old, ...v])] : v;
  }
  return JSON.stringify(out);
}

function readValues(file: string): Values | null {
  try {
    const d = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!isRecord(d) || !isRecord(d.values)) return null;
    return Object.fromEntries(Object.entries(d.values).filter(([k, v]) => isSavedKey(k) && typeof v === 'string')) as Values;
  } catch {
    return null;
  }
}

// Read fresh on every call, since a dev and a packaged copy can share this file
export class SavedState {
  private file: string;
  private backup: string;

  constructor(dir: string) {
    this.file = path.join(dir, 'saved-state.json');
    this.backup = `${this.file}.bak`;
  }

  private read(): Values {
    return readValues(this.file) ?? readValues(this.backup) ?? {};
  }

  private store(values: Values) {
    // A damaged file must not replace the last good backup
    if (readValues(this.file)) fs.copyFileSync(this.file, this.backup);
    const tmp = `${this.file}.${process.pid}.tmp`;
    const fd = fs.openSync(tmp, 'w', 0o600);
    try {
      fs.writeSync(fd, JSON.stringify({ version: 1, values }));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, this.file);
  }

  // The value to use. With merge, also takes in what this origin's storage holds.
  sync(key: string, local: string | null, merge: boolean): string | null {
    const values = this.read();
    const stored = values[key];
    if (stored === undefined) {
      if (local === null) return null;
      this.store({ ...values, [key]: local });
      return local;
    }
    if (!merge || local === null) return stored;
    const merged = mergeSaved(key, stored, local);
    if (merged !== stored) this.store({ ...values, [key]: merged });
    return merged;
  }

  write(key: string, raw: string) {
    const values = this.read();
    if (values[key] !== raw) this.store({ ...values, [key]: raw });
  }
}
