import { desktop } from './native.ts';
import { makeServerIcon } from './images.ts';
import type { MenuItem } from './menu.svelte.ts';
import { sessions } from './session.svelte.ts';
import { store, type SavedServer } from './settings.svelte.ts';
import { ui } from './ui.svelte.ts';
import { PERM } from '../core/client.ts';

// Waiting for an automatic reconnect counts as connecting, so it shows and can be stopped
export function serverState(id: string): string {
  const s = sessions.byServer(id);
  return s?.reconnectDelay != null ? 'connecting' : s?.status ?? 'idle';
}

export function serverUnread(id: string): number {
  const s = sessions.byServer(id);
  return s && sessions.activeId !== id ? Object.values(s.unread).reduce((a, b) => a + b, 0) : 0;
}

function pickIcon(id: string) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (file) store.setServerIcon(id, await makeServerIcon(file).catch(() => undefined));
  };
  input.click();
}

function connectionItems(s: SavedServer): MenuItem[] {
  const state = serverState(s.id);
  return [
    state === 'idle'
      ? { label: 'Connect', action: () => sessions.open(s) }
      : { label: 'Disconnect', action: () => sessions.close(s.id) },
    ...(state === 'connected' && sessions.voiceId !== s.id
      ? [{ label: 'Talk here', action: () => { sessions.select(s.id); sessions.setVoice(sessions.byServer(s.id)!); } }]
      : [])
  ];
}

function editItems(s: SavedServer): MenuItem[] {
  return [
    { label: 'Change icon...', action: () => pickIcon(s.id) },
    ...(s.icon ? [{ label: 'Remove icon', action: () => store.setServerIcon(s.id, undefined) }] : []),
    { label: 'Edit...', action: () => (ui.editServer = s) }
  ];
}

// A tile in the server list
export function railMenu(s: SavedServer, i: number): MenuItem[] {
  return [
    { header: true, label: s.label },
    ...connectionItems(s),
    { separator: true, label: '' },
    { label: 'Move up', disabled: i === 0, action: () => store.moveServer(s.id, i - 1) },
    { label: 'Move down', disabled: i === store.servers.length - 1, action: () => store.moveServer(s.id, i + 1) },
    { separator: true, label: '' },
    ...editItems(s)
  ];
}

// The current server's button: also what the hidden list would offer
export function currentServerMenu(s: SavedServer | undefined): MenuItem[] {
  const others = store.servers.filter(o => o.id !== s?.id);
  return [
    ...(s ? [{ header: true, label: s.label }, ...connectionItems(s), { separator: true, label: '' }, ...editItems(s), { separator: true, label: '' }] : []),
    ...(others.length ? [
      { header: true, label: 'Switch to' },
      ...others.map(o => {
        const unread = serverUnread(o.id);
        return { label: unread ? `${o.label} (${unread > 99 ? '99+' : unread})` : o.label, action: () => sessions.open(o) };
      }),
      { separator: true, label: '' }
    ] : []),
    ...(sessions.active.status !== 'idle'
      ? [sessions.homeShown
        ? { label: 'Back to server', action: () => (sessions.homeShown = false) }
        : { label: 'Go to home screen', action: () => (sessions.homeShown = true) }]
      : []),
    ...(sessions.active.status === 'connected'
      ? [{ label: 'Roles and members...', disabled: sessions.active.can(0, PERM.Write) !== true, action: () => (ui.rolesDialog = {}) }]
      : []),
    { label: 'Add a server...', action: () => (ui.addServer = {}) },
    // The public list and its pings need the desktop app
    ...(desktop ? [{ label: 'Browse public servers...', action: () => (ui.publicServers = true) }] : []),
    { label: 'Show server list', action: () => { store.settings.railHidden = false; store.saveSettings(); } }
  ];
}
