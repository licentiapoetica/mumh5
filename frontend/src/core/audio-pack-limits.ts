export interface AudioPackLimits {
  file: number;
  pack: number;
  unpacked: number;
}

export const MIB = 1024 * 1024;
export const DEFAULT_AUDIO_PACK_LIMITS: Readonly<AudioPackLimits> = Object.freeze({
  file: 4 * MIB, pack: 32 * MIB, unpacked: 64 * MIB
});

// Also used for the proxy's JSON response. Missing fields keep older proxies working.
export function parseAudioPackLimits(value: unknown): AudioPackLimits {
  const input = value as Partial<AudioPackLimits> | null | undefined;
  const limits = { ...DEFAULT_AUDIO_PACK_LIMITS };
  for (const key of ['file', 'pack', 'unpacked'] as const) {
    const bytes = input?.[key];
    if (bytes === undefined) continue;
    if (typeof bytes !== 'number' || !Number.isSafeInteger(bytes) || bytes <= 0) throw new Error(`Invalid sound pack ${key} limit.`);
    limits[key] = bytes;
  }
  return limits;
}

export const audioSize = (bytes: number): string => `${bytes / MIB} MiB`;
