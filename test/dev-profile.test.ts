import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { seedDevProfile } from '../electron/dev-profile.ts';

function profile() {
  const root = mkdtempSync(path.join(tmpdir(), 'mumh5-dev-profile-'));
  const from = path.join(root, 'mumh5');
  for (const dir of ['Local Storage/leveldb', 'IndexedDB/http_localhost_5173.indexeddb.leveldb', 'IndexedDB/file__0.indexeddb.leveldb', 'Cache']) {
    mkdirSync(path.join(from, dir), { recursive: true });
  }
  writeFileSync(path.join(from, 'identities.json'), '{"secret":1}', { mode: 0o600 });
  writeFileSync(path.join(from, 'Local Storage/leveldb/000003.log'), 'settings');
  writeFileSync(path.join(from, 'Local Storage/leveldb/LOCK'), '');
  writeFileSync(path.join(from, 'IndexedDB/http_localhost_5173.indexeddb.leveldb/000003.log'), 'dev');
  writeFileSync(path.join(from, 'IndexedDB/file__0.indexeddb.leveldb/000003.log'), 'installed');
  writeFileSync(path.join(from, 'Cache/data'), 'cache');
  return { from, to: path.join(root, 'mumh5-dev') };
}

test('a new dev profile gets settings and dev data, without locks, caches or the installed app data', () => {
  const { from, to } = profile();
  assert.equal(seedDevProfile(from, to), true);
  assert.equal(readFileSync(path.join(to, 'Local Storage/leveldb/000003.log'), 'utf8'), 'settings');
  assert.equal(readFileSync(path.join(to, 'IndexedDB/http_localhost_5173.indexeddb.leveldb/000003.log'), 'utf8'), 'dev');
  assert.equal(existsSync(path.join(to, 'Local Storage/leveldb/LOCK')), false);
  assert.equal(existsSync(path.join(to, 'IndexedDB/file__0.indexeddb.leveldb')), false);
  assert.equal(existsSync(path.join(to, 'Cache')), false);
  assert.equal(existsSync(`${to}.partial`), false);
});

test('private keys stay readable by the owner only', { skip: process.platform === 'win32' }, () => {
  const { from, to } = profile();
  seedDevProfile(from, to);
  assert.equal(statSync(path.join(to, 'identities.json')).mode & 0o777, 0o600);
});

test('an existing dev profile is never overwritten', () => {
  const { from, to } = profile();
  mkdirSync(to);
  writeFileSync(path.join(to, 'identities.json'), 'mine');
  assert.equal(seedDevProfile(from, to), true);
  assert.equal(readFileSync(path.join(to, 'identities.json'), 'utf8'), 'mine');
});

test('a failed copy leaves nothing behind and reports it', () => {
  const { from, to } = profile();
  // The target's parent is a file, so nothing can be created there
  const blocked = path.join(from, 'identities.json', 'mumh5-dev');
  assert.equal(seedDevProfile(from, blocked), false);
  assert.equal(existsSync(to), false);
});
