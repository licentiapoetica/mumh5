// Readable channel access on top of Mumble's rules: what each permission means, what a person
// may do and why, and the grid and presets of the Access tab. The evaluation follows Murmur's
// ChanACL::effectivePermissions and Group::appliesToUser; a server test compares it with real answers.
import { PERM, type AclEntry, type AclGroup, type ChannelAcl } from './client.ts';
import { isPasswordRule } from './channel-password.ts';

export const ROOT_ONLY = PERM.Kick | PERM.Ban | PERM.ResetUserContent | PERM.Register | PERM.SelfRegister;
const DEFAULT = PERM.Traverse | PERM.Enter | PERM.Speak | PERM.Whisper | PERM.TextMessage | PERM.Listen;
const ALL = Object.values(PERM).reduce((a, b) => a | b, 0);
// Write brings these back after every deny. Speak and Whisper are not among them.
const WRITE_IMPLIES = PERM.Traverse | PERM.Enter | PERM.MuteDeafen | PERM.Move | PERM.MakeChannel
  | PERM.LinkChannel | PERM.TextMessage | PERM.MakeTempChannel | PERM.Listen;

export interface PermissionInfo { bit: number; name: string; help: string; rootOnly?: boolean }

export const PERMISSION_GROUPS: { name: string; items: PermissionInfo[] }[] = [
  { name: 'Voice and chat', items: [
    { bit: PERM.Traverse, name: 'Pass through', help: 'Reach this channel and its subchannels. Without it, nothing below works either.' },
    { bit: PERM.Enter, name: 'Join', help: 'Join this channel.' },
    { bit: PERM.Speak, name: 'Speak', help: 'Talk in this channel. Administrator does not include this.' },
    { bit: PERM.Whisper, name: 'Whisper', help: 'Whisper to this channel from outside. Administrator does not include this.' },
    { bit: PERM.TextMessage, name: 'Message', help: 'Send text messages to this channel.' },
    { bit: PERM.Listen, name: 'Listen', help: 'Listen to this channel without joining it.' }
  ] },
  { name: 'Moderation', items: [
    { bit: PERM.MuteDeafen, name: 'Mute others', help: 'Mute and deafen people in this channel.' },
    { bit: PERM.Move, name: 'Move people', help: 'Move people out of this channel, or into it.' },
    { bit: PERM.Kick, name: 'Kick', help: 'Kick people from the server. Only rules on the root channel count.', rootOnly: true },
    { bit: PERM.Ban, name: 'Ban', help: 'Ban people from the server. Only rules on the root channel count.', rootOnly: true },
    { bit: PERM.ResetUserContent, name: 'Remove content', help: 'Remove the comments and pictures of others. Only rules on the root channel count.', rootOnly: true }
  ] },
  { name: 'Channels', items: [
    { bit: PERM.MakeChannel, name: 'Create', help: 'Create permanent subchannels.' },
    { bit: PERM.MakeTempChannel, name: 'Create temporary', help: 'Create subchannels that disappear when empty.' },
    { bit: PERM.LinkChannel, name: 'Link', help: 'Link this channel to others.' }
  ] },
  { name: 'Server', items: [
    { bit: PERM.Register, name: 'Register others', help: 'Register other people on the server. Only rules on the root channel count.', rootOnly: true },
    { bit: PERM.SelfRegister, name: 'Register self', help: 'Register themselves on the server. Only rules on the root channel count.', rootOnly: true },
    { bit: PERM.Write, name: 'Administrator', help: 'Change this channel, its rules and groups. Overrides most denies, but not Speak or Whisper.' }
  ] }
];

// ─── Evaluation ──────────────────────────────────────────────────────────────

// One channel on the path from the root, with its own rules and groups. partial: stands in for
// parents we may not read, built from the inherited rules the server sent for the channel.
export interface AccessLevel {
  channelId: number;
  name: string;
  inheritAcls: boolean;
  rules: AclEntry[];
  groups: AclGroup[];
  partial?: boolean;
}

export interface Person {
  userId: number | null;
  hash: string;
  channelId: number;
  // Who sent which access tokens is known only for yourself
  tokens?: string[];
  // Whether a certificate is CA-verified is not told to other clients
  strong?: boolean;
}

export type Parents = (id: number) => number | null | undefined;

function pathTo(id: number, parents: Parents): number[] {
  const path: number[] = [];
  const seen = new Set<number>();
  for (let c: number | null | undefined = id; c != null && !seen.has(c); c = parents(c)) {
    seen.add(c);
    path.unshift(c);
  }
  return path;
}

interface Spec { invert: boolean; acl: boolean; token: boolean; cert: boolean; name: string }

function parseSpec(raw: string): Spec {
  const s: Spec = { invert: false, acl: false, token: false, cert: false, name: raw };
  for (;;) {
    const c = s.name[0];
    if (c === '!') s.invert = true;
    else if (c === '~') s.acl = true;
    else if (c === '#') s.token = true;
    else if (c === '$') s.cert = true;
    else return s;
    s.name = s.name.slice(1);
  }
}

// What other clients cannot see about a person, as a key for the combinations tried in explain
function unknownKey(s: Spec, p: Person): string | null {
  if (s.token) return p.tokens ? null : `#${s.name.toLowerCase()}`;
  return !s.cert && s.name === 'strong' && p.strong == null ? 'strong' : null;
}

interface Context { levels: AccessLevel[]; person: Person; parents: Parents; target: number; assume: Map<string, boolean> }

function inGroup(name: string, contextId: number, c: Context): boolean {
  const id = c.person.userId;
  if (id == null) return false;
  const path = pathTo(contextId, c.parents);
  const chain: AclGroup[] = [];
  let member = false;
  for (let i = path.length - 1; i >= 0; i--) {
    const level = c.levels.find(l => l.channelId === path[i]);
    if (!level || level.partial) {
      // A parent we may not read: the server listed its members with the group below it
      const lowest = chain[chain.length - 1];
      member = !!lowest?.inherited && lowest.inheritedMembers.includes(id);
      break;
    }
    const group = level.groups.find(g => g.name === name);
    if (!group) continue;
    if (path[i] !== contextId && !group.inheritable) break;
    chain.push(group);
    if (!group.inherit) break;
  }
  for (const g of chain.reverse()) {
    if (g.add.includes(id)) member = true;
    if (g.remove.includes(id)) member = false;
  }
  return member;
}

// QString::toInt: anything that is not a whole number is 0
const toInt = (v: string) => (/^\s*[+-]?\d+\s*$/.test(v) ? parseInt(v, 10) : 0);

function inSub(args: string, contextId: number, c: Context): boolean {
  const parts = args.split(',');
  const offset = parts[0] ? toInt(parts[0]) : 0;
  const min = parts.length >= 2 && parts[1] ? toInt(parts[1]) : 1;
  const max = parts.length >= 3 && parts[2] ? toInt(parts[2]) : 1000;
  const home = pathTo(c.person.channelId, c.parents);
  const current = pathTo(c.target, c.parents);
  let index = current.indexOf(contextId) + offset;
  if (index >= current.length) return false;
  if (index < 0) index = 0;
  if (!home.includes(current[index])) return false;
  const depth = home.length - 1;
  return depth >= index + min && depth <= index + max;
}

function matchesGroup(raw: string, levelId: number, c: Context): boolean {
  const s = parseSpec(raw);
  if (!s.name) return false;
  const contextId = s.acl ? levelId : c.target;
  const p = c.person;
  const key = unknownKey(s, p);
  let hit: boolean;
  if (key) hit = !!c.assume.get(key);
  else if (s.token) hit = !!p.tokens?.some(t => t.toLowerCase() === s.name.toLowerCase());
  else if (s.cert) hit = p.hash === s.name;
  else if (s.name === 'none') hit = false;
  else if (s.name === 'all') hit = true;
  else if (s.name === 'auth') hit = p.userId != null;
  else if (s.name === 'strong') hit = !!p.strong;
  else if (s.name === 'in') hit = p.channelId === contextId;
  else if (s.name === 'out') hit = p.channelId !== contextId;
  else if (s.name === 'sub' || s.name.startsWith('sub,')) hit = inSub(s.name.slice(4), contextId, c);
  else hit = inGroup(s.name, contextId, c);
  return s.invert ? !hit : hit;
}

const applies = (r: AclEntry, levelId: number, c: Context) =>
  (r.userId != null && r.userId === c.person.userId) || (r.userId == null && matchesGroup(r.group ?? '', levelId, c));

export interface AccessStep {
  channel: string;
  rule: AclEntry;
  effect: 'allow' | 'deny';
  // The last rule that set the outcome
  decides: boolean;
  // Applies only if the person has a token or certificate we cannot see
  uncertain: boolean;
}

interface Run { bits: number; blockedAt: string | null; steps: AccessStep[]; restored: boolean }

function evaluate(c: Context, bit: number): Run {
  let granted = DEFAULT;
  let traverse = true;
  let write = false;
  let blockedAt: string | null = null;
  let steps: AccessStep[] = [];
  for (const level of c.levels) {
    if (!level.inheritAcls) { granted = DEFAULT; steps = []; }
    const here = level.channelId === c.target;
    for (const r of level.rules) {
      if (!applies(r, level.channelId, c)) continue;
      if (r.grant & PERM.Traverse) traverse = true;
      if (r.deny & PERM.Traverse) traverse = false;
      if (r.grant & PERM.Write) write = true;
      if (r.deny & PERM.Write) write = false;
      const rootGrant = level.channelId === 0 && here && r.applyHere;
      if (rootGrant) granted |= r.grant & ROOT_ONLY;
      const counts = (here && r.applyHere) || (!here && r.applySubs);
      if (counts) {
        granted |= r.grant & ~ROOT_ONLY;
        granted &= ~r.deny;
      }
      const grants = (r.grant & bit) !== 0 && (bit & ROOT_ONLY ? rootGrant : counts);
      const denies = counts && (r.deny & bit) !== 0;
      if (grants || denies) steps.push({ channel: level.name, rule: r, effect: denies ? 'deny' : 'allow', decides: false, uncertain: false });
    }
    if (!traverse && !write) {
      granted = 0;
      blockedAt = level.name;
      break;
    }
  }
  const before = granted;
  if (granted & PERM.Write) {
    granted |= WRITE_IMPLIES;
    if (c.target === 0) granted |= ROOT_ONLY;
  }
  return { bits: granted, blockedAt, steps, restored: !(before & bit) && (granted & bit) !== 0 };
}

const ownRules = (levels: AccessLevel[]) =>
  levels.map(l => ({ ...l, rules: l.partial ? l.rules : l.rules.filter(r => !r.inherited) }));

// The exact permission bits for someone whose tokens and certificate status are known
export function effectivePermissions(levels: AccessLevel[], person: Person, parents: Parents): number {
  if (person.userId === 0) return ALL & ~(PERM.Speak | PERM.Whisper);
  const own = ownRules(levels);
  return evaluate({ levels: own, person, parents, target: own[own.length - 1].channelId, assume: new Map() }, 0).bits;
}

// More unknown tokens than this: do not try every combination, say it depends
const MAX_UNKNOWNS = 8;

export type Verdict = 'allowed' | 'denied' | 'depends';

export interface Explanation {
  verdict: Verdict;
  // Channel on the way that this person may not pass through
  blockedAt: string | null;
  // Administrator put back what the rules denied
  byAdministrator: boolean;
  // Murmur lets anyone who may ban also kick
  byBan: boolean;
  superUser: boolean;
  // Parent channels could not be read, so the answer may be incomplete
  incomplete: boolean;
  steps: AccessStep[];
}

export function explain(levels: AccessLevel[], person: Person, bit: number, parents: Parents): Explanation {
  const incomplete = levels.some(l => l.partial);
  const result = (verdict: Verdict, more: Partial<Explanation> = {}): Explanation =>
    ({ verdict, blockedAt: null, byAdministrator: false, byBan: false, superUser: false, incomplete, steps: [], ...more });
  if (person.userId === 0) return result(bit & (PERM.Speak | PERM.Whisper) ? 'denied' : 'allowed', { superUser: true, incomplete: false });

  let own = ownRules(levels);
  // Murmur checks these against the root channel, wherever the person is
  if (bit & ROOT_ONLY) {
    if (own[0].channelId !== 0 || own[0].partial) return result('depends');
    own = own.slice(0, 1);
  }
  const target = own[own.length - 1].channelId;
  const keys = [...new Set(own.flatMap(l => l.rules.flatMap(r => {
    if (r.userId != null || !r.group) return [];
    const key = unknownKey(parseSpec(r.group), person);
    return key ? [key] : [];
  })))];
  if (keys.length > MAX_UNKNOWNS) return result('depends');

  const runs: Run[] = [];
  for (let mask = 0; mask < 1 << keys.length; mask++) {
    const assume = new Map(keys.map((k, i) => [k, (mask & (1 << i)) !== 0]));
    runs.push(evaluate({ levels: own, person, parents, target, assume }, bit));
  }
  const wanted = bit === PERM.Kick ? PERM.Kick | PERM.Ban : bit;
  const yes = runs.filter(r => r.bits & wanted).length;
  const verdict: Verdict = yes === runs.length ? 'allowed' : yes === 0 ? 'denied' : 'depends';
  // The first run assumes no hidden token or certificate
  const base = runs[0];
  const steps = base.steps.map(s => ({ ...s }));
  if (verdict !== 'depends' && steps.length && !base.restored && !base.blockedAt) steps[steps.length - 1].decides = true;
  const listed = new Set(steps.map(s => s.rule));
  for (const r of runs) {
    for (const s of r.steps) {
      if (!listed.has(s.rule)) { listed.add(s.rule); steps.push({ ...s, uncertain: true }); }
    }
  }
  return result(verdict, {
    blockedAt: verdict === 'denied' ? base.blockedAt : null,
    byAdministrator: verdict === 'allowed' && base.restored,
    byBan: verdict === 'allowed' && bit === PERM.Kick && !(base.bits & PERM.Kick),
    steps
  });
}

// ─── Grid ────────────────────────────────────────────────────────────────────

export type Cell = 'allow' | 'deny' | null;

export interface AccessTarget { key: string; group: string | null; userId: number | null }

const targetKey = (r: { group: string | null; userId: number | null }) =>
  r.userId != null ? `u:${r.userId}` : `g:${r.group ?? 'all'}`;
const sameTarget = (r: AclEntry, t: AccessTarget) => targetKey(r) === t.key;

// The two rules of a channel password belong to the password field, not the grid
function passwordRules(acl: ChannelAcl): Set<AclEntry> {
  const out = new Set<AclEntry>();
  const grant = acl.acls.map(r => isPasswordRule(r) === 'grant').lastIndexOf(true);
  if (grant < 0) return out;
  out.add(acl.acls[grant]);
  const deny = acl.acls.map(r => isPasswordRule(r) === 'deny').lastIndexOf(true);
  if (deny >= 0) out.add(acl.acls[deny]);
  return out;
}

export function accessTargets(acl: ChannelAcl): AccessTarget[] {
  const list: AccessTarget[] = [{ key: 'g:all', group: 'all', userId: null }, { key: 'g:auth', group: 'auth', userId: null }];
  const seen = new Set(list.map(t => t.key));
  const add = (group: string | null, userId: number | null) => {
    const key = targetKey({ group, userId });
    if (!seen.has(key)) { seen.add(key); list.push({ key, group, userId }); }
  };
  const passwords = passwordRules(acl);
  for (const r of acl.acls) if (!r.inherited && !passwords.has(r)) add(r.userId != null ? null : r.group, r.userId);
  for (const g of acl.groups) add(g.name, null);
  return list;
}

// The channel's own setting: the last of its rules for this target that mentions the permission
export function cellValue(acl: ChannelAcl, t: AccessTarget, bit: number): Cell {
  const passwords = passwordRules(acl);
  let value: Cell = null;
  for (const r of acl.acls) {
    if (r.inherited || !r.applyHere || passwords.has(r) || !sameTarget(r, t)) continue;
    if (r.grant & bit) value = 'allow';
    if (r.deny & bit) value = 'deny';
  }
  return value;
}

// What parent channels say for this same target
export function inheritedValue(acl: ChannelAcl, t: AccessTarget, bit: number): Cell {
  if (!acl.inheritAcls) return null;
  let value: Cell = null;
  for (const r of acl.acls) {
    if (!r.inherited || !r.applySubs || !sameTarget(r, t)) continue;
    if (r.grant & bit) value = 'allow';
    if (r.deny & bit) value = 'deny';
  }
  return value;
}

// Broader audiences go first, so that a narrower one can overrule them
const rank = (group: string | null, userId: number | null) =>
  userId != null ? 3 : group === 'all' ? 0 : group === 'auth' ? 1 : 2;

export function setCell(acl: ChannelAcl, t: AccessTarget, bit: number, value: Cell): ChannelAcl {
  const passwords = passwordRules(acl);
  const items = acl.acls.map(r => ({
    rule: { ...r },
    password: passwords.has(r),
    mine: !r.inherited && !passwords.has(r) && r.applyHere && sameTarget(r, t),
    touched: false
  }));
  const mine = items.filter(i => i.mine);
  for (const i of mine) {
    if ((i.rule.grant | i.rule.deny) & bit) i.touched = true;
    i.rule.grant &= ~bit;
    i.rule.deny &= ~bit;
  }
  if (value && mine.length) {
    const last = mine[mine.length - 1];
    if (value === 'allow') last.rule.grant |= bit; else last.rule.deny |= bit;
  } else if (value) {
    const rule: AclEntry = { applyHere: true, applySubs: true, inherited: false, userId: t.userId, group: t.userId != null ? null : t.group,
      grant: value === 'allow' ? bit : 0, deny: value === 'deny' ? bit : 0 };
    const before = items.findIndex(i => !i.rule.inherited && (i.password || rank(i.rule.group, i.rule.userId) > rank(t.group, t.userId)));
    items.splice(before < 0 ? items.length : before, 0, { rule, password: false, mine: true, touched: false });
  }
  // A rule this edit emptied says nothing any more
  return { ...acl, acls: items.filter(i => !(i.touched && !i.rule.grant && !i.rule.deny)).map(i => i.rule) };
}

// ─── Admin voice ─────────────────────────────────────────────────────────────

// Administrator does not include Speak or Whisper, so denying them to a broad audience silences
// admins as well unless @admin is allowed them explicitly
export const VOICE_BITS: number[] = [PERM.Speak, PERM.Whisper];
export const ADMIN_TARGET: AccessTarget = { key: 'g:admin', group: 'admin', userId: null };
const ALL_TARGET: AccessTarget = { key: 'g:all', group: 'all', userId: null };
const AUTH_TARGET: AccessTarget = { key: 'g:auth', group: 'auth', userId: null };

export const isBroadTarget = (t: AccessTarget) => t.key === ALL_TARGET.key || t.key === AUTH_TARGET.key;
export const broadDenies = (acl: ChannelAcl, bit: number) =>
  cellValue(acl, ALL_TARGET, bit) === 'deny' || cellValue(acl, AUTH_TARGET, bit) === 'deny';

export function adminsSilenced(acl: ChannelAcl): number[] {
  return VOICE_BITS.filter(bit => {
    if (cellValue(acl, ADMIN_TARGET, bit)) return false;
    const here = cellValue(acl, AUTH_TARGET, bit) ?? cellValue(acl, ALL_TARGET, bit);
    if (here) return here === 'deny';
    const up = inheritedValue(acl, AUTH_TARGET, bit) ?? inheritedValue(acl, ALL_TARGET, bit);
    return up === 'deny' && inheritedValue(acl, ADMIN_TARGET, bit) !== 'allow';
  });
}

export function keepAdminVoice(acl: ChannelAcl, bits: number[]): ChannelAcl {
  let out = acl;
  for (const bit of bits) {
    out = setCell(out, ADMIN_TARGET, bit, 'allow');
    const passwords = passwordRules(out);
    const own = (r: AclEntry) => !r.inherited && r.applyHere && !passwords.has(r);
    const lastDeny = out.acls.map(r => own(r) && (sameTarget(r, ALL_TARGET) || sameTarget(r, AUTH_TARGET)) && (r.deny & bit) !== 0).lastIndexOf(true);
    const lastAllow = out.acls.map(r => own(r) && sameTarget(r, ADMIN_TARGET) && (r.grant & bit) !== 0).lastIndexOf(true);
    // Rules ordered by hand can put the deny after @admin; the allow has to come later to count
    if (lastDeny > lastAllow) {
      const acls = out.acls.map(r => ({ ...r }));
      acls.splice(lastDeny + 1, 0, { applyHere: true, applySubs: true, inherited: false, userId: null, group: 'admin', grant: bit, deny: 0 });
      out = { ...out, acls };
    }
  }
  return out;
}

// ─── Presets ─────────────────────────────────────────────────────────────────

export interface AccessPreset {
  id: string;
  name: string;
  help: string;
  rules: { group: string; grant: number; deny: number }[];
}

export const ACCESS_PRESETS: AccessPreset[] = [
  { id: 'open', name: 'Open', help: 'No rules of its own', rules: [] },
  { id: 'registered', name: 'Registered only', help: 'Guests cannot join', rules: [
    { group: 'all', grant: 0, deny: PERM.Enter },
    { group: 'auth', grant: PERM.Enter, deny: 0 }
  ] },
  { id: 'stage', name: 'Stage', help: 'Only @admin can speak', rules: [
    { group: 'all', grant: 0, deny: PERM.Speak },
    { group: 'admin', grant: PERM.Speak, deny: 0 }
  ] },
  { id: 'quiet', name: 'Quiet', help: 'People can join, nobody can speak', rules: [
    { group: 'all', grant: 0, deny: PERM.Speak }
  ] },
  { id: 'admins', name: 'Admins only', help: 'Only @admin can join', rules: [
    { group: 'all', grant: 0, deny: PERM.Enter },
    { group: 'admin', grant: PERM.Enter, deny: 0 }
  ] }
];

// A preset never takes away who runs the channel, such as the rule Murmur gives its creator
const grantsAdmin = (r: AclEntry) => (r.grant & PERM.Write) !== 0;

const gridRules = (acl: ChannelAcl) => {
  const passwords = passwordRules(acl);
  return acl.acls.filter(r => !r.inherited && !passwords.has(r) && !grantsAdmin(r));
};

export function presetOf(acl: ChannelAcl): string | null {
  const own = gridRules(acl);
  return ACCESS_PRESETS.find(p => p.rules.length === own.length && p.rules.every((w, i) => {
    const r = own[i];
    return r.userId == null && r.group === w.group && r.grant === w.grant && r.deny === w.deny && r.applyHere && r.applySubs;
  }))?.id ?? null;
}

// How many of the channel's own rules a preset would replace
export const replacedByPreset = (acl: ChannelAcl, id: string) => (presetOf(acl) === id ? 0 : gridRules(acl).length);

// Replaces the channel's own rules. Its password stays, and stays last so that it still applies.
export function applyPreset(acl: ChannelAcl, id: string): ChannelAcl {
  const preset = ACCESS_PRESETS.find(p => p.id === id);
  if (!preset) return acl;
  const passwords = passwordRules(acl);
  const rules: AclEntry[] = preset.rules.map(r => ({ applyHere: true, applySubs: true, inherited: false, userId: null, group: r.group, grant: r.grant, deny: r.deny }));
  return {
    ...acl,
    acls: [
      ...acl.acls.filter(r => r.inherited || (!passwords.has(r) && grantsAdmin(r))).map(r => ({ ...r })),
      ...rules,
      ...acl.acls.filter(r => passwords.has(r)).map(r => ({ ...r }))
    ]
  };
}
