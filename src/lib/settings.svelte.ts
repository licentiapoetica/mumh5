import { load, loadList, save } from './storage.ts';
import { GENERATED_THEMES } from './themes-generated.ts';

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
  embedHosts: string[];    // hosts whose media links render inline
  sendThumbnails: boolean; // a preview picture with sent pictures and videos (all that other clients see)
  autoDownload: number;    // fetch announced files up to this many MB by themselves; 0: never
  compact: boolean;
  youtube: 'off' | 'click' | 'thumbnail'; // YouTube links: plain, click-to-play card, card with thumbnail
  // Link previews: fetched by this computer (reveals IP to the linked site), or none
  linkPreviews: 'direct' | 'off';
  theme: ThemeId;
  publicListUrl: string;  // where the public server list comes from
  arrangement: Arrangement;
  // standard: the channel tree in one of the layouts above. rooms: one screen at a time, made for phones.
  interface: 'standard' | 'rooms';
  shareQuality: 'low' | 'medium' | 'high'; // bitrate and frame rate of our own stream
  autoCameras: boolean;   // show other people's cameras as they come on
  shareVolume: number;    // volume of streams we watch, 0 to 1
  relayServer: string;    // a mumh5 web proxy whose STUN and relay to use for screen sharing
  stunServer: string;     // helps screen sharing connect through routers; empty contacts nobody
  shareNoticeSeen: boolean; // the note that screen sharing reveals IP addresses was confirmed
  hints: boolean;         // tooltips (title attributes) when resting the pointer on buttons
}

// Window layouts; classic and stacked follow the Mumble desktop client's layouts of the same name
export type Arrangement = 'side' | 'classic' | 'stacked';

export type ThemeId = 'dark' | 'light' | 'midnight' | 'frost' | 'forest' | 'ember' | 'ocean' | 'plum' | 'paper' | 'contrast' | 'win95' | typeof GENERATED_THEMES[number]['id'];

// Hand-made schemes first, then the generated ones (scripts/gen-themes.mjs), dark before light
export const THEMES: { id: ThemeId; name: string; note: string; light: boolean }[] = [
  { id: 'dark', name: 'Dark', note: 'The default', light: false },
  { id: 'light', name: 'Light', note: 'For bright rooms', light: true },
  { id: 'midnight', name: 'Midnight', note: 'True black, red accents', light: false },
  { id: 'frost', name: 'Frost', note: 'Cool blue-grey', light: false },
  { id: 'forest', name: 'Forest', note: 'Deep green, warm light', light: false },
  { id: 'ember', name: 'Ember', note: 'Warm dark, orange accents', light: false },
  { id: 'ocean', name: 'Ocean', note: 'Deep navy, cyan accents', light: false },
  { id: 'plum', name: 'Plum', note: 'Dark purple, pink accents', light: false },
  { id: 'paper', name: 'Paper', note: 'Warm light, easy on the eyes', light: true },
  { id: 'contrast', name: 'High contrast', note: 'Black and white, strong lines', light: false },
  { id: 'win95', name: 'Windows 95', note: 'Start me up', light: true },
  ...GENERATED_THEMES
];

const defaults: Settings = {
  embedHosts: [],
  sendThumbnails: true,
  autoDownload: 20,
  compact: false,
  youtube: 'off',
  linkPreviews: 'off',
  theme: 'dark',
  publicListUrl: 'https://publist.mumble.info/v1/list?version=1.5.0',
  arrangement: 'side',
  interface: 'standard',
  shareQuality: 'medium',
  autoCameras: true,
  shareVolume: 1,
  relayServer: '',
  stunServer: '',
  shareNoticeSeen: false,
  hints: false
};

class SettingsStore {
  settings = $state<Settings>(load('mumh5.settings', defaults));
  servers = $state<SavedServer[]>(loadList('mumh5.servers'));
  // Pinned sha256 fingerprints of server certificates, keyed by host:port (trust on first use)
  pins = $state<Record<string, string>>(load('mumh5.pins', {}));
  // Username to suggest when connecting with an identity, keyed by identity id
  identityNames = $state<Record<string, string>>(load('mumh5.identityNames', {}));
  // Local nicknames for other users, only visible to us; keyed by certificate hash (or name)
  nicknames = $state<Record<string, string>>(load('mumh5.nicknames', {}));

  setIdentityName(id: string, name: string) {
    if (name.trim()) this.identityNames[id] = name.trim();
    else delete this.identityNames[id];
    save('mumh5.identityNames', $state.snapshot(this.identityNames));
  }

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

  // Hosts whose media links are embedded, as the user listed them.
  // Other links stay plain links, so opening a chat never pings arbitrary servers.
  get trustedHosts(): string[] {
    return this.settings.embedHosts.map(h => h.trim().toLowerCase()).filter(Boolean);
  }
}

export const store = new SettingsStore();
