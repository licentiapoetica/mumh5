import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PERM, type AclEntry, type ChannelAcl } from '../src/core/client.ts';
import { channelPassword, passwordProblem, withPassword } from '../src/core/channel-password.ts';
import { parseAdmins, rootAdmins, stripAdmins, withAdmins } from '../src/core/admins.ts';

const BITS = PERM.Enter | PERM.Speak | PERM.Whisper | PERM.TextMessage | PERM.LinkChannel | PERM.Traverse;
const rule = (over: Partial<AclEntry>): AclEntry => ({ applyHere: true, applySubs: true, inherited: false, userId: null, group: 'all', grant: 0, deny: 0, ...over });
const acl = (acls: AclEntry[] = [], groups: ChannelAcl['groups'] = []): ChannelAcl => ({ channelId: 5, inheritAcls: true, groups, acls });
const group = (name: string, add: number[], remove: number[] = [], inheritedMembers: number[] = []) =>
  ({ name, inherited: false, inherit: true, inheritable: true, add, remove, inheritedMembers });

test('a password is written as the desktop client writes it', () => {
  const own = rule({ group: 'friends', grant: PERM.Speak });
  const out = withPassword(acl([own]), 'secret');
  assert.deepEqual(out.acls[0], own);
  assert.deepEqual(out.acls[1], rule({ applySubs: false, deny: BITS }));
  assert.deepEqual(out.acls[2], rule({ applySubs: false, group: '#secret', grant: BITS }));
  assert.equal(channelPassword(out), 'secret');
});

test('changing a password keeps one pair of rules, removing it leaves other rules alone', () => {
  const own = rule({ group: 'friends', grant: PERM.Speak });
  const changed = withPassword(withPassword(acl([own]), 'one'), 'two');
  assert.equal(changed.acls.length, 3);
  assert.equal(channelPassword(changed), 'two');
  assert.deepEqual(withPassword(changed, '').acls, [own]);
});

test('passwords set by older desktop clients are recognized and removed', () => {
  const old = BITS & ~PERM.Traverse;
  const a = acl([rule({ applySubs: false, deny: old }), rule({ applySubs: false, group: '#legacy', grant: old })]);
  assert.equal(channelPassword(a), 'legacy');
  assert.deepEqual(withPassword(a, '').acls, []);
});

test('rules that only look like a password are not one', () => {
  assert.equal(channelPassword(acl([rule({ group: '#token', grant: PERM.Enter })])), '');
  assert.equal(channelPassword(acl([rule({ group: '#token', grant: BITS, inherited: true })])), '');
  assert.equal(channelPassword(acl([rule({ group: '#token', grant: BITS, deny: PERM.Move })])), '');
  const custom = rule({ deny: PERM.Enter });
  assert.deepEqual(withPassword(acl([custom]), '').acls, [custom]);
});

test('passwords Murmur would read as operators are refused', () => {
  for (const p of ['!open', '~x', '#x', '$x']) assert.ok(passwordProblem(p), p);
  for (const p of ['open', 'a!b', 'with space', '']) assert.equal(passwordProblem(p), null, p);
});

test('the admin list survives in a description and stays out of what people read', () => {
  const text = '<p>Welcome</p>';
  const marked = withAdmins(text, [3, 7]);
  assert.deepEqual(parseAdmins(marked), [3, 7]);
  assert.equal(stripAdmins(marked), text);
  assert.deepEqual(parseAdmins(withAdmins(marked, [9])), [9]);
  assert.equal(withAdmins(marked, []), text);
  assert.deepEqual(parseAdmins(text), []);
});

test('admins are the people holding Write on root, rules in order', () => {
  const a = acl([
    rule({ group: 'admin', grant: PERM.Write }),
    rule({ userId: 12, group: null, grant: PERM.Write }),
    rule({ userId: 4, group: null, deny: PERM.Write }),
    rule({ group: 'auth', grant: PERM.MakeTempChannel })
  ], [group('admin', [4, 3, 0], [8], [8, 5])]);
  assert.deepEqual(rootAdmins(a), [3, 5, 12]);
});

test('a rule that does not apply on root makes nobody an admin', () => {
  const a = acl([rule({ group: 'admin', grant: PERM.Write, applyHere: false })], [group('admin', [3])]);
  assert.deepEqual(rootAdmins(a), []);
});
