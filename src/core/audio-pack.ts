import { unzipSync } from 'fflate';

export const MAX_AUDIO_FILE = 4 * 1024 * 1024;
export const MAX_AUDIO_PACK = 32 * 1024 * 1024;
const MAX_UNPACKED = 64 * 1024 * 1024;
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
export function readAudioPack(bytes: Uint8Array): Map<string, Uint8Array<ArrayBuffer>> {
  if (bytes.length > MAX_AUDIO_PACK) throw new Error('Sound packs must be at most 32 MB.');
  let total = 0, count = 0;
  const seen = new Set<string>();
  const files = unzipSync(bytes, { filter: entry => {
    if (++count > 512) throw new Error('Sound pack contains too many entries (maximum 512).');
    const name = entry.name;
    if (name.startsWith('/') || name.includes('\\') || name.includes('\0') || name.split('/').some(p => p === '..' || p === '.')) {
      throw new Error('Sound pack contains an unsafe path.');
    }
    if (seen.has(name)) throw new Error(`Duplicate sound pack entry: ${name}`);
    seen.add(name);
    if (!isPackClip(name)) return false;
    if (entry.originalSize > MAX_AUDIO_FILE) throw new Error(`${name} is larger than 4 MB.`);
    total += entry.originalSize;
    if (total > MAX_UNPACKED) throw new Error('Sound pack expands beyond 64 MB.');
    return true;
  } });
  const clips = new Map<string, Uint8Array<ArrayBuffer>>();
  for (const [name, data] of Object.entries(files)) {
    if (data.length > MAX_AUDIO_FILE || data.length < 44 ||
        String.fromCharCode(...data.subarray(0, 4)) !== 'RIFF' ||
        String.fromCharCode(...data.subarray(8, 12)) !== 'WAVE') {
      throw new Error(`${name} is not a supported WAV file.`);
    }
    clips.set(name, data);
  }
  if (!clips.size) throw new Error('No WAV clips found. Put notification folders such as AudioNotification/ at the ZIP root.');
  return clips;
}
