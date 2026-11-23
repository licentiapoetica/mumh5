import { atDefaults, changedFrom, freshList, load, loadList, save } from './storage.ts';
import { GENERATED_THEMES } from './themes-generated.ts';
import { DEFAULT_TOOLBAR, type ToolbarLayout } from '../core/toolbar.ts';

export interface SavedServer {
  id: string;
  label: string;
  host: string;
  port: number;
  username: string;
  password: string;
  identityId?: string; // certificate to connect with; the default identity when unset
  icon?: string;       // custom rail icon, a small square data: image
  autoReconnect?: boolean; // retry unexpected disconnects; off for existing and new servers
  autoConnect?: boolean;   // connect when the app starts; off unless chosen
}

export interface Settings {
  embedHosts: string[];    // hosts whose media links render inline
  mediaLinks: 'click' | 'off'; // media links from other hosts: a card that loads when clicked, or plain links
  sendThumbnails: boolean; // a preview picture with sent pictures and videos (all that other clients see)
  autoDownload: number;    // fetch announced files up to this many MB by themselves; 0: never
  saveChatHistory: boolean;
  chatHistoryHours: number;
  compact: boolean;
  youtube: 'off' | 'click' | 'thumbnail'; // YouTube links: plain, click-to-play card, card with thumbnail
  // Link previews: fetched by this computer (reveals IP to the linked site), or none
  linkPreviews: 'direct' | 'off';
  theme: ThemeId;
  backgroundDesign: BackgroundDesign;
  backgroundFit: BackgroundFit;
  backgroundStrength: number;
  backgroundColor: string;
  backgroundMark: number | null;    // dot size or grid line width in px; null: the design's own
  backgroundSpacing: number | null; // distance between dots or grid lines in px; null: the design's own
  // The channel list (and the Rooms list): nothing, the chat's background, or its own
  treeBackground: 'none' | 'same' | 'own';
  treeBackgroundStyle: BackgroundStyle;
  publicListUrl: string;  // where the public server list comes from
  arrangement: Arrangement;
  classicSide: 'left' | 'right'; // the side of the chat the channel list is on in the Classic layout
  railHidden: boolean;   // the server list is closed; the current server's button brings it back
  // standard: the channel tree in one of the layouts above. rooms: one screen at a time, made for phones.
  interface: 'standard' | 'rooms';
  shareQuality: 'low' | 'medium' | 'high'; // bitrate and frame rate of our own stream
  autoCameras: boolean;   // show other people's cameras as they come on
  cameraDevice: string;   // the webcam; empty is the system's default
  cameraSize: '480' | '720' | '1080';
  cameraFps: number;
  cameraMirror: boolean;  // show our own camera mirrored to ourselves, never to others
  shareVolume: number;    // volume of streams we watch, 0 to 1
  relayServer: string;    // a mumh5 web proxy whose STUN and relay to use for screen sharing
  stunServer: string;     // helps screen sharing connect through routers; empty contacts nobody
  shareNoticeSeen: boolean; // the note that screen sharing reveals IP addresses was confirmed
  hints: boolean;         // tooltips (title attributes) when resting the pointer on buttons
  updateCheck: boolean;   // desktop: ask GitHub now and then for a newer build; browser: ask the site
  pokeNotify: boolean;    // a system notification for a poke while the window is not focused
  roleIcons: 'all' | 'top' | 'off'; // role icons next to names
  roleColors: boolean;   // names in the color of their top role
  avatars: 'pictures' | 'spheres'; // spheres replace pictures and letters, except in chat, members, profiles and voice tiles
  toolbar: ToolbarLayout; // order of the toolbar's buttons and spacers, and the hidden buttons
  treeLines: boolean;     // lines and a root node in the channel tree
}

// Window layouts; classic and stacked follow the Mumble desktop client's layouts of the same name
export type Arrangement = 'side' | 'classic' | 'stacked';
export type BackgroundDesign = 'none' | 'image' | 'gradient' | 'grid' | 'dots';
export type BackgroundFit = 'cover' | 'contain' | 'tile';
export interface BackgroundStyle {
  design: BackgroundDesign; fit: BackgroundFit; strength: number; color: string; mark: number | null; spacing: number | null;
}

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

// What a server's tile shows without an icon
export const serverInitials = (label: string) =>
  label.split(/[\s._-]+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';

const defaults: Settings = {
  embedHosts: [],
  mediaLinks: 'click',
  sendThumbnails: true,
  autoDownload: 20,
  saveChatHistory: false,
  chatHistoryHours: 24,
  compact: false,
  youtube: 'off',
  linkPreviews: 'off',
  theme: 'dark',
  backgroundDesign: 'none',
  backgroundFit: 'cover',
  backgroundStrength: 20,
  backgroundColor: '#5865f2',
  backgroundMark: null,
  backgroundSpacing: null,
  treeBackground: 'none',
  treeBackgroundStyle: { design: 'none', fit: 'cover', strength: 20, color: '#5865f2', mark: null, spacing: null },
  publicListUrl: 'https://publist.mumble.info/v1/list?version=1.5.0',
  arrangement: 'stacked',
  classicSide: 'right',
  railHidden: true,
  interface: 'standard',
  shareQuality: 'medium',
  autoCameras: true,
  cameraDevice: '',
  cameraSize: '720',
  cameraFps: 30,
  cameraMirror: true,
  shareVolume: 1,
  relayServer: '',
  stunServer: '',
  shareNoticeSeen: false,
  hints: false,
  updateCheck: true,
  pokeNotify: true,
  roleIcons: 'all',
  roleColors: true,
  avatars: 'spheres',
  toolbar: DEFAULT_TOOLBAR,
  treeLines: true
};

// Where in Settings each setting is reset; parts of Appearance are its headings.
// kept: not picked in Settings (window state, notices already seen).
export type SettingsPart = 'video' | 'sharing' | 'sounds' | 'accessibility' | 'files' | 'about' | 'kept'
  | 'appearance.roles' | 'appearance.people' | 'appearance.interface' | 'appearance.layout'
  | 'appearance.background' | 'appearance.tree' | 'appearance.scheme';
const PARTS: Record<keyof Settings, SettingsPart> = {
  embedHosts: 'files', mediaLinks: 'files', sendThumbnails: 'files', autoDownload: 'files',
  saveChatHistory: 'files', chatHistoryHours: 'files', youtube: 'files', linkPreviews: 'files',
  compact: 'kept',
  theme: 'appearance.scheme',
  backgroundDesign: 'appearance.background', backgroundFit: 'appearance.background', backgroundStrength: 'appearance.background',
  backgroundColor: 'appearance.background', backgroundMark: 'appearance.background', backgroundSpacing: 'appearance.background',
  treeBackground: 'appearance.tree', treeBackgroundStyle: 'appearance.tree',
  publicListUrl: 'kept',
  arrangement: 'appearance.layout', classicSide: 'appearance.layout', toolbar: 'appearance.layout', treeLines: 'appearance.layout',
  railHidden: 'kept',
  interface: 'appearance.interface',
  cameraDevice: 'video', cameraSize: 'video', cameraFps: 'video', cameraMirror: 'video', autoCameras: 'video',
  shareQuality: 'sharing', shareVolume: 'sharing', relayServer: 'sharing', stunServer: 'sharing',
  shareNoticeSeen: 'kept',
  hints: 'accessibility',
  updateCheck: 'about',
  pokeNotify: 'sounds',
  roleIcons: 'appearance.roles', roleColors: 'appearance.roles',
  avatars: 'appearance.people'
};

/** The settings a part covers; 'appearance' covers all of its headings. */
export function settingsIn(part: string): (keyof Settings)[] {
  return (Object.keys(PARTS) as (keyof Settings)[]).filter(k => PARTS[k] === part || PARTS[k].startsWith(`${part}.`));
}

class SettingsStore {
  // A copy, so nested defaults are never changed through the settings
  settings = $state<Settings>(load('mumh5.settings', structuredClone(defaults)));
  servers = $state<SavedServer[]>(loadList('mumh5.servers'));
  // Pinned sha256 fingerprints of server certificates, keyed by host:port (trust on first use)
  pins = $state<Record<string, string>>(load('mumh5.pins', {}));
  // Channel passwords that worked (Mumble access tokens), keyed by host:port
  tokens = $state<Record<string, string[]>>(load('mumh5.tokens', {}));
  // Username to suggest when connecting with an identity, keyed by identity id
  identityNames = $state<Record<string, string>>(load('mumh5.identityNames', {}));
  // Local nicknames for other users, only visible to us; keyed by certificate hash (or name)
  nicknames = $state<Record<string, string>>(load('mumh5.nicknames', {}));
  // The name you chose, per server and certificate; guests lose their comment on disconnect
  displayNames = $state<Record<string, string>>(load('mumh5.displayNames', {}));

  setIdentityName(id: string, name: string) {
    if (name.trim()) this.identityNames[id] = name.trim();
    else delete this.identityNames[id];
    save('mumh5.identityNames', $state.snapshot(this.identityNames));
  }

  saveSettings() { save('mumh5.settings', changedFrom($state.snapshot(this.settings), defaults)); }

  isDefault(part: string): boolean { return atDefaults(this.settings, defaults, settingsIn(part)); }

  resetSettings(part: string) {
    // Assigned one by one: views hold on to the settings object
    for (const k of settingsIn(part)) (this.settings as Record<keyof Settings, unknown>)[k] = structuredClone(defaults[k]);
    this.saveSettings();
  }

  // A dev and a packaged copy can be open together; don't save over the other's changes
  private refreshServers() {
    const fresh = freshList<SavedServer>('mumh5.servers', this.servers);
    if (JSON.stringify(fresh) !== JSON.stringify(this.servers)) this.servers = fresh;
  }

  upsertServer(s: SavedServer) {
    this.refreshServers();
    const i = this.servers.findIndex(x => x.id === s.id);
    if (i === -1) this.servers.push(s);
    else this.servers[i] = s;
    save('mumh5.servers', $state.snapshot(this.servers));
  }

  // Reorder the server list (drag and drop in the rail)
  moveServer(id: string, toIndex: number) {
    this.refreshServers();
    const from = this.servers.findIndex(s => s.id === id);
    if (from < 0) return;
    const list = [...this.servers];
    const [item] = list.splice(from, 1);
    list.splice(Math.max(0, Math.min(list.length, toIndex)), 0, item);
    this.servers = list;
    save('mumh5.servers', $state.snapshot(this.servers));
  }

  setServerIcon(id: string, icon: string | undefined) {
    this.refreshServers();
    const s = this.servers.find(x => x.id === id);
    if (!s) return;
    if (icon) s.icon = icon;
    else delete s.icon;
    save('mumh5.servers', $state.snapshot(this.servers));
  }

  // The server a hosted web app names (MUMH5_DEFAULT_SERVER), added once per browser, so
  // removing it sticks; a new default on the site is added again. No name yet: connecting asks.
  addDefaultServer(d: { host: string; port: number; label: string }) {
    const key = `${d.host}:${d.port}`;
    if (load('mumh5.defaultServer', { added: '' }).added === key) return;
    save('mumh5.defaultServer', { added: key });
    this.refreshServers();
    if (this.servers.some(s => s.host.toLowerCase() === d.host && s.port === d.port)) return;
    this.upsertServer({ id: crypto.randomUUID(), label: d.label, host: d.host, port: d.port, username: this.servers.at(-1)?.username ?? '', password: '' });
  }

  removeServer(id: string) {
    this.refreshServers();
    this.servers = this.servers.filter(s => s.id !== id);
    save('mumh5.servers', $state.snapshot(this.servers));
  }

  setNickname(key: string, nick: string) {
    if (nick.trim()) this.nicknames[key] = nick.trim();
    else delete this.nicknames[key];
    save('mumh5.nicknames', $state.snapshot(this.nicknames));
  }

  setDisplayName(key: string, name: string) {
    if ((this.displayNames[key] ?? '') === name) return;
    if (name) this.displayNames[key] = name;
    else delete this.displayNames[key];
    save('mumh5.displayNames', $state.snapshot(this.displayNames));
  }

  // Name to show for a user: our local nickname, else the name they chose, else their account name
  displayName(u: { hash: string; name: string; displayName?: string }): string {
    return this.nicknames[u.hash || `name:${u.name}`] ?? (u.displayName || u.name);
  }

  pin(hostPort: string, fingerprint: string) {
    this.pins[hostPort] = fingerprint;
    save('mumh5.pins', $state.snapshot(this.pins));
  }

  tokensFor(hostPort: string): string[] {
    return [...(this.tokens[hostPort] ?? [])];
  }

  // Murmur compares tokens without regard to case
  addToken(hostPort: string, token: string) {
    const have = this.tokensFor(hostPort);
    if (have.some(t => t.toLowerCase() === token.toLowerCase())) return;
    this.tokens[hostPort] = [...have, token];
    save('mumh5.tokens', $state.snapshot(this.tokens));
  }

  removeToken(hostPort: string, token: string) {
    this.tokens[hostPort] = this.tokensFor(hostPort).filter(t => t.toLowerCase() !== token.toLowerCase());
    save('mumh5.tokens', $state.snapshot(this.tokens));
  }

  // Hosts whose media links are embedded, as the user listed them.
  // Other links stay plain links, so opening a chat never pings arbitrary servers.
  get trustedHosts(): string[] {
    return this.settings.embedHosts.map(h => h.trim().toLowerCase()).filter(Boolean);
  }

  trustHost(host: string) {
    if (this.trustedHosts.includes(host.toLowerCase())) return;
    this.settings.embedHosts = [...this.settings.embedHosts, host.toLowerCase()];
    this.saveSettings();
  }
}

export const store = new SettingsStore();
