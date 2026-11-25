import { test } from 'bun:test';
import assert from './assert.ts';
import { comboFromEvent, comboLabel, hasModifier, parseCombo, portalTrigger } from '../src/core/hotkeys.ts';

const key = (code: string, mods: Partial<Record<'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey', boolean>> = {}) =>
  ({ code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods });

test('combinations from key events, modifiers in a fixed order', () => {
  assert.equal(comboFromEvent(key('KeyM', { shiftKey: true, ctrlKey: true })), 'Ctrl+Shift+KeyM');
  assert.equal(comboFromEvent(key('F9')), 'F9');
  assert.equal(comboFromEvent(key('ShiftLeft', { shiftKey: true })), null);
  assert.equal(comboFromEvent(key('ControlRight', { ctrlKey: true })), null);
});

test('parsing rejects broken combinations', () => {
  assert.deepEqual(parseCombo('Alt+KeyD'), { mods: ['Alt'], code: 'KeyD' });
  assert.equal(parseCombo('Ctrl+'), null);
  assert.equal(parseCombo('Hyper+KeyD'), null);
  assert.equal(parseCombo('Ctrl+ShiftLeft'), null);
  assert.ok(hasModifier('Ctrl+KeyM'));
  assert.ok(!hasModifier('F9'));
});

test('readable labels', () => {
  assert.equal(comboLabel('Ctrl+Shift+KeyM'), 'Ctrl + Shift + M');
  assert.equal(comboLabel('Meta+Digit1'), 'Super + 1');
  assert.equal(comboLabel('Backquote'), 'Backtick (`)');
  assert.equal(comboLabel('Numpad5'), 'Num 5');
  assert.equal(comboLabel(''), '');
});

test('portal triggers in the xdg shortcuts format', () => {
  assert.equal(portalTrigger('Ctrl+Shift+KeyM'), 'CTRL+SHIFT+m');
  assert.equal(portalTrigger('Meta+Alt+F9'), 'LOGO+ALT+F9');
  assert.equal(portalTrigger('Backquote'), 'grave');
  assert.equal(portalTrigger('Numpad0'), 'KP_0');
  assert.equal(portalTrigger('Ctrl+ArrowUp'), 'CTRL+Up');
  assert.equal(portalTrigger('IntlBackslash'), null);
});
