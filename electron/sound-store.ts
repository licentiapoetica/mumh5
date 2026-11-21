import { promises as fs } from 'node:fs';
import path from 'node:path';
import { SOUND_EVENTS, isSoundPackId, normalizeSoundSettings, type SoundSettings } from '../src/core/sound-events.ts';
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
    await fs.writeFile(`${file}.tmp`, data, { mode: 0o600 });
    await fs.rename(`${file}.tmp`, file);
  }

  load(): Promise<SoundSettings | null> {
    return this.serial(async () => {
      try { return normalizeSoundSettings(JSON.parse(await fs.readFile(path.join(this.directory, 'sounds.json'), 'utf8'))); }
      catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
    });
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
