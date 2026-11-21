// Who is an admin, for the badge. Murmur shows group membership only to people with Write, so
// mumh5 clients that have it publish the registered user ids in the root channel's description.
// Only Write holders can change that text, so a modified client cannot give itself the badge.
import { PERM, type AclGroup, type ChannelAcl } from './client.ts';

// An HTML comment: invisible in every client, and Murmur keeps it
const MARK = /<!--mumh5:admins:([\d,]*)-->/g;

export function parseAdmins(description: string): number[] {
  const ids: number[] = [];
  for (const m of description.matchAll(MARK)) {
    for (const part of m[1].split(',')) if (part) ids.push(Number(part));
  }
  return ids;
}

export const stripAdmins = (description: string) => description.replace(MARK, '');

export function withAdmins(description: string, ids: number[]): string {
  const rest = stripAdmins(description);
  return ids.length ? `${rest}<!--mumh5:admins:${ids.join(',')}-->` : rest;
}

const members = (g: AclGroup) => [...g.inheritedMembers, ...g.add].filter(id => !g.remove.includes(id));

// Registered users holding Write on the root channel, rules applied in order. SuperUser (id 0)
// is always an admin and needs no entry.
export function rootAdmins(acl: ChannelAcl): number[] {
  const groups = new Map(acl.groups.map(g => [g.name, members(g)]));
  const rules = acl.acls.filter(r => r.applyHere);
  const candidates = new Set<number>();
  for (const r of rules) {
    if (!(r.grant & PERM.Write)) continue;
    if (r.userId != null) candidates.add(r.userId);
    else for (const id of groups.get(r.group ?? '') ?? []) candidates.add(id);
  }
  const holdsWrite = (id: number) => {
    let write = false;
    for (const r of rules) {
      const applies = r.userId != null ? r.userId === id
        : r.group === 'all' || r.group === 'auth' || !!groups.get(r.group ?? '')?.includes(id);
      if (!applies) continue;
      if (r.grant & PERM.Write) write = true;
      if (r.deny & PERM.Write) write = false;
    }
    return write;
  };
  return [...candidates].filter(id => id !== 0 && holdsWrite(id)).sort((a, b) => a - b);
}
