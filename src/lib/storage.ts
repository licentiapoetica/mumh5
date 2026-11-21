// localStorage wrapper that tolerates missing or broken storage.
// On desktop, the keys below are also kept in a file in the profile (electron/saved-state.ts).
const SAVED = new Set(['mumh5.servers', 'mumh5.pins', 'mumh5.tokens', 'mumh5.identityNames', 'mumh5.nicknames']);

interface SavedBridge {
  sync(key: string, local: string | null, merge: boolean): string | null;
  write(key: string, raw: string): boolean;
}
const bridge = () => (globalThis as unknown as { mumh5Native?: { savedState?: SavedBridge } }).mumh5Native?.savedState;

function read(key: string): string | null {
  let local: string | null = null;
  try { local = localStorage.getItem(key); } catch { /* storage unavailable */ }
  const saved = SAVED.has(key) ? bridge() : undefined;
  if (!saved) return local;
  try {
    // Each origin hands over what it holds once; after that a removed entry stays removed
    const flag = `${key}.merged`;
    const raw = saved.sync(key, local, localStorage.getItem(flag) !== '1') ?? local;
    localStorage.setItem(flag, '1');
    if (raw !== null && raw !== local) localStorage.setItem(key, raw);
    return raw;
  } catch {
    return local;
  }
}

export function load<T>(key: string, fallback: T): T {
  try {
    const raw = read(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

export function loadList<T>(key: string): T[] {
  try {
    const raw = read(key);
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

// The list as another open copy may have left it; `current` when there is nothing better
export function freshList<T>(key: string, current: T[]): T[] {
  if (!bridge()) return current;
  try {
    const v = JSON.parse(read(key) ?? 'null');
    return Array.isArray(v) ? v : current;
  } catch {
    return current;
  }
}

export function save(key: string, value: unknown): void {
  const raw = JSON.stringify(value);
  try { localStorage.setItem(key, raw); } catch { /* storage unavailable */ }
  if (SAVED.has(key)) try { bridge()?.write(key, raw); } catch { /* kept in localStorage */ }
}
