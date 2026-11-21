import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PERM, type AclEntry, type AclGroup, type ChannelAcl } from '../src/core/client.ts';
import { withPassword, channelPassword } from '../src/core/channel-password.ts';
import { ADMIN_TARGET, accessTargets, adminsSilenced, applyPreset, cellValue, effectivePermissions, explain, inheritedValue, keepAdminVoice, presetOf, replacedByPreset, setCell, type AccessLevel, type Person } from '../src/core/access.ts';

const rule = (over: Partial<AclEntry>): AclEntry => ({ applyHere: true, applySubs: true, inherited: false, userId: null, group: 'all', grant: 0, deny: 0, ...over });
const group = (name: string, add: number[], over: Partial<AclGroup> = {}): AclGroup =>
  ({ name, inherited: false, inherit: true, inheritable: true, add, remove: [], inheritedMembers: [], ...over });
const level = (channelId: number, rules: AclEntry[] = [], groups: AclGroup[] = [], over: Partial<AccessLevel> = {}): AccessLevel =>
  ({ channelId, name: `ch${channelId}`, inheritAcls: true, rules, groups, ...over });
const person = (over: Partial<Person> = {}): Person => ({ userId: 5, hash: 'abc', channelId: 0, tokens: [], strong: false, ...over });
// root 0, child 1, grandchild 2
const parents = (id: number) => (id === 0 ? null : id - 1);
const can = (levels: AccessLevel[], p: Person, bit: number) => (effectivePermissions(levels, p, parents) & bit) !== 0;

test('without rules people get the defaults and nothing else', () => {
  const l = [level(0)];
  assert.ok(can(l, person(), PERM.Speak));
  assert.ok(!can(l, person(), PERM.Move));
  assert.ok(!can(l, person(), PERM.Write));
});

test('the later rule wins, also across channels', () => {
  const l = [
    level(0, [rule({ deny: PERM.Speak }), rule({ group: 'auth', grant: PERM.Speak })]),
    level(1, [rule({ group: 'auth', deny: PERM.Speak })])
  ];
  assert.ok(can(l.slice(0, 1), person(), PERM.Speak));
  assert.ok(!can(l.slice(0, 1), person({ userId: null }), PERM.Speak));
  assert.ok(!can(l, person(), PERM.Speak));
});

test('apply here and apply to subchannels are respected', () => {
  const onlySubs = [level(0, [rule({ applyHere: false, deny: PERM.Speak })]), level(1)];
  assert.ok(can(onlySubs.slice(0, 1), person(), PERM.Speak));
  assert.ok(!can(onlySubs, person(), PERM.Speak));
  const onlyHere = [level(0, [rule({ applySubs: false, deny: PERM.Speak })]), level(1)];
  assert.ok(!can(onlyHere.slice(0, 1), person(), PERM.Speak));
  assert.ok(can(onlyHere, person(), PERM.Speak));
});

test('a channel that does not inherit starts again from the defaults', () => {
  const l = [level(0, [rule({ deny: PERM.Speak })]), level(1, [], [], { inheritAcls: false })];
  assert.ok(can(l, person(), PERM.Speak));
});

test('Administrator restores most permissions, but not Speak or Whisper', () => {
  const l = [level(0, [rule({ grant: PERM.Write, deny: PERM.Speak | PERM.Whisper | PERM.Enter | PERM.Kick })])];
  assert.ok(can(l, person(), PERM.Enter));
  assert.ok(can(l, person(), PERM.Kick));
  assert.ok(!can(l, person(), PERM.Speak));
  assert.ok(!can(l, person(), PERM.Whisper));
  const e = explain(l, person(), PERM.Enter, parents);
  assert.equal(e.verdict, 'allowed');
  assert.ok(e.byAdministrator);
  assert.equal(explain(l, person(), PERM.Speak, parents).verdict, 'denied');
});

test('server permissions count only from root, and Administrator elsewhere does not grant them', () => {
  const l = [level(0), level(1, [rule({ grant: PERM.Write | PERM.Kick })])];
  assert.equal(explain(l, person(), PERM.Kick, parents).verdict, 'denied');
  const root = [level(0, [rule({ grant: PERM.Kick })]), level(1)];
  assert.equal(explain(root, person(), PERM.Kick, parents).verdict, 'allowed');
});

test('whoever may ban may also kick', () => {
  const l = [level(0, [rule({ grant: PERM.Ban })])];
  const e = explain(l, person(), PERM.Kick, parents);
  assert.equal(e.verdict, 'allowed');
  assert.ok(e.byBan);
});

test('no pass through on the way blocks everything below', () => {
  const l = [level(0, [rule({ deny: PERM.Traverse, applySubs: false })]), level(1, [rule({ grant: PERM.Speak })])];
  assert.equal(effectivePermissions(l, person(), parents), 0);
  const e = explain(l, person(), PERM.Speak, parents);
  assert.equal(e.verdict, 'denied');
  assert.equal(e.blockedAt, 'ch0');
});

test('group membership follows inherit, inheritable, add and remove', () => {
  const allow = rule({ group: 'team', grant: PERM.Move });
  const inherits = [level(0, [allow], [group('team', [5])]), level(1, [], [group('team', [])])];
  assert.ok(can(inherits, person(), PERM.Move));
  const removed = [level(0, [allow], [group('team', [5])]), level(1, [], [group('team', [], { remove: [5] })])];
  assert.ok(!can(removed, person(), PERM.Move));
  const cut = [level(0, [allow], [group('team', [5])]), level(1, [], [group('team', [], { inherit: false })])];
  assert.ok(!can(cut, person(), PERM.Move));
  const closed = [level(0, [allow], [group('team', [5], { inheritable: false })]), level(1)];
  assert.ok(!can(closed, person(), PERM.Move));
});

test('special groups and operators', () => {
  const has = (spec: string, p: Person, target = 1) => {
    const l = [level(0), level(1, [rule({ group: spec, grant: PERM.Move })]), level(2)].slice(0, target + 1);
    return can(l, p, PERM.Move);
  };
  assert.ok(has('in', person({ channelId: 1 })));
  assert.ok(!has('in', person({ channelId: 0 })));
  assert.ok(has('out', person({ channelId: 0 })));
  assert.ok(has('!auth', person({ userId: null })));
  assert.ok(!has('!auth', person()));
  assert.ok(has('$abc', person()));
  assert.ok(!has('$abd', person()));
  assert.ok(has('#Key', person({ tokens: ['kEy'] })), 'tokens ignore case');
  assert.ok(!has('none', person()));
  assert.ok(has('sub', person({ channelId: 2 })));
  assert.ok(!has('sub', person({ channelId: 1 })));
  // ~ reads the group where the rule is, not where the check happens
  assert.ok(has('~in', person({ channelId: 1 }), 2));
  assert.ok(!has('in', person({ channelId: 1 }), 2));
});

test('a token we cannot see makes the answer depend on it', () => {
  const l = [level(0, [rule({ deny: PERM.Enter }), rule({ group: '#secret', grant: PERM.Enter })])];
  const hidden = person({ tokens: undefined });
  const e = explain(l, hidden, PERM.Enter, parents);
  assert.equal(e.verdict, 'depends');
  assert.ok(e.steps.some(s => s.uncertain && s.rule.group === '#secret'));
  assert.equal(explain(l, person({ tokens: ['secret'] }), PERM.Enter, parents).verdict, 'allowed');
  assert.equal(explain(l, person({ tokens: [] }), PERM.Enter, parents).verdict, 'denied');
});

test('an unreadable parent is reported, and its group members still count', () => {
  const inherited = rule({ group: 'team', grant: PERM.Move, inherited: true });
  const l = [
    level(0, [{ ...inherited, inherited: false }], [], { partial: true }),
    level(1, [], [group('team', [], { inherited: true, inheritedMembers: [5] })])
  ];
  const e = explain(l, person(), PERM.Move, parents);
  assert.equal(e.verdict, 'allowed');
  assert.ok(e.incomplete);
  assert.equal(explain(l, person(), PERM.Kick, parents).verdict, 'depends');
});

test('SuperUser may do everything except Speak and Whisper', () => {
  const l = [level(0, [rule({ deny: PERM.Enter | PERM.Kick })])];
  const su = person({ userId: 0 });
  assert.equal(explain(l, su, PERM.Kick, parents).verdict, 'allowed');
  assert.equal(explain(l, su, PERM.Speak, parents).verdict, 'denied');
  assert.ok(explain(l, su, PERM.Enter, parents).superUser);
});

const acl = (acls: AclEntry[], groups: AclGroup[] = []): ChannelAcl => ({ channelId: 7, inheritAcls: true, groups, acls });
const all = { key: 'g:all', group: 'all', userId: null };
const auth = { key: 'g:auth', group: 'auth', userId: null };
const team = { key: 'g:team', group: 'team', userId: null };

test('the grid writes one rule per target and removes it when emptied', () => {
  const one = setCell(acl([]), team, PERM.Speak, 'allow');
  assert.equal(one.acls.length, 1);
  const two = setCell(one, team, PERM.Move, 'deny');
  assert.equal(two.acls.length, 1);
  assert.equal(cellValue(two, team, PERM.Speak), 'allow');
  assert.equal(cellValue(two, team, PERM.Move), 'deny');
  const flipped = setCell(two, team, PERM.Move, 'allow');
  assert.equal(flipped.acls[0].deny, 0);
  const gone = setCell(setCell(flipped, team, PERM.Move, null), team, PERM.Speak, null);
  assert.equal(gone.acls.length, 0);
});

test('broader audiences go first, so a narrower one can overrule them', () => {
  let a = setCell(acl([]), team, PERM.Enter, 'allow');
  a = setCell(a, auth, PERM.Enter, 'deny');
  a = setCell(a, all, PERM.Enter, 'deny');
  assert.deepEqual(a.acls.map(r => r.group), ['all', 'auth', 'team']);
});

test('the grid leaves inherited rules, subchannel-only rules and input alone', () => {
  const inherited = rule({ group: 'team', grant: PERM.Speak, inherited: true });
  const subsOnly = rule({ group: 'team', applyHere: false, deny: PERM.Speak });
  const input = acl([inherited, subsOnly]);
  const out = setCell(input, team, PERM.Speak, 'deny');
  assert.deepEqual(out.acls[0], inherited);
  assert.deepEqual(out.acls[1], subsOnly);
  assert.equal(out.acls.length, 3);
  assert.equal(input.acls.length, 2);
  assert.equal(inheritedValue(out, team, PERM.Speak), 'allow');
});

test('a channel password stays out of the grid and survives edits and presets', () => {
  const locked = withPassword(acl([rule({ group: 'team', grant: PERM.Move })]), 'secret');
  assert.ok(!accessTargets(locked).some(t => t.group === '#secret'));
  assert.equal(cellValue(locked, all, PERM.Enter), null, 'the password deny is not a grid value');
  const edited = setCell(locked, all, PERM.Speak, 'deny');
  assert.equal(channelPassword(edited), 'secret');
  assert.equal(edited.acls.findIndex(r => r.group === '#secret'), edited.acls.length - 1, 'new rules go before the password');
  const preset = applyPreset(locked, 'registered');
  assert.equal(channelPassword(preset), 'secret');
  assert.deepEqual(preset.acls.slice(-2).map(r => r.group), ['all', '#secret']);
  assert.equal(presetOf(preset), 'registered');
});

test('denying voice to a broad audience is noticed, and admins can be given it back', () => {
  const denied = setCell(acl([]), auth, PERM.Speak, 'deny');
  assert.deepEqual(adminsSilenced(denied), [PERM.Speak]);
  const kept = keepAdminVoice(denied, [PERM.Speak]);
  assert.deepEqual(adminsSilenced(kept), []);
  assert.deepEqual(kept.acls.map(r => r.group), ['auth', 'admin']);
  const levels = [level(0, kept.acls, [group('admin', [5])])];
  assert.ok(can(levels, person(), PERM.Speak), 'an admin speaks');
  assert.ok(!can(levels, person({ userId: 6 }), PERM.Speak), 'another registered user does not');
});

test('an explicit deny for admins, or an allow for the audience, is not a problem to report', () => {
  const denied = setCell(acl([]), all, PERM.Speak, 'deny');
  assert.deepEqual(adminsSilenced(setCell(denied, ADMIN_TARGET, PERM.Speak, 'deny')), []);
  assert.deepEqual(adminsSilenced(setCell(denied, auth, PERM.Speak, 'allow')), []);
  assert.deepEqual(adminsSilenced(acl([rule({ inherited: true, deny: PERM.Whisper })])), [PERM.Whisper]);
  assert.deepEqual(adminsSilenced(acl([rule({ inherited: true, deny: PERM.Speak }), rule({ inherited: true, group: 'admin', grant: PERM.Speak })])), []);
});

test('giving admins their voice back works when rules were ordered by hand', () => {
  const custom = acl([rule({ group: 'admin', grant: PERM.Move }), rule({ group: 'auth', deny: PERM.Speak })]);
  const kept = keepAdminVoice(custom, [PERM.Speak]);
  const levels = [level(0, kept.acls, [group('admin', [5])])];
  assert.ok(can(levels, person(), PERM.Speak));
  assert.ok(can(levels, person(), PERM.Move));
  assert.ok(!can(levels, person({ userId: 6 }), PERM.Speak));
});

test('a preset keeps the rules that make someone an admin', () => {
  const creator = rule({ userId: 9, group: null, applySubs: false, grant: PERM.Write | PERM.Traverse });
  const admins = rule({ group: 'admin', grant: PERM.Write });
  const custom = rule({ group: 'team', grant: PERM.Move });
  const a = acl([admins, creator, custom]);
  assert.equal(replacedByPreset(a, 'open'), 1);
  const open = applyPreset(a, 'open');
  assert.deepEqual(open.acls, [admins, creator]);
  assert.equal(presetOf(open), 'open');
  const stage = applyPreset(a, 'stage');
  assert.deepEqual(stage.acls.slice(0, 2), [admins, creator]);
  assert.equal(presetOf(stage), 'stage');
});

test('presets are recognized, count what they replace and keep inherited rules', () => {
  const inherited = rule({ group: 'admin', grant: PERM.Write, inherited: true });
  const custom = acl([inherited, rule({ group: 'team', grant: PERM.Move })]);
  assert.equal(presetOf(custom), null);
  assert.equal(replacedByPreset(custom, 'stage'), 1);
  const stage = applyPreset(custom, 'stage');
  assert.deepEqual(stage.acls[0], inherited);
  assert.equal(presetOf(stage), 'stage');
  assert.equal(replacedByPreset(stage, 'stage'), 0);
  assert.equal(presetOf(applyPreset(stage, 'open')), 'open');
});
