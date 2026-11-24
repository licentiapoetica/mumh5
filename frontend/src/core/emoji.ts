// The emoji palette: data comes from unicode-emoji-json, loaded only when the picker opens

export interface Emoji {
  emoji: string;
  name: string;
  tones: boolean;
}

export interface EmojiGroup {
  name: string;
  slug: string;
  emojis: Emoji[];
}

export interface RawEmojiGroup {
  name: string;
  slug: string;
  emojis: { emoji: string; name: string; skin_tone_support: boolean }[];
}

export const SKIN_TONES = [
  { name: 'Default', modifier: '' },
  { name: 'Light', modifier: '\u{1F3FB}' },
  { name: 'Medium-light', modifier: '\u{1F3FC}' },
  { name: 'Medium', modifier: '\u{1F3FD}' },
  { name: 'Medium-dark', modifier: '\u{1F3FE}' },
  { name: 'Dark', modifier: '\u{1F3FF}' }
];

export function toGroups(raw: RawEmojiGroup[]): EmojiGroup[] {
  return raw.map(g => ({
    name: g.name,
    slug: g.slug,
    emojis: g.emojis.map(e => ({ emoji: e.emoji, name: e.name, tones: e.skin_tone_support }))
  }));
}

// The modifier follows each person. The handshake joining two people takes none of its own
export function withTone(emoji: string, modifier: string): string {
  if (!modifier) return emoji;
  return emoji.replace(/(?!\u{1F91D}\u200D)(\p{Emoji_Modifier_Base})\uFE0F?/gu, `$1${modifier}`);
}

// Every word of the query must appear in the name
export function searchEmoji(groups: EmojiGroup[], query: string): Emoji[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return groups.flatMap(g => g.emojis.filter(e => {
    const name = e.name.toLowerCase();
    return words.every(w => name.includes(w));
  }));
}
