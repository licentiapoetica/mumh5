import { load, save } from '../storage.ts';
import { voice } from './voice.svelte.ts';
import { putBlob, getBlob, deleteBlob } from '../blobstore.ts';

// Notification sounds for events, like the desktop client. Every event has a synthesized
// default; users can replace any of them with their own file (or a whole sound pack).

// ts: the TeamSpeak 3 sound pack key for the same event, so a TS pack's settings.ini maps exactly.
// keys: file name fragments for packs without a settings.ini.
export const SOUND_EVENTS = [
  { id: 'connected', group: 'Connection', name: 'You connected', ts: 'CONNECTION_CONNECTED', keys: ['connected_welcome', 'connected', 'login', 'welcome'] },
  { id: 'disconnected', group: 'Connection', name: 'You disconnected', ts: 'CONNECTION_DISCONNECTED', keys: ['disconnected', 'disconnect', 'logout'] },
  { id: 'connectionLost', group: 'Connection', name: 'Connection lost', ts: 'CONNECTION_LOST_CONNECTION', keys: ['connection_lost', 'lost'] },
  { id: 'error', group: 'Connection', name: 'Server refused or error', ts: 'SERVER_ERROR', keys: ['error'] },
  { id: 'switchedChannel', group: 'You', name: 'You switched channel', ts: 'YOU_SWITCHED_CHANNEL', keys: ['channel_switched', 'switched'] },
  { id: 'moved', group: 'You', name: 'You were moved', ts: 'YOU_WERE_MOVED_TO_DIFFERENT_CHANNEL', keys: ['you_were_moved', 'moved'] },
  { id: 'kicked', group: 'You', name: 'You were kicked', ts: 'YOU_WERE_KICKED_FROM_SERVER', keys: ['you_kicked_server', 'kicked'] },
  { id: 'banned', group: 'You', name: 'You were banned', ts: 'YOU_WERE_BANNED', keys: ['you_were_banned', 'banned'] },
  { id: 'denied', group: 'You', name: 'Permission denied', ts: 'SERVER_INSUFFICIENT_PERMISSIONS', keys: ['insufficient_permissions', 'denied'] },
  { id: 'userConnected', group: 'Your channel', name: 'Someone connected into your channel', ts: 'CLIENT_CONNECTION_CONNECTED_CURRENT_CHANNEL', keys: ['connection_connected_currentchannel', 'user_connected'] },
  { id: 'userDisconnected', group: 'Your channel', name: 'Someone in your channel disconnected', ts: 'CLIENT_CONNECTION_DISCONNECTED_CURRENT_CHANNEL', keys: ['connection_disconnected_currentchannel', 'user_disconnected'] },
  { id: 'userJoined', group: 'Your channel', name: 'Someone joined your channel', ts: 'CLIENT_SWITCHED_TO_CURRENT_CHANNEL_APPEARS', keys: ['switched_tocurrentchannel', 'user_joined', 'joined', 'join'] },
  { id: 'userLeft', group: 'Your channel', name: 'Someone left your channel', ts: 'CLIENT_SWITCHED_FROM_CURRENT_CHANNEL_DISAPPEARS', keys: ['switched_awayfromcurrentchannel', 'user_left', 'left', 'leave'] },
  { id: 'userMovedIn', group: 'Your channel', name: 'Someone was moved into your channel', ts: 'CLIENT_MOVED_TO_CURRENT_CHANNEL_APPEARS', keys: ['moved_tocurrentchannel'] },
  { id: 'userMovedOut', group: 'Your channel', name: 'Someone was moved out of your channel', ts: 'CLIENT_MOVED_FROM_CURRENT_CHANNEL_DISAPPEARS', keys: ['moved_awayfromcurrentchannel'] },
  { id: 'userKicked', group: 'Your channel', name: 'Someone in your channel was kicked', ts: 'CLIENT_WAS_KICKED_FROM_SERVER_CURRENT_CHANNEL', keys: ['kicked_server_currentchannel'] },
  { id: 'userBanned', group: 'Your channel', name: 'Someone in your channel was banned', ts: 'CLIENT_WAS_BANNED_CURRENT_CHANNEL', keys: ['banned_server_currentchannel'] },
  { id: 'recordingStarted', group: 'Your channel', name: 'Someone started recording', ts: 'CLIENT_RECORDING_START', keys: ['recording_started'] },
  { id: 'recordingStopped', group: 'Your channel', name: 'Someone stopped recording', ts: 'CLIENT_RECORDING_STOP', keys: ['recording_stopped'] },
  { id: 'message', group: 'Chat', name: 'Channel message', ts: 'CHAT_RECEIVED_MESSAGE_CHANNEL', keys: ['chat_message_inbound', 'message'] },
  { id: 'privateMessage', group: 'Chat', name: 'Direct message', ts: 'CHAT_RECEIVED_MESSAGE_CLIENT', keys: ['private', 'direct', 'pm'] },
  { id: 'messageSent', group: 'Chat', name: 'You sent a message', ts: 'CHAT_SENT_MESSAGE_CHANNEL', keys: ['chat_message_outbound', 'sent'], off: true },
  { id: 'uploadDone', group: 'Chat', name: 'Upload finished', ts: 'OTHER_FILETRANSFER_COMPLETE', keys: ['filetransfer_complete', 'upload_done'] },
  { id: 'uploadFailed', group: 'Chat', name: 'Upload failed', ts: 'OTHER_FILETRANSFER_FAILED', keys: ['filetransfer_failed', 'upload_failed'] },
  { id: 'mute', group: 'Microphone and sound', name: 'You muted', ts: 'SOUND_CAPTURE_MUTED', keys: ['mic_muted', 'mute'] },
  { id: 'unmute', group: 'Microphone and sound', name: 'You unmuted', ts: 'SOUND_CAPTURE_UNMUTED', keys: ['mic_activated', 'unmute'] },
  { id: 'deafen', group: 'Microphone and sound', name: 'You deafened', ts: 'SOUND_PLAYBACK_MUTED', keys: ['sound_muted', 'deafen'] },
  { id: 'undeafen', group: 'Microphone and sound', name: 'You undeafened', ts: 'SOUND_PLAYBACK_UNMUTED', keys: ['sound_resumed', 'undeafen'] },
  { id: 'pttDown', group: 'Microphone and sound', name: 'Push to talk pressed', ts: 'SPECIAL_MIC_CLICK_SELF_ON', keys: ['mic_click_on', 'ptt_on'] },
  { id: 'pttUp', group: 'Microphone and sound', name: 'Push to talk released', ts: 'SPECIAL_MIC_CLICK_SELF_OFF', keys: ['mic_click_off', 'ptt_off'] },
  { id: 'talkingWhileMuted', group: 'Microphone and sound', name: 'You are talking while muted', ts: 'SPECIAL_TALKING_WHILE_MUTED', keys: ['stop_talking', 'talking_while_muted'] },
  { id: 'channelCreated', group: 'Channels', name: 'You created a channel', ts: 'CHANNEL_CREATED_BY_YOU', keys: ['channel_created'] },
  { id: 'channelDeleted', group: 'Channels', name: 'You deleted a channel', ts: 'CHANNEL_DELETED_BY_YOU', keys: ['channel_deleted'] },
  { id: 'channelEdited', group: 'Channels', name: 'You edited a channel', ts: 'CHANNEL_EDITED_CURRENT_BY_YOU', keys: ['channel_edited'] },
  { id: 'channelMoved', group: 'Channels', name: 'You moved a channel', ts: 'CHANNEL_MOVED_BY_YOU', keys: ['channel_moved'] }
] as const;

export type SoundEvent = (typeof SOUND_EVENTS)[number]['id'];

interface SoundSettings {
  enabled: boolean;
  volume: number;
  // Explicit per-event choice; events missing here use their default (on, unless marked off)
  on: Partial<Record<SoundEvent, boolean>>;
  // File names only; the audio itself lives in IndexedDB (key "sound:<event>")
  custom: Partial<Record<SoundEvent, { name: string; data?: string }>>;
}

const MAX_FILE = 1024 * 1024;

// Default tones: [frequency Hz, start s, length s] per event, with a short fade
const TONES: Record<SoundEvent, [number, number, number][]> = {
  connected: [[523, 0, 0.09], [659, 0.09, 0.09], [784, 0.18, 0.16]],
  disconnected: [[784, 0, 0.09], [659, 0.09, 0.09], [523, 0.18, 0.16]],
  connectionLost: [[523, 0, 0.12], [392, 0.13, 0.12], [262, 0.26, 0.2]],
  error: [[311, 0, 0.1], [277, 0.11, 0.14]],
  switchedChannel: [[659, 0, 0.06], [784, 0.07, 0.08]],
  moved: [[587, 0, 0.06], [880, 0.07, 0.06], [587, 0.14, 0.06]],
  kicked: [[220, 0, 0.12], [196, 0.13, 0.2]],
  banned: [[196, 0, 0.14], [165, 0.15, 0.24]],
  denied: [[311, 0, 0.08], [277, 0.09, 0.1]],
  userConnected: [[740, 0, 0.07], [988, 0.08, 0.1]],
  userDisconnected: [[988, 0, 0.07], [740, 0.08, 0.1]],
  userJoined: [[660, 0, 0.07], [880, 0.08, 0.1]],
  userLeft: [[880, 0, 0.07], [660, 0.08, 0.1]],
  userMovedIn: [[587, 0, 0.06], [880, 0.07, 0.08]],
  userMovedOut: [[880, 0, 0.06], [587, 0.07, 0.08]],
  userKicked: [[330, 0, 0.1], [262, 0.11, 0.12]],
  userBanned: [[294, 0, 0.12], [220, 0.13, 0.16]],
  recordingStarted: [[1175, 0, 0.08], [1175, 0.12, 0.08]],
  recordingStopped: [[880, 0, 0.12]],
  message: [[1047, 0, 0.06]],
  privateMessage: [[1047, 0, 0.05], [1319, 0.07, 0.07]],
  messageSent: [[1319, 0, 0.04]],
  uploadDone: [[784, 0, 0.06], [1047, 0.07, 0.08]],
  uploadFailed: [[392, 0, 0.08], [330, 0.09, 0.1]],
  mute: [[392, 0, 0.07]],
  unmute: [[784, 0, 0.07]],
  deafen: [[330, 0, 0.06], [262, 0.07, 0.08]],
  undeafen: [[262, 0, 0.06], [330, 0.07, 0.08]],
  pttDown: [[1200, 0, 0.03]],
  pttUp: [[900, 0, 0.03]],
  talkingWhileMuted: [[440, 0, 0.08], [440, 0.12, 0.08]],
  channelCreated: [[659, 0, 0.06], [988, 0.07, 0.08]],
  channelDeleted: [[988, 0, 0.06], [659, 0.07, 0.08]],
  channelEdited: [[784, 0, 0.08]],
  channelMoved: [[659, 0, 0.06], [784, 0.07, 0.06]]
};

// TeamSpeak 3 sound pack settings.ini: KEY = play("file.wav"); ${clientType} picks a variant
export function parseTsPack(ini: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of ini.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*play\("([^"]+)"\)/.exec(line);
    if (m) out.set(m[1], m[2]);
  }
  return out;
}

// Renders a tone sequence to a WAV blob URL, so defaults and custom files play the same way
async function renderTones(ev: SoundEvent): Promise<string> {
  const notes = TONES[ev];
  const rate = 44100;
  const length = Math.ceil((Math.max(...notes.map(n => n[1] + n[2])) + 0.05) * rate);
  const ctx = new OfflineAudioContext(1, length, rate);
  for (const [freq, start, dur] of notes) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.35, start + 0.008);
    gain.gain.setValueAtTime(0.35, start + dur - 0.02);
    gain.gain.linearRampToValueAtTime(0, start + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + dur);
  }
  const buf = await ctx.startRendering();
  return URL.createObjectURL(toWav(buf.getChannelData(0), rate));
}

function toWav(samples: Float32Array, rate: number): Blob {
  const out = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const str = (o: number, s: string) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); out.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true);
  out.setUint32(24, rate, true); out.setUint32(28, rate * 2, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true);
  str(36, 'data'); out.setUint32(40, samples.length * 2, true);
  samples.forEach((v, i) => out.setInt16(44 + i * 2, Math.max(-1, Math.min(1, v)) * 0x7fff, true));
  return new Blob([out.buffer], { type: 'audio/wav' });
}

class Sounds {
  settings = $state<SoundSettings>(load('mumh5.sounds', { enabled: true, volume: 0.6, on: {}, custom: {} }));
  private defaults = new Map<SoundEvent, Promise<string>>();
  // Object URLs of custom sounds; blob: is what the content security policy allows for media
  private urls = new Map<SoundEvent, string>();
  private ready: Promise<void>;
  errors = $state<string[]>([]);

  constructor() {
    voice.onPtt = down => this.play(down ? 'pttDown' : 'pttUp');
    voice.onTalkingWhileMuted = () => this.play('talkingWhileMuted');
    this.ready = this.loadStored();
  }

  // Loads custom sounds from IndexedDB; moves sounds from older versions out of localStorage
  private async loadStored(): Promise<void> {
    let migrated = false;
    for (const [ev, c] of Object.entries(this.settings.custom) as [SoundEvent, { name: string; data?: string }][]) {
      try {
        if (c.data) {
          // Decode directly: the content security policy does not allow fetching data: URLs
          const [meta, b64] = c.data.split(',');
          const bytes = Uint8Array.from(atob(b64), ch => ch.charCodeAt(0));
          const blob = new Blob([bytes], { type: /^data:([^;]+)/.exec(meta)?.[1] ?? 'audio/wav' });
          await putBlob(`sound:${ev}`, blob);
          delete c.data;
          migrated = true;
        }
        const blob = await getBlob(`sound:${ev}`);
        if (blob) this.urls.set(ev, URL.createObjectURL(blob));
        else delete this.settings.custom[ev];
      } catch { /* storage unavailable */ }
    }
    if (migrated) this.persist();
  }
  private lastPlayed = new Map<SoundEvent, number>();

  private persist(): void {
    save('mumh5.sounds', $state.snapshot(this.settings));
  }

  update(patch: Partial<Pick<SoundSettings, 'enabled' | 'volume'>>): void {
    Object.assign(this.settings, patch);
    this.persist();
  }

  isOn(ev: SoundEvent): boolean {
    const chosen = this.settings.on?.[ev];
    if (chosen != null) return chosen;
    return !(SOUND_EVENTS.find(e => e.id === ev) as { off?: boolean } | undefined)?.off;
  }

  setOn(ev: SoundEvent, on: boolean): void {
    (this.settings.on ??= {})[ev] = on;
    this.persist();
  }

  async setCustom(ev: SoundEvent, file: File): Promise<string | null> {
    if (file.size > MAX_FILE) return `${file.name} is larger than 1 MB`;
    if (!/^audio\//.test(file.type) && !/\.(wav|mp3|ogg|oga|opus|flac|m4a|aac|webm)$/i.test(file.name)) return `${file.name} is not an audio file`;
    try {
      await putBlob(`sound:${ev}`, file);
    } catch (e) {
      return `Could not store ${file.name}: ${(e as Error).message}`;
    }
    const old = this.urls.get(ev);
    if (old) URL.revokeObjectURL(old);
    this.urls.set(ev, URL.createObjectURL(file));
    this.settings.custom[ev] = { name: file.name };
    this.persist();
    return null;
  }

  reset(ev: SoundEvent): void {
    delete this.settings.custom[ev];
    const url = this.urls.get(ev);
    if (url) URL.revokeObjectURL(url);
    this.urls.delete(ev);
    deleteBlob(`sound:${ev}`).catch(() => {});
    this.persist();
  }

  // A TeamSpeak 3 sound pack (folder with settings.ini) maps exactly; otherwise files are
  // matched to events by name ("user_joined.wav" -> Someone joined your channel).
  async loadPack(files: File[]): Promise<{ assigned: string[]; unmatched: string[] }> {
    const assigned: string[] = [], unmatched: string[] = [];
    const audio = files.filter(f => /\.(wav|mp3|ogg|oga|opus|flac|m4a|aac|webm)$/i.test(f.name));
    const byName = new Map(audio.map(f => [f.name.toLowerCase(), f]));
    const used = new Set<File>();
    const ini = files.find(f => /settings\.ini$/i.test(f.name));

    if (ini) {
      const entries = parseTsPack(await ini.text());
      for (const e of SOUND_EVENTS) {
        const wanted = entries.get(e.ts);
        if (!wanted) continue;
        // ${clientType} variants: prefer "neutral", else whichever the pack has
        const suffix = wanted.replace(/^.*\$\{clientType\}_?/, '').toLowerCase();
        const file = wanted.includes('${clientType}')
          ? byName.get(`neutral_${suffix}`) ?? audio.find(f => f.name.toLowerCase().endsWith(`_${suffix}`))
          : byName.get(wanted.toLowerCase());
        if (file && !(await this.setCustom(e.id, file))) {
          assigned.push(`${file.name}: ${e.name}`);
          used.add(file);
        }
      }
      for (const f of audio) if (!used.has(f) && !assigned.some(a => a.startsWith(f.name + ':'))) unmatched.push(f.name);
      return { assigned, unmatched: [...new Set(unmatched)] };
    }

    for (const f of audio) {
      const base = f.name.toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[\s-]+/g, '_');
      // Most specific match wins: exact key, then longest key contained in the name
      let best: { ev: SoundEvent; score: number } | null = null;
      for (const e of SOUND_EVENTS) {
        for (const k of e.keys) {
          const score = base === k ? 1000 : base.includes(k) ? k.length : 0;
          if (score && (!best || score > best.score)) best = { ev: e.id, score };
        }
      }
      if (best && !(await this.setCustom(best.ev, f))) assigned.push(`${f.name}: ${SOUND_EVENTS.find(e => e.id === best!.ev)!.name}`);
      else unmatched.push(f.name);
    }
    return { assigned, unmatched };
  }

  resetAll(): void {
    for (const ev of Object.keys(this.settings.custom) as SoundEvent[]) this.reset(ev);
  }

  private async source(ev: SoundEvent): Promise<string> {
    await this.ready;
    const custom = this.urls.get(ev);
    if (custom) return custom;
    let p = this.defaults.get(ev);
    if (!p) this.defaults.set(ev, (p = renderTones(ev)));
    return p;
  }

  // Plays an event sound through the voice output device; force plays even when disabled (preview)
  async play(ev: SoundEvent, force = false): Promise<void> {
    if (!force && (!this.settings.enabled || !this.isOn(ev))) return;
    // Bursts of the same event (e.g. many people joining) play once
    const now = performance.now();
    if (!force && now - (this.lastPlayed.get(ev) ?? 0) < 150) return;
    this.lastPlayed.set(ev, now);
    try {
      const el = new Audio(await this.source(ev)) as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
      el.volume = Math.max(0, Math.min(1, this.settings.volume));
      const sink = voice.settings.outputDevice;
      if (sink && sink !== 'default' && el.setSinkId) await el.setSinkId(sink).catch(() => {});
      await el.play();
      // Inspection hook for the end-to-end tests: events that really started playing
      const log = ((window as any).__mumh5Sounds ??= []) as string[];
      log.push(ev);
      if (log.length > 50) log.shift();
    } catch (e) {
      // Shown in the Sounds settings, so a broken file does not fail silently
      const msg = `${SOUND_EVENTS.find(x => x.id === ev)?.name}: ${(e as Error).message}`;
      if (!this.errors.includes(msg)) this.errors = [...this.errors.slice(-4), msg];
    }
  }
}

export const sounds = new Sounds();
