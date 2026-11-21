import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { SavedState, mergeSaved } from '../electron/saved-state.ts';

const KEY = 'mumh5.servers';
const dir = () => mkdtempSync(path.join(tmpdir(), 'mumh5-saved-'));
const server = (id: string, host = `${id}.example`) => ({ id, label: id, host, port: 64738, username: 'me', password: '' });
const list = (...ids: string[]) => JSON.stringify(ids.map(id => server(id)));
const ids = (raw: string | null) => (JSON.parse(raw ?? '[]') as { id: string }[]).map(s => s.id);

test('a list survives losing browser storage', () => {
  const d = dir();
  assert.equal(new SavedState(d).sync(KEY, list('a', 'b'), true), list('a', 'b'));
  assert.deepEqual(ids(new SavedState(d).sync(KEY, null, true)), ['a', 'b']);
  assert.equal(statSync(path.join(d, 'saved-state.json')).mode & 0o777, 0o600);
});

test('another origin hands over its servers once, without duplicates', () => {
  const d = dir();
  const s = new SavedState(d);
  s.write(KEY, list('a', 'b'));
  const other = JSON.stringify([server('x', 'A.example'), server('c')]);
  assert.deepEqual(ids(s.sync(KEY, other, true)), ['a', 'b', 'c']);
});

test('a removed server does not come back after the hand-over', () => {
  const s = new SavedState(dir());
  s.sync(KEY, list('a', 'b'), true);
  s.write(KEY, list('a'));
  assert.deepEqual(ids(s.sync(KEY, list('a', 'b'), false)), ['a']);
});

test('objects merge and token lists are combined', () => {
  const merged = JSON.parse(mergeSaved('mumh5.tokens', '{"h:1":["a"],"h:2":["b"]}', '{"h:1":["a","c"],"h:3":["d"]}'));
  assert.deepEqual(merged, { 'h:1': ['a', 'c'], 'h:2': ['b'], 'h:3': ['d'] });
});

test('a damaged file falls back to the backup and does not replace it', () => {
  const d = dir();
  const s = new SavedState(d);
  s.write(KEY, list('a'));
  s.write(KEY, list('a', 'b'));
  const file = path.join(d, 'saved-state.json');
  writeFileSync(file, '{"version":1,"val');
  assert.deepEqual(ids(s.sync(KEY, null, false)), ['a']);
  s.write('mumh5.pins', '{}');
  assert.deepEqual(ids(JSON.parse(readFileSync(file, 'utf8')).values[KEY]), ['a']);
  assert.deepEqual(ids(JSON.parse(readFileSync(`${file}.bak`, 'utf8')).values[KEY]), ['a']);
});
