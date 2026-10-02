// Text channels between mumh5 clients. Mumble only delivers a channel message to the people
// sitting in that channel, so a channel you read while you are in voice elsewhere cannot be
// a plain Mumble chat. A text channel is a normal Mumble channel with a marker in its
// description; its messages travel as plugin data to everyone on the server, which other
// clients ignore. The server stores nothing: clients keep the messages and hand the recent
// ones to whoever connects later.
import { encodeSignal, SignalAssembler } from './share-signal.ts';

export const TEXT_DATA_ID = 'mumh5.text';

export const TEXT = {
  hello: 1,    // I just connected: who else runs mumh5?
  here: 2,     // answer to hello
  msg: 3,      // a message: { i, c, h }
  want: 4,     // send me the recent messages
  history: 5   // answer to want, one per channel: { c, m: [...] }
} as const;
export type TextType = typeof TEXT[keyof typeof TEXT];

// An HTML comment: invisible in every client, and Murmur keeps it
export const TEXT_MARK = '<!--mumh5:text-->';
export const isTextChannel = (description: string) => description.includes(TEXT_MARK);
export const stripMark = (description: string) => description.split(TEXT_MARK).join('');
export const markText = (description: string, on: boolean) => (on ? TEXT_MARK : '') + stripMark(description);

// Kept per channel, and handed to a newcomer
export const KEEP = 200;
export const HAND_OVER = 50;
// Compressed, this stays well inside the 32 packets a signal may take
export const MAX_HTML = 24000;

// i: id, c: channel, t: time, n: author name, k: author certificate hash, h: html
export interface TextMsg { i: string; c: number; t: number; n: string; k: string; h: string }

export const encodeText = (type: TextType, body?: unknown) => encodeSignal(type, body === undefined ? undefined : JSON.stringify(body));

export class TextAssembler extends SignalAssembler<TextType> {
  constructor() {
    super(Object.values(TEXT));
  }
}

export function newId(): string {
  return Date.now().toString(36) + Array.from(crypto.getRandomValues(new Uint8Array(6)), b => b.toString(36)).join('');
}

function parse(text: string | undefined): Record<string, unknown> | null {
  try {
    const v = JSON.parse(text ?? '');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

const okId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 40;
const okChannel = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;
const okHtml = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= MAX_HTML;

// A live message; who sent it and when is filled in by the receiver
export function parseMsg(text: string | undefined): { i: string; c: number; h: string } | null {
  const v = parse(text);
  return v && okId(v.i) && okChannel(v.c) && okHtml(v.h) ? { i: v.i, c: v.c, h: v.h } : null;
}

// Messages another client kept. Times from the future are pulled back to now.
export function parseHistory(text: string | undefined, now = Date.now()): TextMsg[] {
  const v = parse(text);
  if (!v || !okChannel(v.c) || !Array.isArray(v.m)) return [];
  const c = v.c;
  const out: TextMsg[] = [];
  for (const m of v.m.slice(-HAND_OVER) as Record<string, unknown>[]) {
    if (!m || !okId(m.i) || !okHtml(m.h) || typeof m.t !== 'number' || !Number.isFinite(m.t)) continue;
    if (typeof m.n !== 'string' || m.n.length > 200 || typeof m.k !== 'string' || m.k.length > 200) continue;
    out.push({ i: m.i, c, t: Math.min(m.t, now), n: m.n, k: m.k, h: m.h });
  }
  return out;
}

// Adds what is not there yet, in order of time. Returns the new list and what was added.
export function mergeMsgs(have: TextMsg[], incoming: TextMsg[], keep = KEEP): { all: TextMsg[]; added: TextMsg[] } {
  const ids = new Set(have.map(m => m.i));
  const added: TextMsg[] = [];
  for (const m of incoming) {
    if (ids.has(m.i)) continue;
    ids.add(m.i);
    added.push(m);
  }
  if (!added.length) return { all: have, added };
  const all = [...have, ...added].sort((a, b) => a.t - b.t).slice(-keep);
  return { all, added: added.filter(m => all.includes(m)) };
}

// The newest messages of a channel that still fit one signal
export async function encodeHistory(c: number, msgs: TextMsg[]): Promise<Uint8Array[]> {
  for (let n = Math.min(HAND_OVER, msgs.length); n > 0; n = Math.floor(n / 2)) {
    try {
      return await encodeText(TEXT.history, { c, m: msgs.slice(-n).map(({ i, t, n: name, k, h }) => ({ i, t, n: name, k, h })) });
    } catch { /* too large: hand over fewer */ }
  }
  return [];
}
