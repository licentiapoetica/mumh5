import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_TOOLBAR, TOOLS, addToolbarSpacer, moveToolbarItem, normalizeToolbar, removeToolbarSpacer,
  setToolHidden, visibleToolbarItems, type ToolbarLayout
} from '../src/core/toolbar.ts';

const drawn = (l: ToolbarLayout, lead = false) => visibleToolbarItems(l, lead).map(s => s.item);

test('the default layout holds every button once', () => {
  const tools = DEFAULT_TOOLBAR.items.filter(i => i !== 'sep');
  assert.deepEqual([...tools].sort(), TOOLS.map(t => t.id).sort());
  assert.deepEqual(normalizeToolbar(undefined), DEFAULT_TOOLBAR);
});

test('a saved layout is cleaned up and gains new buttons at the end', () => {
  const l = normalizeToolbar({ items: ['mic', 'gone', 'mic', 'sep', 'sep', 'info'], hidden: ['info', 'gone'] });
  assert.deepEqual(l.items.slice(0, 5), ['mic', 'sep', 'sep', 'info', 'deafen']);
  assert.equal(l.items.filter(i => i !== 'sep').length, TOOLS.length);
  assert.deepEqual(l.hidden, ['info']);
  assert.deepEqual(normalizeToolbar({ items: 'broken', hidden: 3 }), DEFAULT_TOOLBAR);
});

test('moving keeps every item and stays in range', () => {
  const base: ToolbarLayout = { items: ['info', 'sep', 'mic'], hidden: [] };
  assert.deepEqual(moveToolbarItem(base, 2, 0).items, ['mic', 'info', 'sep']);
  assert.deepEqual(moveToolbarItem(base, 0, 99).items, ['sep', 'mic', 'info']);
  assert.deepEqual(moveToolbarItem(base, 7, 0).items, base.items);
  assert.deepEqual(base.items, ['info', 'sep', 'mic'], 'the original is untouched');
});

test('a hidden button keeps its place', () => {
  const base: ToolbarLayout = { items: ['info', 'mic', 'tree'], hidden: [] };
  const off = setToolHidden(base, 'mic', true);
  assert.deepEqual(drawn(off), ['info', 'tree']);
  assert.deepEqual(drawn(setToolHidden(off, 'mic', false)), ['info', 'mic', 'tree']);
});

test('spacers are added where asked and only spacers are removed', () => {
  const base: ToolbarLayout = { items: ['info', 'mic'], hidden: [] };
  assert.deepEqual(addToolbarSpacer(base, 0).items, ['info', 'sep', 'mic']);
  assert.deepEqual(addToolbarSpacer(base, null).items, ['info', 'mic', 'sep']);
  assert.deepEqual(removeToolbarSpacer({ items: ['info', 'sep', 'mic'], hidden: [] }, 1).items, ['info', 'mic']);
  assert.deepEqual(removeToolbarSpacer(base, 0).items, ['info', 'mic']);
});

test('a spacer at the start shows only after the server button', () => {
  const l: ToolbarLayout = { items: ['sep', 'info', 'sep', 'mic'], hidden: ['info'] };
  assert.deepEqual(drawn(l, true), ['sep', 'sep', 'mic']);
  assert.deepEqual(drawn(l, false), ['mic']);
  assert.deepEqual(drawn({ items: ['sep', 'info'], hidden: ['info'] }, false), []);
});

test('your name stays last in a layout saved before it could move', () => {
  const saved = { items: DEFAULT_TOOLBAR.items.filter(i => i !== 'you'), hidden: ['camera'] };
  const l = normalizeToolbar(saved);
  assert.equal(l.items.at(-1), 'you');
  assert.deepEqual(l.hidden, ['camera']);
});

test('a bar without your name draws no spacer for it', () => {
  const l: ToolbarLayout = { items: ['you', 'sep', 'mic'], hidden: [] };
  assert.deepEqual(drawn(l), ['you', 'sep', 'mic']);
  assert.deepEqual(visibleToolbarItems(l, false, false).map(s => s.item), ['mic']);
  assert.deepEqual(drawn(setToolHidden(l, 'you', true)), ['mic']);
});

test('drawn items keep their layout index', () => {
  const l: ToolbarLayout = { items: ['sep', 'info', 'mic'], hidden: ['info'] };
  assert.deepEqual(visibleToolbarItems(l, false), [{ item: 'mic', index: 2 }]);
});
