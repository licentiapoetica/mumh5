import type { User } from './client.ts';

// Certificate hashes take precedence over server-local registration IDs, as in DM routing.
// Anonymous users can only be recognized for the lifetime of their current User object.
const guests = new WeakMap<User, string>();

export function persistentChatAuthor(key: unknown): key is string {
  return typeof key === 'string' && (/^hash:.+$/.test(key) || /^user:\d+$/.test(key));
}

export function chatAuthorKey(user: User): string {
  if (user.hash) return `hash:${user.hash}`;
  if (user.userId != null) return `user:${user.userId}`;
  let key = guests.get(user);
  if (!key) { key = `guest:${crypto.randomUUID()}`; guests.set(user, key); }
  return key;
}

export function chatAuthorKeys(user: User): string[] {
  const keys = new Set([chatAuthorKey(user)]);
  if (user.userId != null) keys.add(`user:${user.userId}`);
  // Registering during a connection must keep earlier anonymous messages clickable.
  const guest = guests.get(user);
  if (guest) keys.add(guest);
  return [...keys];
}
