import { native } from './native.ts';
import { store } from './settings.svelte.ts';
import { sessions } from './session.svelte.ts';

export interface ServerCount { users: number; maxUsers: number; ping: number }

// How many people are on each saved server, before connecting: a UDP ping (through the proxy in
// the browser) at start, for servers added later, and once a minute while the window is visible
class ServerStatus {
  counts = $state<Record<string, ServerCount | null>>({});
  private started = false;
  // Server and address pairs asked about already; an edited address counts as new
  private asked = new Set<string>();

  start(): void {
    if (this.started || !native) return;
    this.started = true;
    $effect.root(() => {
      // A server added or edited is asked about right away
      $effect(() => {
        const fresh = store.servers.filter(s => !this.asked.has(`${s.id}@${s.host}:${s.port}`));
        for (const s of fresh) this.asked.add(`${s.id}@${s.host}:${s.port}`);
        if (fresh.length) this.refresh(fresh);
      });
    });
    setInterval(() => { if (!document.hidden) this.refresh(store.servers); }, 60000);
  }

  private refresh(list: { id: string; host: string; port: number }[]): void {
    for (const s of list) {
      native!.pingServer(s.host, s.port).catch(() => null).then(r => {
        this.counts[s.id] = r ? { users: r.users, maxUsers: r.maxUsers, ping: Math.round(r.ping) } : null;
      });
    }
  }
}

export const serverStatus = new ServerStatus();

// People on a saved server: counted live while connected, from the last ping otherwise
export function peopleOn(id: string): { users: number; maxUsers: number } | null {
  const live = sessions.byServer(id);
  if (live?.status === 'connected' && live.client) return { users: live.allUsers().length, maxUsers: live.client.config.maxUsers };
  return serverStatus.counts[id] ?? null;
}
