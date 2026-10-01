import { session, sessions } from './session.svelte.ts';
import { share } from './share.svelte.ts';
import { ui } from './ui.svelte.ts';
import { store } from './settings.svelte.ts';
import { voice, userKey } from './audio/voice.svelte.ts';
import { sounds } from './audio/sounds.svelte.ts';
import type { MenuItem } from './menu.svelte.ts';
import { PERM, type Channel, type User } from '../core/client.ts';

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
    { label: 'Permissions...', disabled: no(PERM.Write), action: () => (ui.channelDialog = { mode: 'edit', id: c.id, tab: 'permissions' }) }
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
  return [
    { header: true, label: c.name || 'Root' },
    { label: here ? 'You are here' : 'Join channel', action: () => session.joinChannel(c.id), disabled: here || !c.canEnter },
    // Opens the channel's chat in the side panel, ready to type, without joining it
    { label: 'Send message to channel', action: () => { session.showChannel(c.id, 'chat'); ui.panelOpen = true; } },
    { label: 'Show description', action: () => { session.showChannel(c.id, 'info'); ui.panelOpen = true; } },
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
    { label: 'View profile', action: () => { session.showUser(u.session); ui.panelOpen = true; } }
  ];
  if (isSelf) {
    items.push(
      { label: 'Mute', checked: u.selfMute, action: () => session.setSelfMute(!u.selfMute) },
      { label: 'Deafen', checked: u.selfDeaf, action: () => session.setSelfDeaf(!u.selfDeaf) },
      { label: 'Change name...', action: () => changeNamePrompt(u) }
    );
    if (u.userId == null) items.push({ label: 'Register on this server', action: () => session.register(u.session) });
  } else {
    if (session.sharing[u.session]) items.push({ label: 'Watch screen', action: () => share.watch(sessions.active, u.session) });
    items.push(
      { label: 'Send message', action: () => session.selectView(`dm:${u.session}`) },
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
  if (!isSelf) {
    items.push(
      { separator: true, label: '' },
      { label: 'Kick...', danger: true, action: () => (ui.prompt = { title: `Kick ${u.name}`, label: 'Reason (optional)', confirm: 'Kick', danger: true, onsubmit: r => session.kick(u.session, r) }) },
      { label: 'Ban...', danger: true, action: () => (ui.prompt = { title: `Ban ${u.name}`, label: 'Reason (optional)', confirm: 'Ban', danger: true, onsubmit: r => session.kick(u.session, r, true) }) }
    );
  }
  items.push({ separator: true, label: '' }, { label: 'Copy name', action: () => navigator.clipboard.writeText(u.name) });
  if (u.hash) items.push({ label: 'Copy certificate hash', action: () => navigator.clipboard.writeText(u.hash) });
  items.push({ separator: true, label: '' }, { label: 'Information', action: () => (ui.userInfo = u.session) });
  return items;
}

export function changeNamePrompt(u: User): void {
  ui.prompt = {
    title: 'Change your name', label: 'New name', confirm: 'Reconnect with this name', initial: u.name,
    text: u.userId != null
      ? 'You are registered here, so the server keeps your registered name. The new name applies on servers where you are a guest.'
      : 'Mumble cannot rename you while connected, so mumh5 reconnects with the new name and remembers it for this server.',
    onsubmit: name => session.changeName(name)
  };
}

export function nicknamePrompt(u: User): void {
  ui.prompt = {
    title: `Nickname for ${u.name}`, label: 'Nickname (only you see it; empty to remove)', confirm: 'Save',
    initial: store.nicknames[userKey(u)] ?? '',
    onsubmit: nick => store.setNickname(userKey(u), nick)
  };
}

