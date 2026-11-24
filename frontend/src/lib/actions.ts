import { MAX_DISPLAY_NAME } from '../core/display-name.ts';
import { userLists } from './user-selection.svelte.ts';
import { session, sessions } from './session.svelte.ts';
import { share } from './share.svelte.ts';
import { ui } from './ui.svelte.ts';
import { store } from './settings.svelte.ts';
import { voice, userKey } from './audio/voice.svelte.ts';
import { sounds } from './audio/sounds.svelte.ts';
import { menu, type MenuItem } from './menu.svelte.ts';
import { PERM, type Channel, type User } from '../core/client.ts';
import { POKE_MAX } from '../core/poke.ts';
import { roleSubmenu } from './quick-roles.svelte.ts';
import { makeAvatar } from './images.ts';

// Sets your picture from a file; returns what went wrong, if anything
export async function setPictureFromFile(file: Blob): Promise<string | null> {
  try {
    const limit = session.htmlLimit > 0 ? Math.min(session.htmlLimit, 131072) : 131072;
    const bytes = await makeAvatar(file, limit);
    if (!bytes) return 'This picture does not get small enough for the server.';
    await sessions.setAvatar(bytes);
    return null;
  } catch {
    return 'This file could not be read as a picture.';
  }
}

// The icon for someone muted or deafened; deafened comes first, since it includes muted
export function voiceMark(u: User): { icon: 'headphones-off' | 'mic-off'; admin: boolean; title: string } | null {
  if (u.deaf || u.selfDeaf) return { icon: 'headphones-off', admin: !!u.deaf, title: u.deaf ? 'Deafened by server' : 'Deafened' };
  if (u.mute || u.selfMute || u.suppress) return { icon: 'mic-off', admin: !!(u.mute || u.suppress), title: u.mute ? 'Muted by server' : u.suppress ? 'Suppressed' : 'Muted' };
  return null;
}

// A person's profile card, next to the element that was clicked (or at a point, from a menu)
export function openProfile(user: number, at: Element | { x: number; y: number }, from?: Element | null): void {
  // Stays lit while the card is open; from a menu, the row the menu belonged to
  const row = from ?? (at instanceof Element ? at.closest('[data-menu-row]') : null) ?? undefined;
  const r = at instanceof Element ? at.getBoundingClientRect() : { left: at.x, right: at.x, top: at.y, bottom: at.y };
  session.loadComment(user);
  ui.profile = { session: user, anchor: { left: r.left, top: r.top, right: r.right, bottom: r.bottom }, el: at instanceof Element ? at : undefined, row };
}

export function showServerCert(): void {
  const cert = session.serverCert;
  if (!cert?.chain.length) return;
  ui.cert = {
    title: `Certificate of ${session.server?.host}`, chain: cert.chain,
    status: cert.authorized
      ? { ok: true, text: 'Valid certificate, signed by a trusted authority.' }
      : { ok: false, text: `Not signed by a trusted authority (${cert.authError ?? 'unknown reason'}). mumh5 pinned this certificate the first time you connected and warns you if it changes.` }
  };
}

// Right-click menu for a channel in the tree
export function channelMenu(c: Channel): MenuItem[] {
  const here = session.self?.channelId === c.id;
  const mine = session.self?.channelId ?? 0;
  // Greyed out only when the server said no; unknown permissions stay enabled
  const no = (bit: number) => session.can(c.id, bit) === false;
  const linked = c.links.has(mine);
  const manage: MenuItem[] = [
    { separator: true, label: '' },
    { label: 'Create channel...', disabled: no(PERM.MakeChannel) && no(PERM.MakeTempChannel), action: () => (ui.channelDialog = { mode: 'create', parent: c.id }) },
    { label: 'Edit channel...', disabled: no(PERM.Write), action: () => (ui.channelDialog = { mode: 'edit', id: c.id }) },
    { label: 'Permissions...', disabled: no(PERM.Write), action: () => (ui.channelDialog = { mode: 'edit', id: c.id, tab: 'permissions' }) },
    { label: 'Roles and members...', disabled: session.can(0, PERM.Write) !== true, action: () => (ui.rolesDialog = {}) }
  ];
  if (!here) {
    manage.push(linked
      ? { label: 'Unlink from my channel', disabled: no(PERM.LinkChannel), action: () => session.client?.setLinks(c.id, [], [mine]) }
      : { label: 'Link to my channel', disabled: no(PERM.LinkChannel), action: () => session.client?.setLinks(c.id, [mine], []) });
  }
  if (c.links.size) manage.push({ label: 'Unlink all', disabled: no(PERM.LinkChannel), action: () => session.client?.setLinks(c.id, [], [...c.links]) });
  if (c.id !== 0) {
    manage.push({
      label: 'Delete channel...', danger: true, disabled: no(PERM.Write),
      action: () => (ui.prompt = {
        title: `Delete ${c.name}?`, label: '', confirm: 'Delete channel', danger: true, input: 'none',
        text: 'The channel, its subchannels and their permissions are removed for everyone. People inside are moved out.',
        onsubmit: () => { session.client?.removeChannel(c.id); sounds.play('channelDeleted'); }
      })
    });
  }
  // A text channel is opened, not joined
  const open: MenuItem[] = session.isText(c.id)
    ? [{ label: 'Open text channel', action: () => session.selectView(`ch:${c.id}`) }]
    : [
      { label: here ? 'You are here' : c.canEnter ? 'Join channel' : 'Join with password...', action: () => session.joinChannel(c.id), disabled: here },
      // Opens the channel's chat in the side panel, ready to type, without joining it
      { label: 'Send message to channel', action: () => { session.showChannel(c.id, 'chat'); ui.panelOpen = true; } }
    ];
  return [
    { header: true, label: c.name || 'Root' },
    ...open,
    ...(!session.isText(c.id) ? [{ label: 'Select people in this channel', disabled: session.movingUsers || !session.usersIn(c.id).length,
      action: () => { userLists.last = store.settings.interface === 'rooms' ? 'rooms' : 'tree'; session.selectChannelUsers(c.id); } }] : []),
    // The tree shows it next to the channel; the Rooms interface has no tree and uses its panel
    { label: 'Show description', action: () => {
      if (store.settings.interface === 'rooms') { session.showChannel(c.id, 'info'); ui.panelOpen = true; }
      else ui.channelPreview = { id: c.id, ...menu.last };
    } },
    { separator: true, label: '' },
    { label: session.isExpanded(c.id) ? 'Collapse' : 'Expand', action: () => session.toggleExpanded(c.id), disabled: c.id === 0 },
    { label: 'Expand all', action: () => session.setAllExpanded(true) },
    { label: 'Collapse all', action: () => session.setAllExpanded(false) },
    { separator: true, label: '' },
    { label: 'Copy channel name', action: () => navigator.clipboard.writeText(c.name || 'Root') },
    ...manage
  ];
}

// Right-click menu for a user. Moderation entries are always offered; the server decides
// whether we may use them and answers with a permission denial otherwise.
export function userMenu(u: User): MenuItem[] {
  const self = session.self;
  const isSelf = u.session === self?.session;
  const items: MenuItem[] = [
    { header: true, label: store.displayName(u) },
    isSelf
      ? { label: 'Edit profile', action: () => { ui.profile = null; ui.profileEdit = true; } }
      : { label: 'View profile', action: () => openProfile(u.session, menu.last, menu.lastRow) },
    { label: session.selectedUsers.includes(u.session) ? 'Remove from selection' : 'Select person', disabled: session.movingUsers,
      action: () => session.toggleUser(u.session) }
  ];
  if (isSelf) {
    items.push(
      { label: 'Mute', checked: u.selfMute, action: () => session.setSelfMute(!u.selfMute) },
      { label: 'Deafen', checked: u.selfDeaf, action: () => session.setSelfDeaf(!u.selfDeaf) },
      { label: 'Change name...', action: () => changeNamePrompt(u) }
    );
    if (u.userId == null) items.push({ label: 'Register on this server', action: () => session.register(u.session) });
    items.push({ label: 'Use an access key...', action: accessKeyPrompt });
  } else {
    const sharing = session.sharing[u.session];
    if (sharing === 'camera') {
      // Cameras show by themselves; this is the per-person switch
      const hidden = share.isHidden(sessions.active, u.session) || !share.watchOf(u.session);
      items.push({ label: hidden ? 'Show camera' : 'Hide camera', action: () => share.hideCamera(sessions.active, u.session, !hidden) });
    } else if (sharing) items.push({ label: `Watch ${sharing}`, action: () => share.watch(sessions.active, u.session) });
    items.push(
      { label: 'Send message', action: () => session.selectView(`dm:${u.session}`) },
      { label: 'Poke...', action: () => pokePrompt(u) },
      { label: 'Mute for me', checked: !!voice.settings.localMutes[userKey(u)], action: () => voice.setLocalMute(u, !voice.settings.localMutes[userKey(u)]) },
      {
        label: 'Volume',
        slider: {
          value: voice.settings.userVolumes[userKey(u)] ?? 1, min: 0, max: 3, step: 0.05,
          format: v => `${Math.round(v * 100)}%`,
          oninput: v => voice.setUserVolume(u, v)
        }
      },
      { label: 'Set nickname...', action: () => nicknamePrompt(u) }
    );
    if (self && u.channelId !== self.channelId) {
      items.push({ label: 'Move to my channel', action: () => session.moveUser(u.session, self.channelId) });
    }
  }
  items.push(
    { separator: true, label: '' },
    { label: 'Server mute', checked: u.mute, action: () => session.setServerMute(u.session, !u.mute) },
    { label: 'Server deafen', checked: u.deaf, action: () => session.setServerDeaf(u.session, !u.deaf) },
    { label: 'Priority speaker', checked: u.prioritySpeaker, action: () => session.setPrioritySpeaker(u.session, !u.prioritySpeaker) }
  );
  if (!isSelf && u.userId == null) items.push({ label: 'Register user', action: () => session.register(u.session) });
  if (u.userId == null) items.push({ label: 'Roles', disabled: true, title: 'Only registered users can hold a role' });
  else if (u.userId !== 0) {
    items.push(session.can(0, PERM.Write) === false
      ? { label: 'Roles', disabled: true, title: 'Needs Write on the root channel' }
      : { label: 'Roles', submenu: roleSubmenu(u.userId) });
  }
  if (!isSelf) {
    items.push(
      { separator: true, label: '' },
      { label: 'Kick...', danger: true, action: () => (ui.prompt = { title: `Kick ${withAccount(u)}`, label: 'Reason (optional)', confirm: 'Kick', danger: true, onsubmit: r => session.kick(u.session, r) }) },
      { label: 'Ban...', danger: true, action: () => (ui.prompt = { title: `Ban ${withAccount(u)}`, label: 'Reason (optional)', confirm: 'Ban', danger: true, onsubmit: r => session.kick(u.session, r, true) }) }
    );
  }
  items.push({ separator: true, label: '' }, { label: 'Copy name', action: () => navigator.clipboard.writeText(store.displayName(u)) });
  if (u.hash) items.push({ label: 'Copy certificate hash', action: () => navigator.clipboard.writeText(u.hash) });
  items.push({ separator: true, label: '' }, { label: 'Information', action: () => (ui.userInfo = u.session) });
  return items;
}

// A key from a server admin; kept like a channel password and sent on every connect
function accessKeyPrompt(): void {
  ui.prompt = {
    title: 'Use an access key', label: 'Access key', confirm: 'Use key',
    onsubmit: key => { if (key.trim()) session.rememberChannelPassword(key.trim()); }
  };
}

// For decisions about a person: the account name cannot be chosen freely
function withAccount(u: User): string {
  const shown = store.displayName(u);
  return shown === u.name || shown.endsWith(`(${u.name})`) ? shown : `${shown} (${u.name})`;
}

export function changeNamePrompt(u: User): void {
  if (!session.canChooseName) {
    ui.prompt = {
      title: 'Change your name', label: '', confirm: 'Close', input: 'none',
      text: 'This server does not allow HTML, so it cannot keep a chosen name.',
      onsubmit: () => {}
    };
    return;
  }
  ui.prompt = {
    title: 'Change your name', label: 'Display name', confirm: 'Save', initial: u.chosenName || u.name, maxlength: MAX_DISPLAY_NAME,
    text: `Shown in mumh5. Your account stays ${u.name}, which other Mumble clients keep showing. Leave empty to use it.`,
    onsubmit: name => session.setDisplayName(name)
  };
}

export function pokePrompt(u: User): void {
  ui.prompt = {
    title: `Poke ${store.displayName(u)}`, label: 'Message (optional)', confirm: 'Poke', maxlength: POKE_MAX,
    text: 'Pops up for them in mumh5. Other Mumble clients show it as a private message.',
    onsubmit: note => session.poke(u.session, note)
  };
}

export function nicknamePrompt(u: User): void {
  ui.prompt = {
    title: `Nickname for ${withAccount(u)}`, label: 'Nickname (only you see it; empty to remove)', confirm: 'Save',
    initial: store.nicknames[userKey(u)] ?? '',
    onsubmit: nick => store.setNickname(userKey(u), nick)
  };
}
