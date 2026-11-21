import { promises as fs } from 'node:fs';
import path from 'node:path';
import { SOUND_EVENTS, defaultSoundSettings, isSoundPackId, normalizeSoundSettings, type LoadedSoundSettings } from '../src/core/sound-events.ts';
import { MAX_AUDIO_FILE, MAX_AUDIO_PACK } from '../src/core/audio-pack.ts';

// Everything stays beside identities and tray.json in Electron's userData directory.
export class SoundStore {
  private queue: Promise<unknown> = Promise.resolve();
  private directory: string;
  constructor(directory: string) { this.directory = directory; }

  private serial<T>(action: () => Promise<T>): Promise<T> {
    const next = this.queue.then(action);
    this.queue = next.catch(() => {});
    return next;
  }

  private file(key: string): string {
    if (key === 'pack') return path.join(this.directory, 'sounds', 'pack.zip');
    if (key.startsWith('pack:') && isSoundPackId(key.slice(5))) return path.join(this.directory, 'sounds', 'packs', `${key.slice(5)}.zip`);
    if (!SOUND_EVENTS.some(e => key === `sound:${e.id}`)) throw new Error('Invalid sound key');
    return path.join(this.directory, 'sounds', `${key.slice(6)}.audio`);
  }

  private async atomic(file: string, data: string | Uint8Array): Promise<void> {
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    // Per process: a dev build and the packaged app can share this directory.
    // Synced before the rename, so a crash cannot leave a truncated file in place.
    const tmp = `${file}.${process.pid}.tmp`;
    try {
      const handle = await fs.open(tmp, 'w', 0o600);
      try {
        await handle.writeFile(data);
        await handle.sync();
      } finally { await handle.close(); }
      await fs.rename(tmp, file);
    } catch (e) {
      await fs.rm(tmp, { force: true }).catch(() => {});
      throw e;
    }
  }

  load(): Promise<LoadedSoundSettings | null> {
    return this.serial(async () => {
      const file = path.join(this.directory, 'sounds.json');
      let text: string;
      try { text = await fs.readFile(file, 'utf8'); }
      catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
      try {
        const parsed: unknown = JSON.parse(text);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return normalizeSoundSettings(parsed);
      } catch { /* rebuilt below */ }
      return this.recover(file);
    });
  }

  // Lists the archives and files still on disk, so a damaged sounds.json cannot lose them.
  // The damaged file is kept beside it for anyone who wants to repair it by hand.
  private async recover(file: string): Promise<LoadedSoundSettings> {
    await fs.copyFile(file, `${file}.damaged`);
    const names = (dir: string) => fs.readdir(dir).catch(() => [] as string[]);
    const settings = defaultSoundSettings();
    for (const name of (await names(path.join(this.directory, 'sounds', 'packs'))).sort()) {
      const id = name.replace(/\.zip$/, '');
      if (name.endsWith('.zip') && isSoundPackId(id)) settings.packs.push({ id, name: `Recovered pack ${id.slice(0, 8)}` });
    }
    const stored = new Set(await names(path.join(this.directory, 'sounds')));
    for (const { id } of SOUND_EVENTS) if (stored.has(`${id}.audio`)) settings.custom[id] = { name: `${id}.audio` };
    await this.atomic(file, JSON.stringify(settings, null, 2) + '\n');
    return { ...settings, recovered: true };
  }

  save(settings: unknown): Promise<void> {
    const snapshot = normalizeSoundSettings(settings);
    return this.serial(() => this.atomic(path.join(this.directory, 'sounds.json'), JSON.stringify(snapshot, null, 2) + '\n'));
  }

  read(key: string): Promise<Uint8Array | null> {
    const file = this.file(key);
    return this.serial(async () => {
      try { return await fs.readFile(file); }
      catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
    });
  }

  write(key: string, bytes: Uint8Array): Promise<void> {
    const file = this.file(key);
    if (!(bytes instanceof Uint8Array) || bytes.length > (key === 'pack' || key.startsWith('pack:') ? MAX_AUDIO_PACK : MAX_AUDIO_FILE)) {
      return Promise.reject(new Error('Invalid or oversized sound data'));
    }
    return this.serial(() => this.atomic(file, bytes));
  }

  remove(key: string): Promise<void> {
    const file = this.file(key);
    return this.serial(() => fs.rm(file, { force: true }));
  }
}
