// A name people choose freely. Murmur cannot rename a connected user and ties registered names to
// the certificate, so the account name stays and the chosen one is published in the user's comment,
// as an empty image that other clients show as nothing. Only its owner can write that comment.
import { fromBase64Url, toBase64Url } from './base64url.ts';

export const MAX_DISPLAY_NAME = 32;

const ONE = /<img\b[^>]*\bsrc="data:,mumh5name:([A-Za-z0-9_-]{1,256})"[^>]*>/;
const ALL = new RegExp(ONE.source, 'g');

// Invisible characters would allow blank names or two names that look the same
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}⠀]/gu;

export function cleanDisplayName(raw: string): string {
  const text = raw.normalize('NFC').replace(INVISIBLE, '').replace(/(\p{M}{3})\p{M}+/gu, '$1').replace(/\s+/g, ' ').trim();
  return [...text].slice(0, MAX_DISPLAY_NAME).join('').trim();
}

// Comes from other people's comments, so it is cleaned like our own input
export function parseDisplayName(comment: string): string {
  const m = ONE.exec(comment);
  if (!m) return '';
  try {
    return cleanDisplayName(fromBase64Url(m[1]));
  } catch {
    return '';
  }
}

export const stripDisplayName = (comment: string) => comment.replace(ALL, '');

export function withDisplayName(comment: string, name: string): string {
  const rest = stripDisplayName(comment);
  const clean = cleanDisplayName(name);
  return clean ? `${rest}<img src="data:,mumh5name:${toBase64Url(clean)}" width="0" height="0"/>` : rest;
}

export interface NamedUser { name: string; chosenName: string; displayName: string }

const sameKey = (name: string) => name.normalize('NFKC').toLowerCase().replace(/\s+/g, '');

// Sets what each person is shown as. A chosen name someone else also uses, as account or chosen
// name, keeps the account name beside it, so nobody can pass as another person.
export function labelNames(users: Iterable<NamedUser>): void {
  const list = [...users];
  const uses = new Map<string, number>();
  const count = (key: string) => uses.set(key, (uses.get(key) ?? 0) + 1);
  for (const u of list) {
    const account = sameKey(u.name);
    count(account);
    if (u.chosenName && sameKey(u.chosenName) !== account) count(sameKey(u.chosenName));
  }
  for (const u of list) {
    if (!u.chosenName || u.chosenName === u.name) u.displayName = '';
    else u.displayName = (uses.get(sameKey(u.chosenName)) ?? 0) > 1 ? `${u.chosenName} (${u.name})` : u.chosenName;
  }
}
