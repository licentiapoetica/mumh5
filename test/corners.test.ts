import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCorners, CORNER_PARTS, cornerPreset, cornerValue, withCorner } from '../src/lib/corners.ts';

const part = (id: string) => CORNER_PARTS.find(p => p.id === id)!;

test('saved corner values are kept inside the range of their group', () => {
  assert.equal(cornerValue({ icons: 8 }, part('icons')), 8);
  assert.equal(cornerValue({ icons: 999 }, part('icons')), 24);
  assert.equal(cornerValue({ avatars: 999 }, part('avatars')), 50);
  assert.equal(cornerValue({ icons: -4 }, part('icons')), 0);
  assert.equal(cornerValue({ icons: 'x' as unknown as number }, part('icons')), 0);
  assert.equal(cornerValue(undefined, part('icons')), 0);
});

test('square equals the default, and the round preset makes pictures circles', () => {
  assert.deepEqual(cornerPreset(0), {});
  const round = cornerPreset(24);
  assert.equal(round.icons, 24);
  assert.equal(round.avatars, 50);
  assert.equal(Object.keys(round).length, CORNER_PARTS.length);
});

test('a group set to zero is no longer saved', () => {
  assert.deepEqual(withCorner({ icons: 6, tabs: 2 }, 'icons', 0), { tabs: 2 });
  assert.deepEqual(withCorner(undefined, 'tabs', 3), { tabs: 3 });
});

test('corners reach the page as variables, with their unit', () => {
  const vars = new Map<string, string>([['--r-tabs', '9px']]);
  const style = {
    setProperty: (k: string, v: string | null) => { vars.set(k, v ?? ''); },
    removeProperty: (k: string) => { vars.delete(k); return ''; }
  };
  applyCorners(style, { icons: 6, avatars: 50 });
  assert.equal(vars.get('--r-icons'), '6px');
  assert.equal(vars.get('--r-avatars'), '50%');
  assert.equal(vars.has('--r-tabs'), false);
});
