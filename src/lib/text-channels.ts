// Text channels: channels you read and write without sitting in them (see core/text-signal.ts).
// Messages go to everyone on the server as plugin data; the server has checked the sender's
// certificate, so a live message is known to come from that user. Messages handed over by
// another client after connecting are that client's word for what was said.
import { TEXT, TEXT_DATA_ID, KEEP, MAX_HTML, TextAssembler, encodeText, encodeHistory, parseMsg, parseHistory, mergeMsgs, newId, isTextChannel, type TextMsg, type TextType } from '../core/text-signal.ts';
import type { Session } from './session.svelte.ts';
import { getData, putData } from './blobstore.ts';
import { sounds } from './audio/sounds.svelte.ts';

// Murmur allows a burst of 15 plugin messages per user and 4 a second after that, and drops
// the rest silently. Screen sharing signals count against the same limit, so stay well under it.
const BURST = 6;
const PER_SECOND = 2.5;
// How long a client may take to hand over its messages before the next one is asked
const ANSWER_MS = 6000;
const MAX_ASKED = 3;

interface State {
  assembler: TextAssembler;
  msgs: Map<number, TextMsg[]>;
  // Channels whose kept messages are in the chat log already
  shown: Set<number>;
  // What this computer kept has been read; nothing is shown before, or it would come out of order
  loaded: boolean;
  queue: { to: number[]; packet: Uint8Array }[];
  level: number;
  levelAt: number;
  timer: ReturnType<typeof setTimeout> | undefined;
  // Catching up: who answered our hello, who we asked, and whether that is settled
  peers: number[];
  asked: number[];
  caughtUp: boolean;
  askTimer: ReturnType<typeof setTimeout> | undefined;
  saveTimer: ReturnType<typeof setTimeout> | undefined;
  storeKey: string;
}

class TextChannels {
  private states = new WeakMap<Session, State>();

  // Plugin data needs a 1.4 server; older ones would not pass the messages on
  supported(s: Session): boolean {
    return !!s.client && s.client.serverVersionNum >= 0x010400;
  }

  isText(s: Session, channelId: number): boolean {
    return this.supported(s) && isTextChannel(s.client!.channels.get(channelId)?.description ?? '');
  }

  // After connecting: bring back what this computer kept, then ask the others for what we missed
  async entered(s: Session): Promise<void> {
    const client = s.client;
    if (!client || !this.supported(s) || !s.server) return;
    const st: State = {
      assembler: new TextAssembler(), msgs: new Map(), shown: new Set(), loaded: false, queue: [], level: 0, levelAt: Date.now(), timer: undefined,
      peers: [], asked: [], caughtUp: false, askTimer: undefined, saveTimer: undefined,
      storeKey: `text:${s.server.host.toLowerCase()}:${s.server.port}`
    };
    this.states.set(s, st);
    // The marker is in the description, and long descriptions are only announced by hash
    for (const c of client.channels.values()) s.loadDescription(c.id);
    try {
      const kept = await getData<Record<number, TextMsg[]>>(st.storeKey);
      if (s.client !== client) return;
      for (const [id, list] of Object.entries(kept ?? {})) {
        if (Array.isArray(list)) st.msgs.set(Number(id), mergeMsgs(st.msgs.get(Number(id)) ?? [], list).all);
      }
    } catch { /* no storage: start empty */ }
    if (s.client !== client) return;
    st.loaded = true;
    this.reveal(s);
    this.send(s, this.everyone(s), TEXT.hello);
  }

  closed(s: Session): void {
    const st = this.states.get(s);
    if (!st) return;
    clearTimeout(st.timer);
    clearTimeout(st.askTimer);
    if (st.saveTimer) { clearTimeout(st.saveTimer); this.save(st); }
    this.states.delete(s);
  }

  // A channel appeared or its description changed
  channelChanged(s: Session, channelId: number): void {
    if (!this.states.has(s)) return;
    s.loadDescription(channelId);
    this.reveal(s);
  }

  // Murmur gives the id of a removed channel to a later one
  channelRemoved(s: Session, channelId: number): void {
    const st = this.states.get(s);
    if (!st) return;
    st.shown.delete(channelId);
    st.msgs.delete(channelId);
    this.forget(st, channelId);
  }

  userLeft(s: Session, session: number): void {
    const st = this.states.get(s);
    if (!st) return;
    st.peers = st.peers.filter(p => p !== session);
    // The one we were waiting for is gone: ask the next
    if (!st.caughtUp && st.asked[st.asked.length - 1] === session) this.askNext(s, st);
  }

  // Sends a message to a text channel. The caller shows it in the log.
  async post(s: Session, channelId: number, html: string): Promise<string | null> {
    const st = this.states.get(s);
    const self = s.client?.self;
    if (!st || !self) return 'Not connected.';
    if (html.length > MAX_HTML) return `Message too long for a text channel (${html.length} / ${MAX_HTML} characters)`;
    const m: TextMsg = { i: newId(), c: channelId, t: Date.now(), n: self.name, k: self.hash, h: html };
    let packets: Uint8Array[];
    try {
      packets = await encodeText(TEXT.msg, { i: m.i, c: m.c, h: m.h });
    } catch {
      return 'Message too long for a text channel.';
    }
    const to = this.everyone(s);
    for (const packet of packets) st.queue.push({ to, packet });
    this.flush(s, st);
    this.keep(st, [m]);
    st.shown.add(channelId);
    s.addText(m, true, false);
    return null;
  }

  async receive(s: Session, sender: number, dataId: string, data: Uint8Array): Promise<void> {
    const st = this.states.get(s);
    if (dataId !== TEXT_DATA_ID || !st) return;
    const signal = await st.assembler.push(sender, data);
    const client = s.client;
    if (!signal || !client || this.states.get(s) !== st) return;
    switch (signal.type) {
      case TEXT.hello:
        this.send(s, [sender], TEXT.here);
        break;
      case TEXT.here:
        if (!st.peers.includes(sender)) st.peers.push(sender);
        if (!st.caughtUp && !st.asked.length) this.askNext(s, st);
        break;
      case TEXT.msg: {
        const m = parseMsg(signal.text);
        const from = client.users.get(sender);
        const ch = m && client.channels.get(m.c);
        // Only into text channels, or channels whose description has not arrived yet
        if (!m || !from || !ch || !(isTextChannel(ch.description) || (ch.descriptionHash && !ch.description))) return;
        const msg: TextMsg = { ...m, t: Date.now(), n: from.name, k: from.hash };
        if (!this.keep(st, [msg]).length) return;
        if (st.shown.has(m.c)) {
          s.addText(msg, false, false, sender);
          sounds.play('message');
        }
        break;
      }
      case TEXT.want: {
        for (const [c, list] of st.msgs) {
          if (!this.isText(s, c) || !list.length) continue;
          for (const packet of await encodeHistory(c, list)) st.queue.push({ to: [sender], packet });
        }
        // Also when there is nothing, so the asker stops waiting
        for (const packet of await encodeText(TEXT.history, { c: 0, m: [] })) st.queue.push({ to: [sender], packet });
        this.flush(s, st);
        break;
      }
      case TEXT.history: {
        // Only from the client we asked
        if (st.asked[st.asked.length - 1] !== sender) return;
        st.caughtUp = true;
        clearTimeout(st.askTimer);
        const list = parseHistory(signal.text);
        if (!list.length || !client.channels.has(list[0].c)) return;
        const added = this.keep(st, list);
        if (st.shown.has(list[0].c)) for (const m of added) s.addText(m, this.mine(s, m), true);
        break;
      }
    }
  }

  private mine(s: Session, m: TextMsg): boolean {
    const self = s.client?.self;
    return !!self && (m.k ? m.k === self.hash : m.n === self.name);
  }

  private everyone(s: Session): number[] {
    const client = s.client;
    return client ? [...client.users.keys()].filter(id => id !== client.session) : [];
  }

  private askNext(s: Session, st: State): void {
    clearTimeout(st.askTimer);
    const next = st.peers.find(p => !st.asked.includes(p));
    if (next == null || st.asked.length >= MAX_ASKED) return;
    st.asked.push(next);
    this.send(s, [next], TEXT.want);
    st.askTimer = setTimeout(() => { if (!st.caughtUp && this.states.get(s) === st) this.askNext(s, st); }, ANSWER_MS);
  }

  // Puts the kept messages of text channels into their chat logs, once per channel
  private reveal(s: Session): void {
    const st = this.states.get(s);
    if (!st?.loaded) return;
    for (const [c, list] of st.msgs) {
      if (st.shown.has(c) || !this.isText(s, c)) continue;
      st.shown.add(c);
      for (const m of list) s.addText(m, this.mine(s, m), true);
    }
    for (const c of s.client?.channels.keys() ?? []) if (this.isText(s, c)) st.shown.add(c);
  }

  private keep(st: State, list: TextMsg[]): TextMsg[] {
    if (!list.length) return [];
    const c = list[0].c;
    const { all, added } = mergeMsgs(st.msgs.get(c) ?? [], list, KEEP);
    if (added.length) {
      st.msgs.set(c, all);
      this.saveSoon(st);
    }
    return added;
  }

  private saveSoon(st: State): void {
    clearTimeout(st.saveTimer);
    st.saveTimer = setTimeout(() => this.save(st), 1000);
  }

  // Merged into what is stored: a second connection to the same server writes there too
  private async save(st: State): Promise<void> {
    st.saveTimer = undefined;
    try {
      const kept = await getData<Record<number, TextMsg[]>>(st.storeKey) ?? {};
      for (const [c, list] of st.msgs) kept[c] = mergeMsgs(Array.isArray(kept[c]) ? kept[c] : [], list).all;
      await putData(st.storeKey, kept);
    } catch { /* storage unavailable */ }
  }

  private async forget(st: State, channelId: number): Promise<void> {
    try {
      const kept = await getData<Record<number, TextMsg[]>>(st.storeKey);
      if (!kept || !(channelId in kept)) return;
      delete kept[channelId];
      await putData(st.storeKey, kept);
    } catch { /* storage unavailable */ }
  }

  private async send(s: Session, to: number[], type: TextType, body?: unknown): Promise<void> {
    const st = this.states.get(s);
    if (!st || !to.length) return;
    for (const packet of await encodeText(type, body)) st.queue.push({ to, packet });
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
      // Queued packets can outlive the people they were meant for
      const there = to.filter(id => client.users.has(id));
      if (there.length) client.sendPluginData(there, TEXT_DATA_ID, packet);
    }
  }
}

export const textChannels = new TextChannels();
