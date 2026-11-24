import { unzipSync, type UnzipFileInfo } from 'fflate';
import { DEFAULT_AUDIO_PACK_LIMITS, audioSize, type AudioPackLimits } from './audio-pack-limits.ts';

export const MAX_AUDIO_FILE = DEFAULT_AUDIO_PACK_LIMITS.file;
export const MAX_AUDIO_PACK = DEFAULT_AUDIO_PACK_LIMITS.pack;
const ROOTS = new Set([
  'AudioNotification', 'ChannelNotification', 'ConnectionRejectedNotification',
  'ContextNotification', 'InputNotification', 'MessageNotification', 'ModerationNotification',
  'PermissionNotification', 'PluginNotification', 'PriorityNotification', 'RecordingNotification',
  'ServerNotification', 'SystemNotification', 'TalkingNotification', 'UserNotification'
]);

export function isPackClip(name: string): boolean {
  const parts = name.split('/');
  return ROOTS.has(parts[0]) && parts.length >= 2 && parts.length <= 3 &&
    parts.every(p => /^[A-Za-z0-9_-]+(?:\.wav)?$/.test(p)) && name.endsWith('.wav');
}

// Inspect central-directory sizes before inflating anything. Metadata stays in the
// archive; only WAV files in the documented hierarchy can become playable clips.
function packFilter(keep: (name: string) => boolean, limits: AudioPackLimits): (entry: UnzipFileInfo) => boolean {
  let total = 0, count = 0;
  const seen = new Set<string>();
  return entry => {
    if (++count > 512) throw new Error('Sound pack contains too many entries (maximum 512).');
    const name = entry.name;
    if (name.startsWith('/') || name.includes('\\') || name.includes('\0') || name.split('/').some(p => p === '..' || p === '.')) {
      throw new Error('Sound pack contains an unsafe path.');
    }
    if (seen.has(name)) throw new Error(`Duplicate sound pack entry: ${name}`);
    seen.add(name);
    if (!isPackClip(name)) return false;
    if (entry.originalSize > limits.file) throw new Error(`${name} is larger than ${audioSize(limits.file)}.`);
    total += entry.originalSize;
    if (total > limits.unpacked) throw new Error(`Sound pack expands beyond ${audioSize(limits.unpacked)}.`);
    return keep(name);
  };
}

function checkWav(name: string, data: Uint8Array<ArrayBuffer>, limits: AudioPackLimits): Uint8Array<ArrayBuffer> {
  if (data.length > limits.file || data.length < 44 ||
      String.fromCharCode(...data.subarray(0, 4)) !== 'RIFF' ||
      String.fromCharCode(...data.subarray(8, 12)) !== 'WAVE') {
    throw new Error(`${name} is not a supported WAV file.`);
  }
  return data;
}

const NO_CLIPS = 'No WAV clips found. Put notification folders such as AudioNotification/ at the ZIP root.';

export function readAudioPack(bytes: Uint8Array, limits: AudioPackLimits = DEFAULT_AUDIO_PACK_LIMITS): Map<string, Uint8Array<ArrayBuffer>> {
  if (bytes.length > limits.pack) throw new Error(`Sound packs must be at most ${audioSize(limits.pack)}.`);
  const files = unzipSync(bytes, { filter: packFilter(() => true, limits) });
  const clips = new Map<string, Uint8Array<ArrayBuffer>>();
  for (const [name, data] of Object.entries(files)) clips.set(name, checkWav(name, data as Uint8Array<ArrayBuffer>, limits));
  if (!clips.size) throw new Error(NO_CLIPS);
  return clips;
}

// The clip names of a saved pack, without inflating any audio.
export function listAudioPack(bytes: Uint8Array, limits: AudioPackLimits = DEFAULT_AUDIO_PACK_LIMITS): string[] {
  if (bytes.length > limits.pack) throw new Error(`Sound packs must be at most ${audioSize(limits.pack)}.`);
  const names: string[] = [];
  unzipSync(bytes, { filter: packFilter(name => { names.push(name); return false; }, limits) });
  if (!names.length) throw new Error(NO_CLIPS);
  return names;
}

// Inflates one clip, so playing a sound does not unpack the whole archive.
export function readPackClip(bytes: Uint8Array, clip: string, limits: AudioPackLimits = DEFAULT_AUDIO_PACK_LIMITS): Uint8Array<ArrayBuffer> {
  if (bytes.length > limits.pack) throw new Error(`Sound packs must be at most ${audioSize(limits.pack)}.`);
  const data = unzipSync(bytes, { filter: packFilter(name => name === clip, limits) })[clip];
  if (!data) throw new Error(`${clip} is not in this sound pack.`);
  return checkWav(clip, data as Uint8Array<ArrayBuffer>, limits);
}
