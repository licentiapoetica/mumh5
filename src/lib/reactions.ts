// Reactions to chat messages: sending, pacing and applying what others send (see core/reactions.ts)
import { REACT_DATA_ID, applyReaction, decodeReact, encodeReact, findReacted, reactorKey, type ReactSignal } from '../core/reactions.ts';
import type { Session } from './session.svelte.ts';
import { store } from './settings.svelte.ts';

// Murmur allows a burst of 15 plugin messages per user and 4 a second, shared with screen
// sharing, text channels and files; reactions take a small part of that
const BURST = 4;
const PER_SECOND = 1.5;

interface Queued { id: string; to: number[]; packet: Uint8Array }
interface State { queue: Queued[]; level: number; levelAt: number; timer: ReturnType<typeof setTimeout> | undefined }

class Reactions {
  private states = new WeakMap<Session, State>();

  // Plugin data needs a 1.4 server
  supported(s: Session): boolean {
    return s.status === 'connected' && !!s.client && s.client.serverVersionNum >= 0x010400;
  }

  // Adds or removes your reaction; on left out toggles it
  toggle(s: Session, key: string, entryId: number, emoji: string, on?: boolean): void {
    const client = s.client;
    const self = client?.self;
    const entry = s.logs[key]?.find(e => e.id === entryId);
    if (!client || !self || !entry?.ref || entry.kind !== 'text' || !this.supported(s)) return;
    const me = { k: reactorKey(self), name: self.name };
    const has = entry.reactions.find(r => r.emoji === emoji)?.who.some(w => w.k === me.k) ?? false;
    const want = on ?? !has;
    const next = applyReaction(entry.reactions, emoji, me, want);
    if (!next) return;
    entry.reactions = next;

    const [kind, id] = key.split(':');
    const target = Number(id);
    const to = kind === 'dm' ? [target]
      : [...client.users.values()].filter(u => u.session !== client.session && (s.isText(target) || u.channelId === target)).map(u => u.session);
    const sig: ReactSignal = {
      c: kind === 'dm' ? null : target, r: entry.ref, s: entry.authorSession,
      a: Math.max(0, Math.round((Date.now() - entry.time) / 1000)), e: emoji, on: want
    };
    this.queue(s, `${key}|${entry.ref}|${emoji}`, to, encodeReact(sig));
  }

  receive(s: Session, sender: number, dataId: string, data: Uint8Array): void {
    if (dataId !== REACT_DATA_ID) return;
    const user = s.client?.users.get(sender);
    const sig = decodeReact(data);
    if (!user || !sig) return;
    const entry = findReacted(s.logs[sig.c == null ? `dm:${sender}` : `ch:${sig.c}`] ?? [], sig, Date.now());
    if (!entry) return;
    const next = applyReaction(entry.reactions, sig.e, { k: reactorKey(user), name: store.displayName(user) }, sig.on);
    if (next) entry.reactions = next;
  }

  closed(s: Session): void {
    const st = this.states.get(s);
    if (st) clearTimeout(st.timer);
    this.states.delete(s);
  }

  // A reaction switched on and off again before it went out is sent once, as it ends up
  private queue(s: Session, id: string, to: number[], packet: Uint8Array): void {
    if (!to.length) return;
    let st = this.states.get(s);
    if (!st) this.states.set(s, st = { queue: [], level: 0, levelAt: Date.now(), timer: undefined });
    const waiting = st.queue.find(q => q.id === id);
    if (waiting) Object.assign(waiting, { to, packet });
    else st.queue.push({ id, to, packet });
    this.flush(s, st);
  }

  private flush(s: Session, st: State): void {
    if (st.timer) return;
    const client = s.client;
    while (st.queue.length && client && this.states.get(s) === st) {
      const now = Date.now();
      st.level = Math.max(0, st.level - (now - st.levelAt) / 1000 * PER_SECOND);
      st.levelAt = now;
      if (st.level > BURST - 1) {
        st.timer = setTimeout(() => { st.timer = undefined; this.flush(s, st); }, 1000 / PER_SECOND);
        return;
      }
      st.level++;
      const { to, packet } = st.queue.shift()!;
      const there = to.filter(id => client.users.has(id));
      if (there.length) client.sendPluginData(there, REACT_DATA_ID, packet);
    }
  }
}

export const reactions = new Reactions();
