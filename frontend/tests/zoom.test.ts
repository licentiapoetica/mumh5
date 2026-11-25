import { test } from 'bun:test';
import assert from './assert.ts';
import { nextZoom, zoomKey } from '../src/core/zoom.ts';

const key = (code: string, k = '', mods: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey', boolean>> = { ctrlKey: true }) =>
  ({ code, key: k, ctrlKey: false, metaKey: false, altKey: false, ...mods });

test('zoom steps like a browser, clamped at the ends', () => {
  assert.equal(nextZoom(1, 1), 1.1);
  assert.equal(nextZoom(1, -1), 0.9);
  assert.equal(nextZoom(1.2, 1), 1.25);
  assert.equal(nextZoom(1.2, -1), 1.1);
  assert.equal(nextZoom(3, 1), 3);
  assert.equal(nextZoom(0.5, -1), 0.5);
});

test('zoom keys: Ctrl or Cmd with plus, minus or zero', () => {
  assert.equal(zoomKey(key('Equal', '=')), 'in');
  assert.equal(zoomKey(key('BracketRight', '+')), 'in');
  assert.equal(zoomKey(key('NumpadSubtract', '-')), 'out');
  assert.equal(zoomKey(key('Digit0', '0', { metaKey: true })), 'reset');
  assert.equal(zoomKey(key('Minus', '-', {})), null);
  assert.equal(zoomKey(key('Minus', '-', { ctrlKey: true, altKey: true })), null);
});
