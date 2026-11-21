import { load, save } from '../storage.ts';
import { voice } from './voice.svelte.ts';
import { desktop } from '../native.ts';
import { putBlob, getBlob, deleteBlob } from '../blobstore.ts';
import { readAudioPack, MAX_AUDIO_FILE, MAX_AUDIO_PACK } from '../../core/audio-pack.ts';
import { SOUND_EVENTS, PACK_PATHS, QUIET_EVENTS, defaultSoundSettings, normalizeSoundSettings, type SoundEvent, type SoundSettings } from '../../core/sound-events.ts';
import { renderTones } from './tones.ts';
import defaultPackUrl from '../../assets/default-audio-pack.zip?url';

export { SOUND_EVENTS, type SoundEvent } from '../../core/sound-events.ts';
export interface PackReport { assigned: string[]; unmatched: string[] }

// TeamSpeak folder imports remain supported alongside Mumble ZIP packs.
export function parseTsPack(ini: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of ini.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*play\("([^"]+)"\)/.exec(line);
    if (m) out.set(m[1], m[2]);
  }
  return out;
}

const AUDIO = /\.(wav|mp3|ogg|oga|opus|flac|m4a|aac|webm)$/i;

class Sounds {
  settings = $state<SoundSettings>(normalizeSoundSettings(load('mumh5.sounds', defaultSoundSettings())));
  loaded = $state(false);
  busy = $state(false);
  packClips = $state<string[]>([]);
  errors = $state<string[]>([]);
  private tones = new Map<SoundEvent, Promise<string>>();
  private urls = new Map<SoundEvent, string>();
  private builtin = new Map<string, string>();
  private packUrls = new Map<string, string>();
  private ready: Promise<void>;
  private active: HTMLAudioElement | null = null;
  private playing = false;
  private generation = 0;
  private lastPlayed = new Map<SoundEvent, number>();

  constructor() {
    voice.onPtt = down => { void this.play(down ? 'pttDown' : 'pttUp'); };
    voice.onTalkingWhileMuted = () => { void this.play('talkingWhileMuted'); };
    this.ready = this.loadStored().catch(e => this.error(`Could not load sounds: ${e.message}`)).finally(() => { this.loaded = true; });
  }

  private error(message: string): void {
    if (!this.errors.includes(message)) this.errors = [...this.errors.slice(-4), message];
  }

  private async read(key: string): Promise<Blob | undefined> {
    if (!desktop) return getBlob(key);
    const bytes = await desktop.sounds.read(key);
    return bytes ? new Blob([new Uint8Array(bytes)], { type: key === 'pack' ? 'application/zip' : '' }) : undefined;
  }

  private async write(key: string, blob: Blob): Promise<void> {
    if (desktop) await desktop.sounds.write(key, new Uint8Array(await blob.arrayBuffer()));
    else await putBlob(key, blob);
  }

  private async remove(key: string): Promise<void> {
    if (desktop) await desktop.sounds.remove(key);
    else await deleteBlob(key);
  }

  private makeUrls(clips: Map<string, Uint8Array<ArrayBuffer>>): Map<string, string> {
    return new Map([...clips].map(([name, data]) => [name, URL.createObjectURL(new Blob([data], { type: 'audio/wav' }))]));
  }

  private clearUrls(urls: Map<unknown, string>): void {
    for (const url of urls.values()) URL.revokeObjectURL(url);
    urls.clear();
  }

  private refreshClips(): void {
    this.packClips = [...new Set([...this.builtin.keys(), ...this.packUrls.keys()])].sort();
  }

  private async loadStored(): Promise<void> {
    let migrate = false;
    if (desktop) {
      const disk = await desktop.sounds.load();
      if (disk) {
        delete this.settings.pack;
        Object.assign(this.settings, disk);
      }
      else migrate = true;
    }
    for (const { id } of SOUND_EVENTS) {
      const custom = this.settings.custom[id];
      if (!custom) continue;
      try {
        let blob: Blob | undefined;
        if (custom.data) {
          const [meta, b64] = custom.data.split(',');
          blob = new Blob([Uint8Array.from(atob(b64), ch => ch.charCodeAt(0))], { type: /^data:([^;]+)/.exec(meta)?.[1] ?? 'audio/wav' });
        } else blob = migrate ? await getBlob(`sound:${id}`) : await this.read(`sound:${id}`);
        if (blob) {
          if (migrate || custom.data) await this.write(`sound:${id}`, blob);
          delete custom.data;
          this.urls.set(id, URL.createObjectURL(blob));
        } else delete this.settings.custom[id];
      } catch (e) { this.error(`Could not load ${custom.name}: ${(e as Error).message}`); }
    }
    await this.persist();
    // Vite emits the archive as a hashed asset, also included in the PWA offline cache.
    const response = await fetch(defaultPackUrl);
    if (!response.ok) throw new Error('The built-in voice pack is unavailable.');
    this.builtin = this.makeUrls(readAudioPack(new Uint8Array(await response.arrayBuffer())));
    if (this.settings.pack) {
      try {
        const blob = await this.read('pack');
        if (!blob) throw new Error('The saved ZIP is missing.');
        this.packUrls = this.makeUrls(readAudioPack(new Uint8Array(await blob.arrayBuffer())));
      } catch (e) { this.error(`Could not load ${this.settings.pack.name}: ${(e as Error).message} Using the standard pack.`); }
    }
    this.refreshClips();
  }

  private async persist(): Promise<void> {
    const snapshot = $state.snapshot(this.settings);
    try {
      if (desktop) await desktop.sounds.save(snapshot);
      else save('mumh5.sounds', snapshot);
    } catch (e) { this.error(`Could not save sound settings: ${(e as Error).message}`); }
  }

  update(patch: Partial<Pick<SoundSettings, 'enabled' | 'volume'>>): void {
    Object.assign(this.settings, patch);
    if (this.active) this.active.volume = Math.max(0, Math.min(1, this.settings.volume));
    if (!this.settings.enabled || !this.settings.volume) this.stop();
    void this.persist();
  }

  isOn(ev: SoundEvent): boolean { return this.settings.on[ev] ?? QUIET_EVENTS.has(ev); }

  setOn(ev: SoundEvent, on: boolean): void {
    this.settings.on[ev] = on;
    void this.persist();
  }

  quietDefaults(): void {
    this.settings.on = {};
    this.stop();
    void this.persist();
  }

  clipFor(ev: SoundEvent): string | undefined { return this.settings.clips?.[ev] ?? PACK_PATHS[ev]; }

  selectClip(ev: SoundEvent, path: string): void {
    this.settings.clips ??= {};
    if (path && this.packClips.includes(path)) this.settings.clips[ev] = path;
    else delete this.settings.clips[ev];
    void this.persist();
  }

  async setCustom(ev: SoundEvent, file: File): Promise<string | null> {
    await this.ready;
    if (file.size > MAX_AUDIO_FILE) return `${file.name} is larger than 4 MB`;
    if (!/^audio\//.test(file.type) && !AUDIO.test(file.name)) return `${file.name} is not an audio file`;
    try { await this.write(`sound:${ev}`, file); }
    catch (e) { return `Could not store ${file.name}: ${(e as Error).message}`; }
    const old = this.urls.get(ev);
    if (old) URL.revokeObjectURL(old);
    this.urls.set(ev, URL.createObjectURL(file));
    this.settings.custom[ev] = { name: file.name };
    await this.persist();
    return null;
  }

  async reset(ev: SoundEvent): Promise<void> {
    await this.ready;
    try { await this.remove(`sound:${ev}`); }
    catch (e) { this.error(`Could not reset sound: ${(e as Error).message}`); return; }
    delete this.settings.custom[ev];
    delete this.settings.clips?.[ev];
    const url = this.urls.get(ev);
    if (url) URL.revokeObjectURL(url);
    this.urls.delete(ev);
    await this.persist();
  }

  async importZip(file: File): Promise<PackReport> {
    await this.ready;
    if (file.size > MAX_AUDIO_PACK) throw new Error('Sound packs must be at most 32 MB.');
    const clips = readAudioPack(new Uint8Array(await file.arrayBuffer()));
    // Validate the complete archive before replacing the previous pack.
    await this.write('pack', file);
    this.stop();
    this.clearUrls(this.packUrls);
    this.packUrls = this.makeUrls(clips);
    this.settings.pack = { name: file.name };
    this.refreshClips();
    await this.persist();
    return {
      assigned: SOUND_EVENTS.filter(e => clips.has(PACK_PATHS[e.id] ?? '')).map(e => `${PACK_PATHS[e.id]}: ${e.name}`),
      unmatched: []
    };
  }

  async loadPack(files: File[]): Promise<PackReport> {
    await this.ready;
    const assigned: string[] = [], unmatched: string[] = [];
    const audio = files.filter(f => AUDIO.test(f.name));
    const byName = new Map(audio.map(f => [f.name.toLowerCase(), f]));
    const used = new Set<File>();
    const ini = files.find(f => /settings\.ini$/i.test(f.name));
    if (ini) {
      const entries = parseTsPack(await ini.text());
      for (const e of SOUND_EVENTS) {
        const wanted = entries.get(e.ts);
        if (!wanted) continue;
        const suffix = wanted.replace(/^.*\$\{clientType\}_?/, '').toLowerCase();
        const file = wanted.includes('${clientType}')
          ? byName.get(`neutral_${suffix}`) ?? audio.find(f => f.name.toLowerCase().endsWith(`_${suffix}`))
          : byName.get(wanted.toLowerCase());
        if (file) {
          const error = await this.setCustom(e.id, file);
          if (error) throw new Error(error);
          assigned.push(`${file.name}: ${e.name}`);
          used.add(file);
        }
      }
    } else {
      for (const f of audio) {
        const relative = f.webkitRelativePath.split('/').slice(1).join('/');
        const exact = SOUND_EVENTS.filter(e => PACK_PATHS[e.id] === relative);
        const base = f.name.toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[\s-]+/g, '_');
        let best: { ev: SoundEvent; score: number } | null = null;
        for (const e of SOUND_EVENTS) for (const k of e.keys) {
          const score = base === k ? 1000 : base.includes(k) ? k.length : 0;
          if (score && (!best || score > best.score)) best = { ev: e.id, score };
        }
        const events = exact.length ? exact.map(e => e.id) : best ? [best.ev] : [];
        for (const ev of events) {
          const error = await this.setCustom(ev, f);
          if (error) throw new Error(error);
          assigned.push(`${f.name}: ${SOUND_EVENTS.find(e => e.id === ev)!.name}`);
          used.add(f);
        }
      }
    }
    for (const f of audio) if (!used.has(f)) unmatched.push(f.name);
    return { assigned, unmatched };
  }

  async resetAll(): Promise<void> {
    await this.ready;
    this.stop();
    await this.remove('pack');
    this.clearUrls(this.packUrls);
    delete this.settings.pack;
    for (const { id } of SOUND_EVENTS) if (this.settings.custom[id]) await this.reset(id);
    this.settings.clips = {};
    this.refreshClips();
    await this.persist();
  }

  private async source(ev: SoundEvent): Promise<string> {
    const custom = this.urls.get(ev);
    if (custom) return custom;
    const path = this.clipFor(ev);
    const clip = path && (this.packUrls.get(path) ?? this.builtin.get(path));
    if (clip) return clip;
    let p = this.tones.get(ev);
    if (!p) this.tones.set(ev, (p = renderTones(ev)));
    return p;
  }

  stop(): void {
    this.generation++;
    this.playing = false;
    this.active?.pause();
    this.active = null;
  }

  // No queue: a busy voice notification drops new events instead of building a
  // backlog of speech. Preview replaces the current clip and ignores event toggles.
  async play(ev: SoundEvent, force = false): Promise<void> {
    await this.ready;
    if (!force && (!this.settings.enabled || !this.isOn(ev) || !this.settings.volume || this.playing || (this.active && !this.active.ended))) return;
    const now = performance.now();
    if (!force && now - (this.lastPlayed.get(ev) ?? -Infinity) < 1500) return;
    this.lastPlayed.set(ev, now);
    if (force) this.stop();
    const generation = this.generation;
    this.playing = true;
    try {
      const source = await this.source(ev);
      if (generation !== this.generation) return;
      const el = new Audio(source) as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
      this.active = el;
      el.volume = Math.max(0, Math.min(1, this.settings.volume));
      const sink = voice.settings.outputDevice;
      if (sink && sink !== 'default' && el.setSinkId) await el.setSinkId(sink).catch(() => {});
      if (generation !== this.generation || (!force && (!this.settings.enabled || !this.isOn(ev)))) return;
      await el.play();
      const log = ((window as any).__mumh5Sounds ??= []) as string[];
      log.push(ev);
      if (log.length > 50) log.shift();
    } catch (e) {
      if (generation !== this.generation) return;
      this.stop();
      this.error(`${SOUND_EVENTS.find(x => x.id === ev)?.name}: ${(e as Error).message}`);
    } finally { if (generation === this.generation) this.playing = false; }
  }
}

export const sounds = new Sounds();
