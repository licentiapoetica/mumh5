import { load, loadList, save } from './storage.ts';

export interface SavedServer {
  id: string;
  label: string;
  host: string;
  port: number;
  username: string;
  password: string;
  identityId?: string; // certificate to connect with; the default identity when unset
  icon?: string;       // custom rail icon, a small square data: image
}

export interface Settings {
  uploadHost: string;      // f0ckm base URL, e.g. https://f0ck.dev
  uploadKey: string;       // upload-only key from scripts/chat-upload-key.mjs
  uploadExpiry: string;    // 1h / 24h / 7d / 30d
  embedHosts: string[];    // extra hosts whose media links render inline
  sendThumbnails: boolean; // include a small inline image for vanilla Mumble clients
  compact: boolean;
  youtube: 'off' | 'click' | 'thumbnail'; // YouTube links: plain, click-to-play card, card with thumbnail
  // Link previews: fetched by the upload host (private), by this computer (reveals IP), or none
  linkPreviews: 'host' | 'direct' | 'off';
  theme: ThemeId;
  publicListUrl: string;  // where the public server list comes from
}

export type ThemeId = 'dark' | 'light' | 'midnight' | 'frost' | 'win95';

export const THEMES: { id: ThemeId; name: string; note: string }[] = [
  { id: 'dark', name: 'Dark', note: 'The default' },
  { id: 'light', name: 'Light', note: 'For bright rooms' },
  { id: 'midnight', name: 'Midnight', note: 'True black, red accents' },
  { id: 'frost', name: 'Frost', note: 'Cool blue-grey' },
  { id: 'win95', name: 'Windows 95', note: 'Start me up' }
];

const defaults: Settings = {
  uploadHost: '',
  uploadKey: '',
  uploadExpiry: '30d',
  embedHosts: [],
  sendThumbnails: true,
  compact: false,
  youtube: 'click',
  linkPreviews: 'host',
  theme: 'dark',
  publicListUrl: 'https://publist.mumble.info/v1/list?version=1.5.0'
};

class SettingsStore {
  settings = $state<Settings>(load('mumh5.settings', defaults));
  servers = $state<SavedServer[]>(loadList('mumh5.servers'));
  // Pinned sha256 fingerprints of server certificates, keyed by host:port (trust on first use)
  pins = $state<Record<string, string>>(load('mumh5.pins', {}));
  // Local nicknames for other users, only visible to us; keyed by certificate hash (or name)
  nicknames = $state<Record<string, string>>(load('mumh5.nicknames', {}));

  saveSettings() { save('mumh5.settings', $state.snapshot(this.settings)); }

  upsertServer(s: SavedServer) {
    const i = this.servers.findIndex(x => x.id === s.id);
    if (i === -1) this.servers.push(s);
    else this.servers[i] = s;
    save('mumh5.servers', $state.snapshot(this.servers));
  }

  // Reorder the server list (drag and drop in the rail)
  moveServer(id: string, toIndex: number) {
    const from = this.servers.findIndex(s => s.id === id);
    if (from < 0) return;
    const list = [...this.servers];
    const [item] = list.splice(from, 1);
    list.splice(Math.max(0, Math.min(list.length, toIndex)), 0, item);
    this.servers = list;
    save('mumh5.servers', $state.snapshot(this.servers));
  }

  setServerIcon(id: string, icon: string | undefined) {
    const s = this.servers.find(x => x.id === id);
    if (!s) return;
    if (icon) s.icon = icon;
    else delete s.icon;
    save('mumh5.servers', $state.snapshot(this.servers));
  }

  removeServer(id: string) {
    this.servers = this.servers.filter(s => s.id !== id);
    save('mumh5.servers', $state.snapshot(this.servers));
  }

  setNickname(key: string, nick: string) {
    if (nick.trim()) this.nicknames[key] = nick.trim();
    else delete this.nicknames[key];
    save('mumh5.nicknames', $state.snapshot(this.nicknames));
  }

  // Name to show for a user: our local nickname, else their name
  displayName(u: { hash: string; name: string }): string {
    return this.nicknames[u.hash || `name:${u.name}`] ?? u.name;
  }

  pin(hostPort: string, fingerprint: string) {
    this.pins[hostPort] = fingerprint;
    save('mumh5.pins', $state.snapshot(this.pins));
  }

  // Hosts whose media links are embedded: the upload host plus user-added ones.
  // Other links stay plain links, so opening a chat never pings arbitrary servers.
  get trustedHosts(): string[] {
    const hosts = [...this.settings.embedHosts];
    try { if (this.settings.uploadHost) hosts.push(new URL(this.settings.uploadHost).host); } catch { /* invalid URL */ }
    return hosts.map(h => h.trim().toLowerCase()).filter(Boolean);
  }
}

export const store = new SettingsStore();
