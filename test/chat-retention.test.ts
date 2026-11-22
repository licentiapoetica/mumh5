import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHAT_RETENTION_MS, currentChatMessage, historyHours } from '../src/core/chat-retention.ts';

test('client retention expires messages at exactly 24 hours', () => {
  const now = 2 * CHAT_RETENTION_MS;
  assert.equal(currentChatMessage(now - CHAT_RETENTION_MS + 1, now), true);
  assert.equal(currentChatMessage(now - CHAT_RETENTION_MS, now), false);
  assert.equal(currentChatMessage(now - CHAT_RETENTION_MS - 1, now), false);
  assert.equal(currentChatMessage(NaN, now), false);
});

test('retention hours default to 24 and support a configurable expiry window', () => {
  for (const value of [undefined, NaN, 0, -1, 9000, '24']) assert.equal(historyHours(value), 24);
  assert.equal(historyHours(48), 48);
  const now = 3 * CHAT_RETENTION_MS;
  assert.equal(currentChatMessage(now - 2 * CHAT_RETENTION_MS, now, historyHours(72) * 3600000), true);
  assert.equal(currentChatMessage(now - 2 * CHAT_RETENTION_MS, now, historyHours(24) * 3600000), false);
});
