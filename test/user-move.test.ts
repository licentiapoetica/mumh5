import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planUserMove, confirmUserMove, failUserMove, movePending, remainingSelection } from '../src/core/user-move.ts';

const people = [
  { id: 1, name: 'You', channelId: 0 },
  { id: 2, name: 'Alice', channelId: 0 },
  { id: 3, name: 'Bob', channelId: 4 }
];

test('unknown permissions send requests; self joins without moderator permission', () => {
  const batch = planUserMove(people, 9, 'Games', 1, id => id === 0 ? false : null);
  assert.deepEqual(batch.people.map(p => p.status), ['pending', 'failed', 'pending']);
  assert.match(batch.people[1].reason, /cannot move/);
  assert.equal(movePending(batch), true);
  assert.deepEqual(remainingSelection(batch, [1, 2, 3]), [1, 2, 3], 'submitting is not success');
});

test('partial success removes only confirmed people from selection', () => {
  const batch = planUserMove(people, 9, 'Games', 1, () => true);
  confirmUserMove(batch, 2, 4);
  assert.equal(batch.people[1].status, 'pending', 'another channel is not confirmation');
  confirmUserMove(batch, 2, 9);
  failUserMove(batch, 'The channel is full', 3);
  assert.deepEqual(remainingSelection(batch, [1, 2, 3, 99]), [1, 3, 99]);
  assert.equal(movePending(batch), true);
  confirmUserMove(batch, 1, 9);
  assert.equal(movePending(batch), false);
  assert.deepEqual(remainingSelection(batch, [1, 3, 99]), [3, 99]);
});

test('already present and duplicate people do not produce pending work', () => {
  const batch = planUserMove([people[0], people[0], people[1]], 0, 'Root', 1, () => false);
  assert.deepEqual(batch.people.map(p => p.status), ['already', 'already']);
  assert.equal(movePending(batch), false);
  assert.deepEqual(remainingSelection(batch, [1, 2, 3]), [3]);
});

test('timeouts fail only outstanding requests and leave failures available for retry', () => {
  const batch = planUserMove(people, 9, 'Games', 1, () => null);
  confirmUserMove(batch, 1, 9);
  failUserMove(batch, 'Disconnected', 2);
  failUserMove(batch, 'No confirmation received');
  assert.deepEqual(batch.people.map(p => [p.status, p.reason]), [
    ['moved', ''], ['failed', 'Disconnected'], ['failed', 'No confirmation received']
  ]);
  assert.equal(movePending(batch), false);
  assert.deepEqual(remainingSelection(batch, [1, 2, 3]), [2, 3]);
  const retry = planUserMove(people.slice(1), 9, 'Games', 1, () => true);
  assert.ok(retry.people.every(p => p.status === 'pending'));
});

test('an unrelated drag does not clear or add to an existing selection', () => {
  const batch = planUserMove([people[0]], 9, 'Games', 1, () => null);
  confirmUserMove(batch, 1, 9);
  assert.deepEqual(remainingSelection(batch, [2, 3]), [2, 3]);
});

test('departures fail an individual without changing confirmed results', () => {
  const batch = planUserMove(people, 9, 'Games', 1, () => true);
  confirmUserMove(batch, 1, 9);
  failUserMove(batch, 'Disconnected', 1);
  failUserMove(batch, 'Disconnected', 2);
  assert.equal(batch.people[0].status, 'moved');
  assert.equal(batch.people[1].status, 'failed');
  assert.equal(batch.people[2].status, 'pending');
});
