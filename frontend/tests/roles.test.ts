import { test } from 'bun:test';
import assert from './assert.ts';
import { PERM, type AclEntry, type AclGroup, type ChannelAcl } from '../src/core/client.ts';
import { effectivePermissions, setCell, type AccessLevel } from '../src/core/access.ts';
import { stripMark } from '../src/core/text-signal.ts';
import { parseAdmins, withAdmins } from '../src/core/admins.ts';
import { accessKeys, addKey, canHaveKeys, createRole, deleteRole, docFromRoles, isRoleImage, newKeyCode, orderRoleRules, parseRoles, prepareRoles, refreshDoc, removeKey, roleMembers, rolesFromAcl, rolesOf, roleTarget, setMember, stripRoles, syncKeys, withRoles, type RoleDoc, type RoleInfo } from '../src/core/roles.ts';

const rule = (over: Partial<AclEntry>): AclEntry => ({ applyHere: true, applySubs: true, inherited: false, userId: null, group: 'all', grant: 0, deny: 0, ...over });
const group = (name: string, add: number[] = [], over: Partial<AclGroup> = {}): AclGroup =>
  ({ name, inherited: false, inherit: true, inheritable: true, add, remove: [], inheritedMembers: [], ...over });
const root = (acls: AclEntry[] = [], groups: AclGroup[] = [group('admin', [1])]): ChannelAcl => ({ channelId: 0, inheritAcls: true, groups, acls });
const role = (g: string, n: string, m: number[] = [], over: Partial<RoleInfo> = {}): RoleInfo => ({ g, n, c: '#6fb3ff', i: 'shield', s: true, m, ...over });
const doc = (...roles: RoleInfo[]): RoleDoc => ({ v: 1, roles });
const perms = (a: ChannelAcl, userId: number | null, tokens: string[] = []) => {
  const level: AccessLevel = { channelId: 0, name: 'Root', inheritAcls: true, rules: a.acls, groups: a.groups };
  return effectivePermissions([level], { userId, hash: 'h', channelId: 0, tokens, strong: false }, () => null);
};

test('role data survives in a description and stays out of what people read', () => {
  const d = doc(role('role.mod-a1b', 'Moderator', [3, 7]), role('admin', 'Chefs Ä', [1]));
  const text = withRoles('<p>Welcome</p>', d);
  assert.deepEqual(parseRoles(text), d);
  assert.equal(stripRoles(text), '<p>Welcome</p>');
  assert.equal(stripMark(text), '<p>Welcome</p>');
  assert.match(text, /width="0" height="0"\/>$/);
  assert.equal(withRoles(text, null), '<p>Welcome</p>');
  assert.deepEqual(parseRoles(withRoles(text, doc(role('x', 'New')))), doc(role('x', 'New')));
});

test('role data and the admin list do not disturb each other', () => {
  const d = doc(role('admin', 'Admin', [4]));
  let text = withRoles(withAdmins('<p>Hi</p>', [4]), d);
  const once = withRoles(withAdmins(text, parseAdmins(text)), parseRoles(text));
  assert.equal(once, text, 'writing them again changes nothing');
  text = withAdmins(text, [4, 9]);
  assert.deepEqual(parseAdmins(text), [4, 9]);
  assert.deepEqual(parseRoles(text), d);
  assert.equal(stripMark(text), '<p>Hi</p>');
});

test('role data from a server is checked', () => {
  const encode = (v: unknown) => `<img src="data:,mumh5roles:${Buffer.from(JSON.stringify(v)).toString('base64url')}" width="0" height="0"/>`;
  assert.equal(parseRoles('<img src="data:,mumh5roles:!!!"/>'), null);
  assert.equal(parseRoles(encode({ v: 2, roles: [] })), null);
  const parsed = parseRoles(encode({ v: 1, roles: [
    { g: 'ok', n: 'N'.repeat(99), c: 'red;background:url(x)', i: 'data:image/svg+xml;base64,AAAA', s: 'yes', m: [1, -2, 'x', 2.5] },
    { n: 'no group' }, 5, null
  ] }))!;
  assert.equal(parsed.roles.length, 1);
  const r = parsed.roles[0];
  assert.equal(r.n.length, 32);
  assert.equal(r.c, '');
  assert.equal(r.i, 'shield', 'an SVG or anything else is not used as a picture');
  assert.equal(r.s, false);
  assert.deepEqual(r.m, [1]);
  assert.ok(isRoleImage('data:image/png;base64,iVBORw0KGgo='));
  assert.ok(!isRoleImage('data:text/html;base64,AAAA'));
  assert.ok(!isRoleImage('data:image/png;base64,"onerror="x'));
  assert.ok(!isRoleImage(`data:image/png;base64,${'A'.repeat(3000)}`));
});

test('every root group is a role, with Admin first and the built-in ones last', () => {
  const a = root([rule({ group: 'admin', grant: PERM.Write }), rule({ group: 'mods', grant: PERM.Move }), rule({ group: 'vips', grant: PERM.Listen })],
    [group('admin', [1]), group('mods', [2]), group('vips', [3]), group('empty')]);
  assert.deepEqual(rolesFromAcl(a, null).map(r => r.g), ['admin', 'vips', 'mods', 'empty', 'auth', 'all']);
  const named = rolesFromAcl(a, doc(role('mods', 'Moderators'), role('gone', 'Deleted')));
  assert.deepEqual(named.map(r => r.g), ['mods', 'admin', 'vips', 'empty', 'auth', 'all']);
  assert.equal(named[0].n, 'Moderators');
  assert.deepEqual(named[0].m, [2], 'members come from the ACL, not from the old data');
  assert.equal(rolesFromAcl(a, null).find(r => r.g === 'all')!.n, 'Everyone');
});

test('creating, filling and deleting a role', () => {
  let a = root();
  const made = createRole(a, 'Event Höst!', 'k3f');
  assert.equal(made.group, 'role.event-ho-st-k3f');
  a = made.acl;
  assert.notEqual(createRole(a, 'Event Höst!', 'k3f').group, made.group, 'names stay unique');
  a = setMember(a, made.group, 5, true);
  a = setMember(a, made.group, 6, true);
  a = setMember(a, made.group, 5, false);
  assert.deepEqual(roleMembers(a, made.group), [6]);
  a = setCell(a, roleTarget(made.group), PERM.Move, 'allow');
  a = addKey(a, made.group, 'ABCD-EFGH-JKLM');
  a = deleteRole(a, made.group);
  assert.ok(!a.groups.some(g => g.name === made.group));
  assert.equal(a.acls.length, 0, 'its rules and keys go with it');
  assert.equal(deleteRole(root(), 'admin').groups.length, 1, 'Admin stays');
});

test('removing an inherited member excludes them', () => {
  const a = root([], [group('team', [], { inherited: true, inheritedMembers: [8] })]);
  const out = setMember(a, 'team', 8, false);
  assert.deepEqual(out.groups[0].remove, [8]);
  assert.deepEqual(roleMembers(out, 'team'), []);
  assert.deepEqual(roleMembers(setMember(out, 'team', 8, true), 'team'), [8]);
});

test('the higher role wins, and rules of no role keep their place', () => {
  const mine = rule({ userId: 9, group: null, grant: PERM.Ban });
  const low = rule({ group: 'low', deny: PERM.Move });
  const high = rule({ group: 'high', grant: PERM.Move });
  const a = root([high, mine, low], [group('low', [5]), group('high', [5])]);
  assert.ok(!(perms(a, 5) & PERM.Move), 'low is last, so it decides');
  const out = orderRoleRules(a, [role('high', 'High'), role('low', 'Low')]);
  assert.deepEqual(out.acls.map(r => r.group ?? r.userId), ['low', 9, 'high']);
  assert.ok(perms(out, 5) & PERM.Move);
  const back = orderRoleRules(out, [role('low', 'Low'), role('high', 'High')]);
  assert.ok(!(perms(back, 5) & PERM.Move));
});

test('role data follows changes made from elsewhere', () => {
  const d = doc(role('mods', 'Mods', [1, 2]), role('gone', 'Gone', [3]), role('all', 'Everyone'));
  const out = refreshDoc(d, root([], [group('mods', [2, 4])]));
  assert.deepEqual(out.roles.map(r => r.g), ['mods', 'all']);
  assert.deepEqual(out.roles[0].m, [2, 4]);
  assert.deepEqual(rolesOf(out, 4).map(r => r.g), ['mods']);
  assert.deepEqual(rolesOf(out, null), []);
  assert.deepEqual(rolesOf(null, 4), []);
});

test('an access key grants what its role has, to whoever holds it', () => {
  let a = root([], [group('mods', [])]);
  a = setCell(a, roleTarget('mods'), PERM.Move, 'allow');
  a = setCell(a, roleTarget('mods'), PERM.Speak, 'deny');
  a = addKey(a, 'mods', 'ABCD-EFGH-JKLM');
  const [key] = accessKeys(a);
  assert.deepEqual(key, { token: 'mk.ABCD-EFGH-JKLM.mods', code: 'ABCD-EFGH-JKLM', role: 'mods' });
  assert.ok(perms(a, null, [key.token]) & PERM.Move);
  assert.ok(perms(a, null, [key.token.toLowerCase()]) & PERM.Move, 'tokens ignore case');
  assert.ok(!(perms(a, null, [key.token]) & PERM.Speak));
  assert.ok(!(perms(a, null) & PERM.Move), 'nothing without the key');
  a = setCell(a, roleTarget('mods'), PERM.Kick, 'allow');
  a = syncKeys(a);
  assert.ok(perms(a, null, [key.token]) & PERM.Kick, 'it follows the role');
  a = removeKey(a, key.token);
  assert.equal(accessKeys(a).length, 0);
  assert.ok(!(perms(a, null, [key.token]) & PERM.Move));
});

test('Administrator cannot be handed out by key, even if added to the role later', () => {
  let a = root([rule({ group: 'admin', grant: PERM.Write })]);
  assert.ok(!canHaveKeys(a, 'admin'));
  assert.equal(addKey(a, 'admin', 'ABCD-EFGH-JKLM').acls.length, 1);
  assert.ok(!canHaveKeys(a, 'all'));
  a = { ...a, groups: [...a.groups, group('mods')] };
  a = addKey(setCell(a, roleTarget('mods'), PERM.Move, 'allow'), 'mods', 'ABCD-EFGH-JKLM');
  a = syncKeys(setCell(a, roleTarget('mods'), PERM.Write, 'allow'));
  const rule0 = a.acls.find(r => r.group?.startsWith('#mk.'))!;
  assert.equal(rule0.grant & PERM.Write, 0);
});

test('keys stay with their role when roles are reordered, and never reach the role data', () => {
  let a = root([], [group('low'), group('high')]);
  a = setCell(a, roleTarget('low'), PERM.Move, 'allow');
  a = setCell(a, roleTarget('high'), PERM.Move, 'deny');
  a = addKey(a, 'low', 'ABCD-EFGH-JKLM');
  const ordered = prepareRoles(a, [role('high', 'High'), role('low', 'Low')]);
  assert.deepEqual(ordered.acls.map(r => r.group), ['low', '#mk.ABCD-EFGH-JKLM.low', 'high']);
  const text = withRoles('', docFromRoles(rolesFromAcl(ordered, null)));
  assert.ok(!Buffer.from(text.split('mumh5roles:')[1].split('"')[0], 'base64url').toString().includes('ABCD-EFGH'));
});

test('key codes are readable and differ', () => {
  const a = newKeyCode();
  assert.match(a, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.notEqual(a, newKeyCode());
  assert.equal(newKeyCode(b => b.fill(0)), 'AAAA-AAAA-AAAA');
});
