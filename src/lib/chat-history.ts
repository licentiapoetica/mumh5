import type { User } from '../core/client.ts';
import type { ChatEntry, Session, ViewKey } from './session.svelte.ts';
import { dataKeys, deleteBlob, getData, putData, updateData } from './blobstore.ts';
import { currentChatMessage, historyHours } from '../core/chat-retention.ts';
import { persistentChatAuthor } from '../core/chat-author.ts';
import { store } from './settings.svelte.ts';
import { copyReactions, readReactions, type Reaction } from '../core/reactions.ts';

export interface SavedMessage { id: string; time: number; author: string; self: boolean; raw: string; reactions?: Reaction[]; authorIdentity?: string }
interface Conversation { route: string; name: string; messages: SavedMessage[]; hidden?: boolean }
interface State {
  client: Session['client']; key: string; epoch: string; loaded: boolean;
  data: Map<string, Conversation>; routes: Map<string, string>; targets: Map<string, ViewKey>;
  pending: (() => void)[]; nextOffline: number;
}
const retention = () => historyHours(store.settings.chatHistoryHours) * 60 * 60 * 1000;
const savingEnabled = () => store.settings.saveChatHistory === true;

// Only identities supplied by the server can reconnect a private conversation.
// A guest without either identity remains offline rather than matching by display name.
function peer(user: User, st: State): string {
  return user.hash ? `hash:${user.hash}` : user.userId != null ? `user:${user.userId}` : `guest:${st.epoch}:${user.session}`;
}

class ChatHistory {
  private states = new WeakMap<Session, State>();
  private saves = new Map<string, Promise<unknown>>();
  private loads = new Map<string, Promise<void>>();
  private active = new Set<Session>();
  private enabled: boolean | undefined;
  private hours = 24;
  private revision = 0;

  constructor() {
    if (typeof window === 'undefined') return;
    const clean = () => { void this.expire(); };
    setTimeout(clean, 0);
    setInterval(clean, 60_000);
    window.addEventListener('focus', clean);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) clean(); });
  }

  private channel(s: Session, id: number): string | undefined {
    const names: string[] = [], seen = new Set<number>();
    let c = s.channel(id);
    if (!c || s.isText(id)) return;
    while (c && !seen.has(c.id)) {
      seen.add(c.id); names.unshift(c.name);
      c = c.parent == null ? undefined : s.channel(c.parent);
    }
    return `channel:${JSON.stringify(names)}`;
  }

  entered(s: Session): Promise<void> {
    const client = s.client, server = s.server;
    if (!client || !server) return Promise.resolve();
    const owner = client.self?.hash || (client.self?.userId != null ? `user:${client.self.userId}` : `${server.identityId ?? 'default'}:${server.username}`);
    const st: State = { client, key: `chat-history:${JSON.stringify([server.host.toLowerCase(), server.port, owner])}`,
      epoch: crypto.randomUUID(), loaded: false, data: new Map(), routes: new Map(), targets: new Map(), pending: [], nextOffline: -1 };
    this.states.set(s, st);
    this.active.add(s);
    s.dmNames = {};
    for (const user of client.users.values()) st.targets.set(peer(user, st), `dm:${user.session}`);
    for (const id of client.channels.keys()) {
      const route = this.channel(s, id);
      if (route) { st.targets.set(route, `ch:${id}`); st.routes.set(`ch:${id}`, route); }
    }
    const loading = this.load(s, st, this.loads.get(st.key));
    this.loads.set(st.key, loading);
    return loading;
  }

  private async load(s: Session, st: State, previous?: Promise<void>): Promise<void> {
    try {
      // A new Session may follow a disconnect while the previous write is committing.
      await previous;
      await this.saves.get(st.key);
      const kept = savingEnabled() ? await getData<unknown>(st.key) : undefined;
      if (Array.isArray(kept)) for (const c of kept) {
        if (!c || typeof c.route !== 'string' || typeof c.name !== 'string' || !Array.isArray(c.messages)) continue;
        const messages: SavedMessage[] = c.messages.filter((m: SavedMessage) => m && typeof m.id === 'string' && Number.isFinite(m.time)
          && currentChatMessage(m.time, Date.now(), retention()) && typeof m.author === 'string' && typeof m.self === 'boolean' && typeof m.raw === 'string')
          .map((m: SavedMessage) => {
            const reactions = readReactions(m.reactions);
            // Older DMs identify the incoming author through the conversation route.
            // Channel archives without metadata cannot safely be matched by display name.
            const authorIdentity = persistentChatAuthor(m.authorIdentity) ? m.authorIdentity
              : !m.self && persistentChatAuthor(c.route) ? c.route : undefined;
            return { id: m.id, time: m.time, author: m.author, self: m.self, raw: m.raw, authorIdentity, ...(reactions.length ? { reactions } : {}) };
          });
        st.data.set(c.route, { route: c.route, name: c.name, messages, hidden: c.hidden === true });
      }
    } catch { /* unavailable storage: keep the current session usable */ }
    st.loaded = true;
    for (const apply of st.pending) apply();
    this.save(st);
    st.pending = [];
    if (this.states.get(s) !== st || s.client !== st.client) return;
    for (const c of st.data.values()) {
      if (c.hidden) continue;
      let key = st.targets.get(c.route);
      if (!key && !c.route.startsWith('channel:')) key = `dm:${st.nextOffline--}`;
      if (!key) continue;
      st.targets.set(c.route, key); st.routes.set(key, c.route);
      if (key.startsWith('dm:')) s.dmNames[key] = c.name;
      if (!s.logs[key]) s.logs[key] = [];
      for (const message of c.messages) s.restoreChat(key, message);
    }
  }

  private route(s: Session, st: State, key: string): string | undefined {
    if (key.startsWith('ch:')) return this.channel(s, Number(key.slice(3)));
    const user = s.user(Number(key.slice(3)));
    return user ? peer(user, st) : st.routes.get(key);
  }

  private change(st: State, apply: () => void): void {
    if (!st.loaded) { st.pending.push(apply); return; }
    apply(); this.save(st);
  }

  record(s: Session, key: string, raw: string, entry?: ChatEntry): void {
    const st = this.states.get(s);
    if (!st || st.client !== s.client) return;
    const route = this.route(s, st, key);
    if (!route) return;
    st.routes.set(key, route); st.targets.set(route, key as ViewKey);
    const name = s.viewTitle(key);
    if (key.startsWith('dm:')) s.dmNames[key] = name;
    const message: SavedMessage | undefined = entry ? { id: entry.historyId ??= crypto.randomUUID(), time: entry.time, author: entry.author, self: entry.self, raw,
      authorIdentity: persistentChatAuthor(entry.authorIdentity) ? entry.authorIdentity : undefined } : undefined;
    this.change(st, () => {
      let c = st.data.get(route);
      if (!c) { c = { route, name, messages: [] }; st.data.set(route, c); }
      const reopen = c.hidden;
      c.hidden = false;
      c.name = name;
      if (reopen && this.states.get(s) === st && s.client === st.client) {
        for (const m of c.messages) s.restoreChat(key as ViewKey, m);
      }
      if (message) c.messages = [...c.messages, message];
    });
  }

  // Keeps the reactions of a saved message as they are now
  reacted(s: Session, key: string, entry: ChatEntry): void {
    const st = this.states.get(s);
    const id = entry.historyId;
    if (!st || st.client !== s.client || !id) return;
    const reactions = copyReactions(entry.reactions);
    const route = st.routes.get(key);
    this.change(st, () => {
      const own = route ? st.data.get(route) : undefined;
      for (const c of own ? [own] : st.data.values()) {
        const m = c.messages.find(m => m.id === id);
        if (!m) continue;
        if (reactions.length) m.reactions = reactions;
        else delete m.reactions;
        return;
      }
    });
  }

  hide(s: Session, key: string): void {
    const st = this.states.get(s);
    if (!st) return;
    const route = st.routes.get(key) ?? this.route(s, st, key);
    if (route) this.change(st, () => { const c = st.data.get(route); if (c) c.hidden = true; });
    delete s.dmNames[key];
  }

  forget(s: Session, key: string): void {
    const st = this.states.get(s);
    if (!st) return;
    const route = st.routes.get(key) ?? this.route(s, st, key);
    if (route) this.change(st, () => { st.data.delete(route); });
    st.routes.delete(key);
    delete s.dmNames[key];
  }

  private move(s: Session, st: State, route: string, key: ViewKey, name: string): void {
    const old = st.targets.get(route);
    if (old && old !== key && s.logs[old]) {
      s.logs[key] = [...(s.logs[key] ?? []), ...s.logs[old]].sort((a, b) => a.time - b.time);
      delete s.logs[old];
      if (s.unread[old]) s.unread[key] = (s.unread[key] ?? 0) + s.unread[old];
      delete s.unread[old]; delete s.dmNames[old]; st.routes.delete(old);
      if (s.view === old) s.view = key;
    }
    st.targets.set(route, key); st.routes.set(key, route);
    if (s.logs[key]) s.dmNames[key] = name;
  }

  userChanged(s: Session, user: User): void {
    const st = this.states.get(s);
    if (!st) return;
    const route = peer(user, st);
    this.move(s, st, route, `dm:${user.session}`, user.name);
  }

  userLeft(s: Session, user: User): void {
    const st = this.states.get(s);
    if (!st) return;
    const route = st.routes.get(`dm:${user.session}`) ?? peer(user, st);
    this.move(s, st, route, `dm:${st.nextOffline--}`, user.name);
  }

  private save(st: State): void {
    if (!savingEnabled()) return;
    const data = [...st.data.values()];
    for (const c of data) c.messages = c.messages.filter(m => currentChatMessage(m.time, Date.now(), retention()));
    const snapshot = data.map(c => ({ ...c, messages: c.messages.map(m => ({ ...m })) }));
    const saving = (this.saves.get(st.key) ?? Promise.resolve()).catch(() => {}).then(() => savingEnabled() ? putData(st.key, snapshot) : undefined).catch(() => {});
    this.saves.set(st.key, saving);
  }

  async configure(enabled: boolean, hours: number): Promise<void> {
    hours = historyHours(hours);
    if (this.enabled === enabled && this.hours === hours) return;
    this.enabled = enabled; this.hours = hours;
    const revision = ++this.revision;
    if (enabled) {
      await this.expire();
      for (const s of this.active) {
        const st = this.states.get(s);
        if (st?.loaded) this.save(st);
        await s.persistTextHistory();
      }
      return;
    }
    // Do not let a pending save recreate an archive after the user opts out.
    try {
      for (const key of await dataKeys()) {
        if (typeof key !== 'string' || !(key.startsWith('chat-history:') || key.startsWith('text:'))) continue;
        await this.loads.get(key); await this.saves.get(key);
        if (revision !== this.revision || savingEnabled()) return;
        await deleteBlob(key);
      }
    } catch { /* storage unavailable */ }
  }

  closed(s: Session): void { this.active.delete(s); }

  async expire(now = Date.now()): Promise<void> {
    for (const s of this.active) {
      const st = this.states.get(s);
      s.expireChat(now);
      if (!st?.loaded) continue;
      let changed = false;
      for (const c of st.data.values()) {
        const kept = c.messages.filter(m => currentChatMessage(m.time, now, retention()));
        if (kept.length !== c.messages.length) { c.messages = kept; changed = true; }
      }
      if (changed) this.save(st);
    }
    // Also purge histories for servers/accounts that are not currently connected.
    // Blob/file storage is untouched; only the two client-side message stores are scanned.
    try {
      const keys = (await dataKeys()).filter((k): k is string => typeof k === 'string' && (k.startsWith('chat-history:') || k.startsWith('text:')));
      for (const key of keys) {
        await this.loads.get(key);
        const saving = (this.saves.get(key) ?? Promise.resolve()).catch(() => {}).then(() => updateData<any>(key, kept => {
          let changed = false;
          if (key.startsWith('chat-history:') && Array.isArray(kept)) {
            for (const c of kept) if (c && Array.isArray(c.messages)) {
              const fresh = c.messages.filter((m: SavedMessage) => m && currentChatMessage(m.time, now, retention()));
              if (fresh.length !== c.messages.length) { c.messages = fresh; changed = true; }
            }
          } else if (key.startsWith('text:') && kept && typeof kept === 'object') {
            for (const [id, list] of Object.entries(kept)) if (Array.isArray(list)) {
              const fresh = list.filter(m => m && currentChatMessage(m.t, now, retention()));
              if (fresh.length !== list.length) { kept[id] = fresh; changed = true; }
            }
          }
          return changed ? kept : undefined;
        })).catch(() => {});
        this.saves.set(key, saving);
        await saving;
      }
    } catch { /* storage unavailable */ }
  }

  async flush(s: Session): Promise<void> {
    const st = this.states.get(s);
    if (st) { await this.loads.get(st.key); await this.saves.get(st.key); }
  }
}

export const chatHistory = new ChatHistory();
