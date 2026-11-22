import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHAT_RETENTION_MS, currentChatMessage } from '../src/core/chat-retention.ts';

test('client retention expires messages at exactly 24 hours', () => {
  const now = 2 * CHAT_RETENTION_MS;
  assert.equal(currentChatMessage(now - CHAT_RETENTION_MS + 1, now), true);
  assert.equal(currentChatMessage(now - CHAT_RETENTION_MS, now), false);
  assert.equal(currentChatMessage(now - CHAT_RETENTION_MS - 1, now), false);
  assert.equal(currentChatMessage(NaN, now), false);
});
