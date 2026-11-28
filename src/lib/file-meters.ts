// Per person counters for the details of a file transfer: who we get a file from or send it to,
// over which route, how much and how fast. Kept apart from the reactive state and handed to it
// once a second (and on changes of route or state), so a fast link does not redraw per piece.
import type { LinkRoute } from './file-links.ts';
import type { Session } from './session.svelte.ts';

export type PeerRoute = 'server' | LinkRoute;
// waiting: asked, nothing moving; connecting: a link is being set up; done: they have it all
export type PeerState = 'waiting' | 'connecting' | 'active' | 'done' | 'gone';
export type PeerDir = 'from' | 'to';

// A WebRTC link with this person, apart from the route the pieces took: being set up, up,
// failed or declined (with why), or not possible at all (none, with why)
export type LinkState = 'connecting' | 'open' | 'closed' | 'failed' | 'declined' | 'none';
export interface LinkInfo { route: LinkRoute; state: LinkState; reason: string }

export interface PeerStat {
  session: number;
  dir: PeerDir;
  route: PeerRoute;  // the route that carried most, or the link being set up before anything moved
  via: Partial<Record<PeerRoute, number>>; // pieces per route
  state: PeerState;
  bytes: number;   // file bytes moved with this person
  pieces: number;
  rate: number;    // bytes per second over the last second
  path: string;    // a link's protocol, route and round trip, while the details are open
  link: LinkInfo | null;
}

interface Meter extends PeerStat { prev: number; prevAt: number; lastAt: number }

const TICK_MS = 1000;
// Counts as moving this long after the last piece; the ticker stops after a quiet while
const ACTIVE_MS = 3000;
const QUIET_MS = 10000;

export class Meters {
  private files = new Map<string, { s: Session; meters: Map<string, Meter> }>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private publish: (id: string, peers: PeerStat[]) => void;
  private pathOf: (id: string, peer: PeerStat) => Promise<string> | null;
  // Files whose details are on screen: only those read their links' paths
  private shown = new Map<string, number>();

  constructor(publish: (id: string, peers: PeerStat[]) => void, pathOf: (id: string, peer: PeerStat) => Promise<string> | null) {
    this.publish = publish;
    this.pathOf = pathOf;
  }

  private meter(s: Session, id: string, session: number, dir: PeerDir): Meter {
    let file = this.files.get(id);
    if (!file || file.s !== s) this.files.set(id, file = { s, meters: new Map() });
    const key = `${dir}:${session}`;
    let m = file.meters.get(key);
    if (!m) {
      file.meters.set(key, m = { session, dir, route: 'server', via: {}, state: 'waiting', bytes: 0, pieces: 0, rate: 0, path: '', link: null, prev: 0, prevAt: Date.now(), lastAt: 0 });
    }
    return m;
  }

  /** A change of route or state, shown at once. */
  update(s: Session, id: string, session: number, dir: PeerDir, patch: Partial<Pick<PeerStat, 'route' | 'state'>>): void {
    const m = this.meter(s, id, session, dir);
    // Nothing undoes "done" but leaving
    if (m.state === 'done' && patch.state && patch.state !== 'gone') delete patch.state;
    // A link coming up shows at once; once pieces moved, the counts decide
    if (patch.route && m.pieces && patch.route === 'server') delete patch.route;
    Object.assign(m, patch);
    if (m.state === 'done' || m.state === 'gone') m.rate = 0;
    // The receiver closes the link as soon as the file is complete, before its word that it has
    // it arrives: a link that closed with pieces over it was used, not cut off
    if (m.state === 'done' && m.link?.state === 'closed' && (m.via[m.link.route] ?? 0) > 0) {
      m.link = { ...m.link, state: 'open', reason: '' };
    }
    this.show(id);
  }

  /** What happened with a link to this person; a failure keeps its reason. */
  link(s: Session, id: string, session: number, dir: PeerDir, link: LinkInfo): void {
    const m = this.meter(s, id, session, dir);
    // A link that closes after carrying the file stays "open" in the record, not "closed"
    if (link.state === 'closed' && m.state === 'done') return;
    m.link = link;
    this.show(id);
  }

  /** A piece moved with this person. */
  add(s: Session, id: string, session: number, dir: PeerDir, bytes: number, route: PeerRoute): void {
    const m = this.meter(s, id, session, dir);
    m.via = { ...m.via, [route]: (m.via[route] ?? 0) + 1 };
    // A piece already on its way through the server after a link took over does not make it the route
    const main = (Object.entries(m.via) as [PeerRoute, number][]).reduce((a, b) => (b[1] > a[1] || (b[1] === a[1] && a[0] === 'server') ? b : a))[0];
    const changed = m.route !== main || (m.state !== 'active' && m.state !== 'done') || Object.keys(m.via).length > 1;
    m.bytes += bytes;
    m.pieces++;
    m.lastAt = Date.now();
    m.route = main;
    if (m.state !== 'done') m.state = 'active';
    if (changed) this.show(id);
    this.run();
  }

  /** Forgets one side of a file, for a new download of it. */
  clear(id: string, dir: PeerDir): void {
    const file = this.files.get(id);
    if (!file) return;
    for (const [key, m] of file.meters) if (m.dir === dir) file.meters.delete(key);
    this.show(id);
  }

  /** Everyone still busy on one side of a file. */
  finish(id: string, dir: PeerDir, state: PeerState): void {
    const file = this.files.get(id);
    if (!file) return;
    for (const m of file.meters.values()) {
      if (m.dir !== dir || m.state === 'done' || m.state === 'gone') continue;
      m.state = state;
      m.rate = 0;
    }
    this.show(id);
  }

  /** Someone left the server. */
  left(s: Session, session: number): void {
    for (const [id, file] of this.files) {
      if (file.s !== s) continue;
      let hit = false;
      for (const m of file.meters.values()) if (m.session === session && m.state !== 'done') { m.state = 'gone'; m.rate = 0; hit = true; }
      if (hit) this.show(id);
    }
  }

  closed(s: Session): void {
    for (const [id, file] of this.files) {
      if (file.s !== s) continue;
      this.finish(id, 'from', 'gone');
      this.finish(id, 'to', 'gone');
    }
  }

  /** The details of a file opened or closed on screen. */
  watch(id: string, on: boolean): void {
    const n = (this.shown.get(id) ?? 0) + (on ? 1 : -1);
    if (n > 0) this.shown.set(id, n);
    else this.shown.delete(id);
    if (on) this.run();
  }

  private show(id: string): void {
    const file = this.files.get(id);
    this.publish(id, file ? [...file.meters.values()].map(({ prev: _p, prevAt: _a, lastAt: _l, ...stat }) => stat) : []);
  }

  private run(): void {
    if (!this.timer) this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  private tick(): void {
    const now = Date.now();
    let busy = false;
    for (const [id, file] of this.files) {
      let changed = false;
      for (const m of file.meters.values()) {
        const moving = m.pieces > 0 && now - m.lastAt < ACTIVE_MS && m.state !== 'done' && m.state !== 'gone';
        const rate = moving ? (m.bytes - m.prev) / Math.max(0.001, (now - m.prevAt) / 1000) : 0;
        if (rate !== m.rate) { m.rate = rate; changed = true; }
        m.prev = m.bytes;
        m.prevAt = now;
        if (now - m.lastAt < QUIET_MS || m.state === 'connecting') busy = true;
      }
      if (this.shown.has(id)) {
        busy = true;
        const reads = [...file.meters.values()].map(m => {
          const p = m.route === 'server' || m.state === 'done' || m.state === 'gone' ? null : this.pathOf(id, m);
          return p?.then(path => { if (path !== m.path) { m.path = path; return true; } return false; });
        }).filter(Boolean);
        if (reads.length) void Promise.all(reads).then(r => { if (r.some(Boolean)) this.show(id); });
      }
      if (changed) this.show(id);
    }
    if (!busy) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }
}
