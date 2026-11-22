import { test } from 'node:test';
import assert from 'node:assert/strict';
import { atDefaults, changedFrom, load } from '../src/lib/storage.ts';

const defaults = { theme: 'dark', hosts: [] as string[], style: { design: 'none', mark: null as number | null }, volume: 1 };

test('only settings that differ from the defaults are saved', () => {
  assert.deepEqual(changedFrom({ ...defaults }, defaults), {});
  assert.deepEqual(
    changedFrom({ ...defaults, theme: 'light', hosts: ['a.example'], style: { design: 'dots', mark: 3 } }, defaults),
    { theme: 'light', hosts: ['a.example'], style: { design: 'dots', mark: 3 } }
  );
  // Nested values equal to the defaults count as defaults
  assert.deepEqual(changedFrom({ ...defaults, style: { design: 'none', mark: null } }, defaults), {});
});

test('a changed default reaches settings saved before it', () => {
  const saved = changedFrom({ ...defaults, theme: 'light' }, defaults);
  const newer = { ...defaults, volume: 0.5 };
  const store = new Map([['k', JSON.stringify(saved)]]);
  (globalThis as unknown as { localStorage: unknown }).localStorage = { getItem: (key: string) => store.get(key) ?? null };
  assert.deepEqual(load('k', newer), { ...newer, theme: 'light' });
});

test('atDefaults looks only at the given keys', () => {
  const value = { ...defaults, theme: 'light' };
  assert.equal(atDefaults(value, defaults, ['hosts', 'style', 'volume']), true);
  assert.equal(atDefaults(value, defaults, ['theme']), false);
  assert.equal(atDefaults({ ...defaults, hosts: [] }, defaults, ['hosts']), true);
});
