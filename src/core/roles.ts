// Roles on a stock server. A role is a group on the root channel and its rules there, so Murmur
// enforces it and desktop Mumble shows it as a normal group. Only what Murmur has no place for
// (name, color, icon, order) and who holds which role, which members cannot read from the ACL,
// is published in the root description, as an empty image that clients show as nothing. Only
// people with Write can change that text, so a badge cannot be forged.
import { PERM, type AclEntry, type AclGroup, type ChannelAcl } from './client.ts';
import { cellValue, type AccessTarget } from './access.ts';

export interface RoleInfo {
  g: string;      // group name on the root channel
  n: string;      // name shown
  c: string;      // color, #rrggbb, or empty
  i: string;      // a name from ROLE_ICONS, or a small image as a data URI
  s: boolean;     // show the icon next to names
  m: number[];    // registered user ids
}

export interface RoleDoc { v: 1; roles: RoleInfo[] }

export const ROLE_ICONS = ['crown', 'shield', 'star', 'gem', 'bolt', 'heart', 'note', 'flag', 'user', 'globe'];
export const ROLE_COLORS = ['#f0504a', '#ff9b52', '#e8b23c', '#3bd16f', '#4fd6c8', '#6fb3ff', '#b9a8ff', '#f28ad0', '#d0d2d8'];
export const MAX_ROLES = 40;
export const MAX_ROLE_NAME = 32;
// A 32 px picture; with 40 of them the role data still fits the default image limit
export const MAX_ICON_CHARS = 2400;

const BUILTIN = new Set(['all', 'auth']);
export const isBuiltinRole = (g: string) => BUILTIN.has(g);
// Admin is the group Murmur itself sets up: it can be renamed and restyled, but not removed
export const isFixedRole = (g: string) => isBuiltinRole(g) || g === 'admin';

const DEFAULTS: Record<string, Omit<RoleInfo, 'g' | 'm'>> = {
  admin: { n: 'Admin', c: '#f0504a', i: 'crown', s: true },
  auth: { n: 'Registered', c: '', i: 'user', s: false },
  all: { n: 'Everyone', c: '', i: 'globe', s: false }
};

// ─── In the root description ─────────────────────────────────────────────────

const MARK = /<img\b[^>]*\bsrc="data:,mumh5roles:([A-Za-z0-9_-]*)"[^>]*>/g;

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): string {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(binary, c => c.charCodeAt(0)));
}

export const isRoleColor = (c: unknown): c is string => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);

// Only raster pictures: this text comes from the server and ends up in an <img>
export const isRoleImage = (i: string) =>
  i.length <= MAX_ICON_CHARS && /^data:image\/(png|webp|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(i);

function cleanRole(raw: unknown): RoleInfo | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.g !== 'string' || !r.g || r.g.length > 80 || typeof r.n !== 'string') return null;
  const icon = typeof r.i === 'string' && (ROLE_ICONS.includes(r.i) || isRoleImage(r.i)) ? r.i : 'shield';
  const members = Array.isArray(r.m) ? r.m.filter((id): id is number => Number.isInteger(id) && id >= 0) : [];
  return { g: r.g, n: r.n.slice(0, MAX_ROLE_NAME), c: isRoleColor(r.c) ? r.c : '', i: icon, s: r.s === true, m: members };
}

export function parseRoles(description: string): RoleDoc | null {
  const found = [...description.matchAll(MARK)];
  if (!found.length) return null;
  try {
    const data = JSON.parse(fromBase64Url(found[found.length - 1][1]));
    if (data?.v !== 1 || !Array.isArray(data.roles)) return null;
    const roles = data.roles.slice(0, MAX_ROLES + BUILTIN.size).map(cleanRole).filter((r: RoleInfo | null): r is RoleInfo => !!r);
    return { v: 1, roles };
  } catch {
    return null;
  }
}

export const stripRoles = (description: string) => description.replace(MARK, '');

export function withRoles(description: string, doc: RoleDoc | null): string {
  const rest = stripRoles(description);
  if (!doc?.roles.length) return rest;
  return `${rest}<img src="data:,mumh5roles:${toBase64Url(JSON.stringify(doc))}" width="0" height="0"/>`;
}

// ─── Roles and the root rules ────────────────────────────────────────────────

export const roleTarget = (g: string): AccessTarget => ({ key: `g:${g}`, group: g, userId: null });

const groupMembers = (g: AclGroup) =>
  [...new Set([...(g.inherited && g.inherit ? g.inheritedMembers : []), ...g.add])].filter(id => !g.remove.includes(id));

export function roleMembers(acl: ChannelAcl, group: string): number[] {
  const g = acl.groups.find(x => x.name === group);
  return g ? groupMembers(g).sort((a, b) => a - b) : [];
}

// Group names made here look like role.moderator-k3f; a group from elsewhere keeps its own
function defaultName(group: string): string {
  const plain = group.replace(/^role\./, '').replace(/-[a-z0-9]{3,6}$/, '').replace(/[._-]+/g, ' ').trim() || group;
  return (plain[0].toUpperCase() + plain.slice(1)).slice(0, MAX_ROLE_NAME);
}

// Every group on root is a role, so existing servers need no conversion. Highest role first.
export function rolesFromAcl(acl: ChannelAcl, doc: RoleDoc | null): RoleInfo[] {
  const known = new Map((doc?.roles ?? []).map(r => [r.g, r]));
  const names = acl.groups.map(g => g.name).filter(g => !isBuiltinRole(g));
  const lastRule = (g: string) => acl.acls.map(r => !r.inherited && r.userId == null && r.group === g).lastIndexOf(true);
  const listed = (doc?.roles ?? []).map(r => r.g).filter(g => names.includes(g));
  const others = names.filter(g => !known.has(g))
    .sort((a, b) => Number(b === 'admin') - Number(a === 'admin') || lastRule(b) - lastRule(a) || a.localeCompare(b));
  const make = (g: string): RoleInfo => {
    const saved = known.get(g);
    const base = DEFAULTS[g] ?? { n: defaultName(g), c: '', i: 'shield', s: true };
    return { g, n: saved?.n ?? base.n, c: saved ? saved.c : base.c, i: saved?.i ?? base.i, s: saved?.s ?? base.s, m: isBuiltinRole(g) ? [] : roleMembers(acl, g) };
  };
  return [...listed, ...others, 'auth', 'all'].map(make);
}

export const docFromRoles = (roles: RoleInfo[]): RoleDoc => ({ v: 1, roles: roles.map(r => ({ ...r })) });

// After someone changed groups, for example from desktop Mumble
export function refreshDoc(doc: RoleDoc, acl: ChannelAcl): RoleDoc {
  return {
    v: 1,
    roles: doc.roles
      .filter(r => isBuiltinRole(r.g) || acl.groups.some(g => g.name === r.g))
      .map(r => ({ ...r, m: isBuiltinRole(r.g) ? [] : roleMembers(acl, r.g) }))
  };
}

export function createRole(acl: ChannelAcl, name: string, suffix: string): { acl: ChannelAcl; group: string } {
  const slug = name.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'role';
  let group = `role.${slug}-${suffix}`;
  for (let i = 2; acl.groups.some(g => g.name === group); i++) group = `role.${slug}-${suffix}${i}`;
  const entry: AclGroup = { name: group, inherited: false, inherit: true, inheritable: true, add: [], remove: [], inheritedMembers: [] };
  return { acl: { ...acl, groups: [...acl.groups, entry] }, group };
}

export function deleteRole(acl: ChannelAcl, group: string): ChannelAcl {
  if (isFixedRole(group)) return acl;
  return {
    ...acl,
    groups: acl.groups.filter(g => g.name !== group),
    acls: acl.acls.filter(r => r.inherited || r.userId != null || (r.group !== group && keyOf(r)?.role !== group))
  };
}

export function setMember(acl: ChannelAcl, group: string, userId: number, on: boolean): ChannelAcl {
  if (isBuiltinRole(group)) return acl;
  return {
    ...acl,
    groups: acl.groups.map(g => {
      if (g.name !== group) return g;
      const add = g.add.filter(id => id !== userId);
      const remove = g.remove.filter(id => id !== userId);
      if (on) add.push(userId);
      else if (g.inherited && g.inheritedMembers.includes(userId)) remove.push(userId);
      return { ...g, add, remove };
    })
  };
}

// Later rules win, so the highest role's rules go last. Rules that belong to no role keep their
// place: only the slots role rules already occupy are refilled.
export function orderRoleRules(acl: ChannelAcl, topFirst: RoleInfo[]): ChannelAcl {
  const rank = new Map(topFirst.map((r, i) => [r.g, topFirst.length - i]));
  const roleOf = (r: AclEntry) => (r.inherited || r.userId != null ? null : keyOf(r)?.role ?? r.group);
  const slots: number[] = [];
  acl.acls.forEach((r, i) => { const g = roleOf(r); if (g && rank.has(g)) slots.push(i); });
  const sorted = slots.map(i => acl.acls[i]).map((r, i) => ({ r, i })).sort((a, b) => {
    const byRank = rank.get(roleOf(a.r)!)! - rank.get(roleOf(b.r)!)!;
    return byRank || Number(!!keyOf(a.r)) - Number(!!keyOf(b.r)) || a.i - b.i;
  });
  const acls = acl.acls.map(r => ({ ...r }));
  slots.forEach((at, i) => { acls[at] = { ...sorted[i].r }; });
  return { ...acl, acls };
}

// ─── Access keys ─────────────────────────────────────────────────────────────

// A key is an access token that a rule on root grants a role's permissions to. It lives only in
// the ACL, which needs Write to read, and never in the published role data.
const KEY = /^#mk\.([A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4})\.(.+)$/;
const KEY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export interface AccessKey { token: string; code: string; role: string }

function keyOf(r: AclEntry): AccessKey | null {
  if (r.inherited || r.userId != null || !r.group) return null;
  const m = KEY.exec(r.group);
  return m ? { token: r.group.slice(1), code: m[1], role: m[2] } : null;
}

export const accessKeys = (acl: ChannelAcl): AccessKey[] =>
  acl.acls.flatMap(r => { const k = keyOf(r); return k ? [k] : []; });

export function newKeyCode(random: (bytes: Uint8Array<ArrayBuffer>) => Uint8Array = b => crypto.getRandomValues(b)): string {
  // 256 is a multiple of the 32 letters, so every letter is equally likely
  const letters = [...random(new Uint8Array(12))].map(b => KEY_ALPHABET[b % KEY_ALPHABET.length]);
  return [0, 4, 8].map(i => letters.slice(i, i + 4).join('')).join('-');
}

// Administrator cannot be handed out by key: anyone holding it could change every rule
export const canHaveKeys = (acl: ChannelAcl, group: string) =>
  !isBuiltinRole(group) && cellValue(acl, roleTarget(group), PERM.Write) !== 'allow';

const ALL_BITS = (Object.values(PERM) as number[]).filter(b => b !== PERM.Write);

// A key grants what its role has on root right now
export function syncKeys(acl: ChannelAcl): ChannelAcl {
  return {
    ...acl,
    acls: acl.acls.map(r => {
      const key = keyOf(r);
      if (!key) return r;
      const t = roleTarget(key.role);
      let grant = 0;
      let deny = 0;
      for (const bit of ALL_BITS) {
        const v = cellValue(acl, t, bit);
        if (v === 'allow') grant |= bit;
        if (v === 'deny') deny |= bit;
      }
      return { ...r, applyHere: true, applySubs: true, grant, deny };
    })
  };
}

export function addKey(acl: ChannelAcl, group: string, code: string): ChannelAcl {
  if (!canHaveKeys(acl, group)) return acl;
  const rule: AclEntry = { applyHere: true, applySubs: true, inherited: false, userId: null, group: `#mk.${code}.${group}`, grant: 0, deny: 0 };
  return syncKeys({ ...acl, acls: [...acl.acls, rule] });
}

export const removeKey = (acl: ChannelAcl, token: string): ChannelAcl =>
  ({ ...acl, acls: acl.acls.filter(r => r.inherited || keyOf(r)?.token !== token) });

// What goes to the server: rules in role order, keys matching their roles
export const prepareRoles = (acl: ChannelAcl, topFirst: RoleInfo[]) => syncKeys(orderRoleRules(acl, topFirst));

// ─── Showing them ────────────────────────────────────────────────────────────

// Pulled toward the text color, so a role color stays readable in every scheme
export const roleTint = (c: string): string | undefined =>
  isRoleColor(c) ? `color-mix(in srgb, ${c} 78%, var(--text))` : undefined;

export const rolesOf = (doc: RoleDoc | null, userId: number | null): RoleInfo[] =>
  userId == null || !doc ? [] : doc.roles.filter(r => r.m.includes(userId));
