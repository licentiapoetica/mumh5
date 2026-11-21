import { load, save } from '../storage.ts';
import { voice } from './voice.svelte.ts';
import { desktop } from '../native.ts';
import { putBlob, getBlob, deleteBlob } from '../blobstore.ts';
import { zipSync } from 'fflate';
import { isPackClip, listAudioPack, readAudioPack, readPackClip, MAX_AUDIO_FILE, MAX_AUDIO_PACK } from '../../core/audio-pack.ts';
import { SOUND_EVENTS, PACK_PATHS, QUIET_EVENTS, STATE_EVENTS, upgradeSoundSettings, type SoundEvent, type SoundSettings, type SoundPack } from '../../core/sound-events.ts';
import { renderTones } from './tones.ts';
import defaultPackUrl from '../../assets/default-audio-pack.zip?url';

export { SOUND_EVENTS, type SoundEvent } from '../../core/sound-events.ts';
export interface PackReport { assigned: string[]; unmatched: string[]; failed: string[] }

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
// A clip that never starts or never reports its end must not hold the one playback slot.
const START_LIMIT = 5000;
const UNKNOWN_LENGTH_LIMIT = 60000;
const STANDARD_FAILED = 'Could not load the standard pack';
const VOLUME_SAVE_DELAY = 300;

function earlierInstall(): boolean {
  try { return ['mumh5.settings', 'mumh5.voice', 'mumh5.servers'].some(key => localStorage.getItem(key) !== null); }
  catch { return false; }
}

// An archive kept whole; a clip is unpacked the first time it plays.
interface OpenPack { bytes: Uint8Array; names: Set<string>; urls: Map<string, string> }

class Sounds {
  settings = $state<SoundSettings>(upgradeSoundSettings(load<unknown>('mumh5.sounds', null), earlierInstall()));
  loaded = $state(false);
  clipsReady = $state(false);
  busy = $state(false);
  packClips = $state<string[]>([]);
  errors = $state<string[]>([]);
  private tones = new Map<SoundEvent, Promise<string>>();
  private urls = new Map<SoundEvent, string>();
  private standard: OpenPack | null = null;
  private userPack: OpenPack | null = null;
  private preparing: Promise<void> | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private ready: Promise<void>;
  private active: HTMLAudioElement | null = null;
  private playing = false;
  private generation = 0;
  private watchdog: ReturnType<typeof setTimeout> | undefined;
  private saveBlocked = false;
  private lastPlayed = new Map<SoundEvent, number>();

  constructor() {
    voice.onPtt = down => { void this.play(down ? 'pttDown' : 'pttUp'); };
    voice.onTalkingWhileMuted = () => { void this.play('talkingWhileMuted'); };
    this.ready = this.loadStored().catch(e => this.error(`Could not load sounds: ${e.message}`)).finally(() => { this.loaded = true; });
    addEventListener('pagehide', () => this.flush());
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

  private openPack(bytes: Uint8Array, names: Iterable<string>): OpenPack {
    return { bytes, names: new Set(names), urls: new Map() };
  }

  private clearUrls(urls: Map<unknown, string>): void {
    for (const url of urls.values()) URL.revokeObjectURL(url);
    urls.clear();
  }

  private refreshClips(): void {
    this.packClips = [...new Set([...(this.standard?.names ?? []), ...(this.userPack?.names ?? [])])].sort();
  }

  // The active pack first; a clip it lacks or cannot unpack comes from the standard pack.
  private clipUrl(path: string): string | undefined {
    for (const pack of [this.userPack, this.standard]) {
      if (!pack?.names.has(path)) continue;
      const known = pack.urls.get(path);
      if (known) return known;
      try {
        const url = URL.createObjectURL(new Blob([readPackClip(pack.bytes, path)], { type: 'audio/wav' }));
        pack.urls.set(path, url);
        return url;
      } catch (e) { this.error(`Could not read ${path}: ${(e as Error).message}`); }
    }
    return undefined;
  }

  // Loaded on first use, so nothing is fetched or kept while no sound plays and Sounds stays closed.
  prepare(): Promise<void> {
    this.preparing ??= this.loadClips().finally(() => {
      this.clipsReady = true;
      // Offline: try again at the next use
      if (!this.standard) this.preparing = null;
    });
    return this.preparing;
  }

  private async loadClips(): Promise<void> {
    await this.ready;
    // A failure here must not keep the user's own pack from loading.
    if (!this.standard) {
      try {
        const response = await fetch(defaultPackUrl);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        this.standard = this.openPack(bytes, listAudioPack(bytes));
        this.errors = this.errors.filter(e => !e.startsWith(STANDARD_FAILED));
      } catch (e) { this.error(`${STANDARD_FAILED}: ${(e as Error).message}`); }
    }
    const saved = this.settings.pack;
    if (saved && !this.userPack) {
      try {
        const blob = await this.read(saved.id ? `pack:${saved.id}` : 'pack');
        if (!blob) throw new Error('The saved ZIP is missing.');
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let names: Iterable<string>;
        if (saved.id) names = listAudioPack(bytes);
        else {
          // Preserve the previous single ZIP as the first library entry.
          const clips = readAudioPack(bytes);
          this.settings.pack = await this.rememberPack(saved.name, blob, clips);
          await this.persist();
          names = clips.keys();
        }
        // The user may have switched packs while this one was being read
        if (!this.userPack && (!saved.id || this.settings.pack?.id === saved.id)) this.userPack = this.openPack(bytes, names);
      } catch (e) { this.error(`Could not load ${saved.name}: ${(e as Error).message} Using the standard pack.`); }
    }
    this.refreshClips();
  }

  private async loadStored(): Promise<void> {
    let migrate = false;
    if (desktop) {
      try {
        const disk = await desktop.sounds.load();
        if (disk) {
          const { recovered, ...saved } = disk;
          delete this.settings.pack;
          Object.assign(this.settings, saved);
          if (recovered) this.error('Sound settings were damaged and have been reset. Saved packs and files were kept.');
        } else migrate = true;
      } catch (e) {
        // Saving now would replace a file that may be fine with stale settings.
        this.saveBlocked = true;
        this.error(`Could not read sound settings, so changes will not be saved: ${(e as Error).message}`);
      }
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
          if (!this.saveBlocked && (migrate || custom.data)) await this.write(`sound:${id}`, blob);
          delete custom.data;
          this.urls.set(id, URL.createObjectURL(blob));
        } else delete this.settings.custom[id];
      } catch (e) { this.error(`Could not load ${custom.name}: ${(e as Error).message}`); }
    }
    await this.persist();
  }

  private async persist(): Promise<void> {
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    if (this.saveBlocked) return;
    const snapshot = $state.snapshot(this.settings);
    try {
      if (desktop) await desktop.sounds.save(snapshot);
      else save('mumh5.sounds', snapshot);
    } catch (e) { this.error(`Could not save sound settings: ${(e as Error).message}`); }
  }

  // Writes a change the volume slider is still holding back.
  flush(): void {
    if (this.saveTimer !== undefined) void this.persist();
  }

  update(patch: Partial<Pick<SoundSettings, 'enabled' | 'volume'>>): void {
    Object.assign(this.settings, patch);
    if (this.active) this.active.volume = Math.max(0, Math.min(1, this.settings.volume));
    if (!this.settings.enabled || !this.settings.volume) this.stop();
    if (!('volume' in patch)) { void this.persist(); return; }
    // The slider reports every step, and each save is a synced file write on desktop
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.persist(), VOLUME_SAVE_DELAY);
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

  // The saved choice while the active pack has it; it comes back when switching to a pack that does.
  selectedClip(ev: SoundEvent): string {
    const chosen = this.settings.clips?.[ev];
    return chosen && this.packClips.includes(chosen) ? chosen : '';
  }

  clipFor(ev: SoundEvent): string | undefined { return this.selectedClip(ev) || PACK_PATHS[ev]; }

  // Puts files set aside by a pack switch back in use, for one event or all of them.
  useCustom(ev?: SoundEvent): void {
    for (const id of ev ? [ev] : SOUND_EVENTS.map(e => e.id)) {
      const custom = this.settings.custom[id];
      if (custom) delete custom.parked;
    }
    void this.persist();
  }

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

  private async rememberPack(name: string, blob: Blob, clips: Map<string, Uint8Array<ArrayBuffer>>): Promise<SoundPack> {
    // Identify the audio, not ZIP timestamps/compression or the source folder name.
    const hashes = await Promise.all([...clips].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(async ([path, data]) => {
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
      return `${path}:${[...digest].map(b => b.toString(16).padStart(2, '0')).join('')}`;
    }));
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(hashes.join('\n'))));
    const id = [...hash].map(b => b.toString(16).padStart(2, '0')).join('');
    // Written for known packs too, so importing again repairs a missing or damaged archive.
    await this.write(`pack:${id}`, blob);
    const existing = this.settings.packs.find(p => p.id === id);
    if (existing) return existing;
    let label = name.slice(0, 240), n = 2;
    while (this.settings.packs.some(p => p.name === label)) label = `${name.slice(0, 230)} (${n++})`;
    const entry = { id, name: label };
    this.settings.packs.push(entry);
    return entry;
  }

  private async clearCustomFiles(): Promise<void> {
    for (const { id } of SOUND_EVENTS) if (this.settings.custom[id]) await this.remove(`sound:${id}`);
    this.clearUrls(this.urls);
    this.settings.custom = {};
  }

  private async activatePack(entry: SoundPack | undefined, pack: OpenPack | null): Promise<void> {
    this.stop();
    // Active files would hide the new pack's audio; they are set aside, not deleted.
    for (const { id } of SOUND_EVENTS) {
      const custom = this.settings.custom[id];
      if (custom) custom.parked = true;
    }
    if (this.userPack) this.clearUrls(this.userPack.urls);
    this.userPack = pack;
    if (entry) this.settings.pack = entry;
    else delete this.settings.pack;
    this.refreshClips();
    await this.persist();
  }

  async selectPack(id: string): Promise<void> {
    await this.prepare();
    if (id === (this.settings.pack?.id ?? '')) return;
    if (!id) return this.activatePack(undefined, null);
    const entry = this.settings.packs.find(p => p.id === id);
    if (!entry) throw new Error('Sound pack is not in your library.');
    const blob = await this.read(`pack:${id}`);
    if (!blob) throw new Error('The saved sound pack is missing.');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    await this.activatePack(entry, this.openPack(bytes, listAudioPack(bytes)));
  }

  async removePack(id: string): Promise<void> {
    await this.prepare();
    if (!this.settings.packs.some(p => p.id === id)) return;
    if (this.settings.pack?.id === id) await this.selectPack('');
    await this.remove(`pack:${id}`);
    this.settings.packs = this.settings.packs.filter(p => p.id !== id);
    await this.persist();
  }

  async importZip(file: File): Promise<PackReport> {
    await this.prepare();
    if (file.size > MAX_AUDIO_PACK) throw new Error('Sound packs must be at most 32 MB.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const clips = readAudioPack(bytes);
    // Content IDs keep every distinct pack; importing the same archive is a no-op
    // for the library, even when its file name differs.
    const entry = await this.rememberPack(file.name, file, clips);
    await this.activatePack(entry, this.openPack(bytes, clips.keys()));
    return {
      assigned: SOUND_EVENTS.filter(e => clips.has(PACK_PATHS[e.id] ?? '')).map(e => `${PACK_PATHS[e.id]}: ${e.name}`),
      unmatched: [],
      failed: []
    };
  }

  async loadPack(files: File[]): Promise<PackReport> {
    await this.ready;
    const inFolder = (f: File) => f.webkitRelativePath.split('/').slice(1).join('/');
    const folderClips = files.filter(f => isPackClip(inFolder(f)));
    if (folderClips.length) {
      const entries: Record<string, Uint8Array<ArrayBuffer>> = {};
      // The size of the stored ZIP (file, both headers with the name, end record), known
      // before anything is read. Stored, not compressed: WAV barely shrinks and this runs on the UI thread.
      const archive = folderClips.reduce((n, f) => n + f.size + 76 + 2 * new TextEncoder().encode(inFolder(f)).length, 22);
      if (folderClips.length > 512 || archive > MAX_AUDIO_PACK) throw new Error('Sound pack folders must be at most 32 MB and 512 clips.');
      for (const file of folderClips.sort((a, b) => a.webkitRelativePath.localeCompare(b.webkitRelativePath))) {
        if (file.size > MAX_AUDIO_FILE) throw new Error(`${file.name} is larger than 4 MB.`);
        entries[inFolder(file)] = new Uint8Array(await file.arrayBuffer());
      }
      const name = folderClips[0].webkitRelativePath.split('/')[0];
      const bytes = zipSync(entries, { level: 0, mtime: new Date('2000-01-01T00:00:00Z') });
      return this.importZip(new File([bytes], `${name}.zip`, { type: 'application/zip' }));
    }
    const assigned: string[] = [], unmatched: string[] = [], failed = new Set<string>();
    const audio = files.filter(f => AUDIO.test(f.name));
    const byName = new Map(audio.map(f => [f.name.toLowerCase(), f]));
    const used = new Set<File>();
    // One bad file is reported and skipped, so the rest of the pack still applies.
    const assign = async (ev: SoundEvent, file: File, label: string) => {
      used.add(file);
      const error = await this.setCustom(ev, file);
      if (error) failed.add(error);
      else assigned.push(`${file.name}: ${label}`);
    };
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
        if (file) await assign(e.id, file, e.name);
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
        for (const ev of events) await assign(ev, f, SOUND_EVENTS.find(e => e.id === ev)!.name);
      }
    }
    for (const f of audio) if (!used.has(f)) unmatched.push(f.name);
    return { assigned, unmatched, failed: [...failed] };
  }

  async resetAll(): Promise<void> {
    await this.prepare();
    await this.clearCustomFiles();
    await this.activatePack(undefined, null);
    this.settings.clips = {};
    this.refreshClips();
    await this.persist();
  }

  private ownFile(ev: SoundEvent): string | undefined {
    return this.settings.custom[ev]?.parked ? undefined : this.urls.get(ev);
  }

  private async source(ev: SoundEvent): Promise<string> {
    const custom = this.ownFile(ev);
    if (custom) return custom;
    await this.prepare();
    const path = this.clipFor(ev);
    const clip = path && this.clipUrl(path);
    if (clip) return clip;
    let p = this.tones.get(ev);
    if (!p) this.tones.set(ev, (p = renderTones(ev)));
    return p;
  }

  stop(): void {
    this.generation++;
    clearTimeout(this.watchdog);
    this.playing = false;
    this.active?.pause();
    this.active = null;
  }

  private guard(generation: number, ms: number): void {
    clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => { if (generation === this.generation) this.stop(); }, ms);
  }

  // No queue: routine events are dropped while a clip plays instead of building a backlog
  // of speech. Previews, mic state changes and alerts replace the current clip.
  async play(ev: SoundEvent, force = false): Promise<void> {
    await this.ready;
    const silent = () => !force && (!this.settings.enabled || !this.isOn(ev) || !this.settings.volume);
    if (silent()) return;
    // Before the start timer: the first sound may have to download the standard pack
    if (!this.ownFile(ev)) await this.prepare();
    if (silent()) return;
    const state = STATE_EVENTS.has(ev);
    const replaces = force || state || QUIET_EVENTS.has(ev);
    if (!replaces && this.playing) return;
    const now = performance.now();
    if (!force && !state && now - (this.lastPlayed.get(ev) ?? -Infinity) < 1500) return;
    this.lastPlayed.set(ev, now);
    if (replaces) this.stop();
    const generation = this.generation;
    this.playing = true;
    this.guard(generation, START_LIMIT);
    try {
      const source = await this.source(ev);
      if (generation !== this.generation) return;
      const el = new Audio(source) as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
      this.active = el;
      // Any way a clip can end frees the slot, including a system pause or a decode error
      const finished = () => { if (generation === this.generation) this.stop(); };
      for (const type of ['ended', 'error', 'pause']) el.addEventListener(type, finished, { once: true });
      el.volume = Math.max(0, Math.min(1, this.settings.volume));
      const sink = voice.settings.outputDevice;
      if (sink && sink !== 'default' && el.setSinkId) await el.setSinkId(sink).catch(() => {});
      if (generation !== this.generation) return;
      if (!force && (!this.settings.enabled || !this.isOn(ev))) { this.stop(); return; }
      await el.play();
      if (generation === this.generation) this.guard(generation, Number.isFinite(el.duration) ? el.duration * 1000 + 1000 : UNKNOWN_LENGTH_LIMIT);
      const log = ((window as any).__mumh5Sounds ??= []) as string[];
      log.push(ev);
      if (log.length > 50) log.shift();
    } catch (e) {
      if (generation !== this.generation) return;
      this.stop();
      this.error(`Could not play ${SOUND_EVENTS.find(x => x.id === ev)?.name}: ${(e as Error).message}`);
    }
  }
}

export const sounds = new Sounds();
