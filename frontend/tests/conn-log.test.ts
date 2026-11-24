import { test } from 'bun:test';
import assert from './assert.ts';
import { appendLog, formatLog, formatTime, LOG_LIMIT } from '../src/core/conn-log.ts';

test('the log keeps the newest lines', () => {
  let list: { at: number; text: string }[] = [];
  for (let i = 0; i < LOG_LIMIT + 5; i++) list = appendLog(list, { at: i, text: `line ${i}` });
  assert.equal(list.length, LOG_LIMIT);
  assert.equal(list[0].text, 'line 5');
  assert.equal(list.at(-1)!.text, `line ${LOG_LIMIT + 4}`);
});

test('the copied text has the header, then lines oldest first', () => {
  const at = new Date(2026, 10, 24, 9, 5, 7).getTime();
  assert.equal(formatTime(at), '2026-11-24 09:05:07');
  const text = formatLog([{ at, text: 'page hidden' }, { at: at + 1000, text: 'page visible' }], ['mumh5 0.2.0', '']);
  assert.equal(text, 'mumh5 0.2.0\n\n2026-11-24 09:05:07  page hidden\n2026-11-24 09:05:08  page visible');
});
