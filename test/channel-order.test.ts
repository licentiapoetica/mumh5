import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planMove, byOrder, type Ordered } from '../src/core/channel-order.ts';

const ch = (id: number, name: string, position = 0): Ordered => ({ id, name, position });
// The order everyone sees once the plan is applied
function after(siblings: Ordered[], moved: Ordered, index: number): string[] {
  const plan = planMove(siblings, moved, index);
  const all = [...siblings.filter(c => c.id !== moved.id), moved].map(c => ({ ...c, position: plan.find(u => u.id === c.id)?.position ?? c.position }));
  return all.sort(byOrder).map(c => c.name);
}

test('a spot that the name already gives needs no change', () => {
  const list = [ch(1, 'Alpha'), ch(3, 'Gamma')];
  assert.deepEqual(planMove(list, ch(2, 'Beta'), 1), []);
});

test('one change when there is room between the neighbours', () => {
  const list = [ch(1, 'Alpha', 0), ch(2, 'Beta', 5), ch(3, 'Gamma', 9)];
  const plan = planMove(list, ch(3, 'Gamma', 9), 1);
  assert.equal(plan.length, 1);
  assert.deepEqual(after(list, ch(3, 'Gamma', 9), 1), ['Alpha', 'Gamma', 'Beta']);
});

test('to the front and to the end', () => {
  const list = [ch(1, 'Alpha'), ch(2, 'Beta'), ch(3, 'Gamma')];
  assert.deepEqual(planMove(list, list[2], 0), [{ id: 3, position: -1 }]);
  assert.deepEqual(planMove(list, list[0], 2), [{ id: 1, position: 1 }]);
});

test('channels that all share a position are numbered again when the name does not fit', () => {
  const list = [ch(1, 'Alpha'), ch(2, 'Beta'), ch(3, 'Gamma'), ch(4, 'Delta')];
  // Sorted: Alpha, Beta, Delta, Gamma. Gamma between Alpha and Beta.
  assert.deepEqual(after(list, list[2], 1), ['Alpha', 'Gamma', 'Beta', 'Delta']);
  assert.ok(planMove(list, list[2], 1).length > 1);
});

test('every spot works, for a channel of the row and for one coming from elsewhere', () => {
  const list = [ch(1, 'b', 0), ch(2, 'a', 0), ch(3, 'c', 1), ch(4, 'd', 1), ch(5, 'e', 7)];
  const sorted = [...list].sort(byOrder);
  for (const moved of [...list, ch(9, 'new', 1)]) {
    const rest = sorted.filter(c => c.id !== moved.id).map(c => c.name);
    for (let i = 0; i <= rest.length; i++) {
      assert.deepEqual(after(list, moved, i), [...rest.slice(0, i), moved.name, ...rest.slice(i)], `${moved.name} to ${i}`);
    }
  }
});
