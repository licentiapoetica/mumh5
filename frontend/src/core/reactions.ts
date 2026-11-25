// Reactions to chat messages (mumh5 clients only). Mumble messages carry no id, so a reaction
// names its message by a digest of the HTML as sent, its author's session and how long ago it was
// sent; every receiver got the same HTML at about the same time. Text channel messages have ids
// of their own. Reactions travel as plugin data to the people who got the message.

export const REACT_DATA_ID = 'mumh5.react';
// Different emoji on one message; more are ignored
export const MAX_KINDS = 20;

export interface ReactSignal {
  c: number | null; // channel, null for a direct message
  r: string; // the message (see messageRef)
  s: number | null; // its author's session
  a: number; // its age in seconds when the reaction was sent
  e: string;
  on: boolean;
}

// A person who reacted: certificate digest, or name for clients without one
export interface Reactor { k: string; name: string }
export interface Reaction { emoji: string; who: Reactor[] }

export const reactorKey = (u: { hash?: string; name: string }) => u.hash || `n:${u.name}`;

// FNV-1a twice with different seeds: 64 bits, plenty for telling messages apart
export function messageRef(html: string): string {
  let a = 0x811c9dc5, b = 0x01000193 ^ html.length;
  for (let i = 0; i < html.length; i++) {
    const c = html.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x01000193) ^ (b >>> 13);
  }
  return 'h:' + (a >>> 0).toString(36) + (b >>> 0).toString(36);
}
export const textRef = (id: string) => `t:${id}`;

// RGI emoji only (the v flag); browsers without it get a looser check
const RGI = (() => { try { return new RegExp('^\\p{RGI_Emoji}$', 'v'); } catch { return null; } })();
const LOOSE = /^[\p{Extended_Pictographic}\p{Emoji_Component}‍️⃣]+$/u;
export function isEmoji(s: string): boolean {
  if (!s || s.length > 32) return false;
  return RGI ? RGI.test(s) : LOOSE.test(s) && /[^\x00-\x7f]/.test(s);
}

export function encodeReact(sig: ReactSignal): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(sig));
}

export function decodeReact(data: Uint8Array): ReactSignal | null {
  if (data.length > 600) return null;
  let v: Record<string, unknown>;
  try { v = JSON.parse(new TextDecoder().decode(data)); } catch { return null; }
  if (!v || typeof v !== 'object') return null;
  const id = (x: unknown) => x === null || (Number.isInteger(x) && (x as number) >= 0);
  if (!id(v.c) || !id(v.s) || typeof v.r !== 'string' || !/^[ht]:[\w-]{1,40}$/.test(v.r)) return null;
  if (typeof v.a !== 'number' || !(v.a >= 0) || typeof v.on !== 'boolean' || typeof v.e !== 'string' || !isEmoji(v.e)) return null;
  return { c: v.c as number | null, r: v.r, s: v.s as number | null, a: v.a, e: v.e, on: v.on };
}

export interface Reactable { kind: string; ref?: string; authorSession: number | null; time: number }

// Text channel ids survive reconnects; their authors' session numbers do not.
// Other messages match by digest and author, closest to the given age.
// Ages instead of times, so clocks that disagree do not matter.
export function findReacted<T extends Reactable>(entries: readonly T[], sig: Pick<ReactSignal, 'r' | 's' | 'a'>, now: number): T | undefined {
  const at = now - sig.a * 1000;
  let best: T | undefined;
  let gap = Infinity;
  for (const e of entries) {
    if (e.kind !== 'text' || e.ref !== sig.r) continue;
    if (sig.r.startsWith('t:')) return e;
    if (sig.s != null && e.authorSession != null && e.authorSession !== sig.s) continue;
    const g = Math.abs(e.time - at);
    if (g < gap) { best = e; gap = g; }
  }
  return best;
}

// The reactions after someone adds or removes one; null when nothing changes
export function applyReaction(list: readonly Reaction[], emoji: string, who: Reactor, on: boolean): Reaction[] | null {
  const i = list.findIndex(r => r.emoji === emoji);
  const has = i >= 0 && list[i].who.some(w => w.k === who.k);
  if (has === on) return null;
  if (on) {
    if (i >= 0) return list.map((r, j) => (j === i ? { emoji, who: [...r.who, who] } : r));
    return list.length >= MAX_KINDS ? null : [...list, { emoji, who: [who] }];
  }
  const rest = list[i].who.filter(w => w.k !== who.k);
  return rest.length ? list.map((r, j) => (j === i ? { emoji, who: rest } : r)) : list.filter((_, j) => j !== i);
}

// Reactions read back from storage; anything malformed is left out
export function readReactions(v: unknown): Reaction[] {
  if (!Array.isArray(v)) return [];
  const out: Reaction[] = [];
  for (const r of v.slice(0, MAX_KINDS)) {
    if (!r || typeof r.emoji !== 'string' || !isEmoji(r.emoji) || !Array.isArray(r.who) || out.some(o => o.emoji === r.emoji)) continue;
    const who: Reactor[] = [];
    for (const w of r.who.slice(0, 500)) {
      if (w && typeof w.k === 'string' && w.k.length <= 200 && typeof w.name === 'string' && w.name.length <= 200 && !who.some(o => o.k === w.k)) who.push({ k: w.k, name: w.name });
    }
    if (who.length) out.push({ emoji: r.emoji, who });
  }
  return out;
}

// A plain copy, for storage (state proxies cannot be cloned into IndexedDB)
export const copyReactions = (list: readonly Reaction[]): Reaction[] => list.map(r => ({ emoji: r.emoji, who: r.who.map(w => ({ k: w.k, name: w.name })) }));

// "alice, bob and 3 others"
export function reactorNames(names: string[], max = 3): string {
  if (names.length <= max) return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0] ?? '';
  const more = names.length - max;
  return `${names.slice(0, max).join(', ')} and ${more} other${more === 1 ? '' : 's'}`;
}
