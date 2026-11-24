import { expect, test } from 'bun:test';
import { concat, readRecords } from '../src/lib/tauri.ts';

const record = (kind: number, payload: Uint8Array) => {
  const head = new Uint8Array(5); head[0] = kind; new DataView(head.buffer).setUint32(1, payload.length, true);
  return concat([head, payload], 0);
};

test('a batch from the wire commands splits into its records in order', () => {
  const event = new TextEncoder().encode(JSON.stringify({ event: 'udpState', args: [true, 12] }));
  const batch = concat([record(0, new Uint8Array([1, 2, 3])), record(1, new Uint8Array([9])), record(2, event), record(0, new Uint8Array())], 0);
  const seen: [string, unknown[]][] = [];
  readRecords(batch.buffer as ArrayBuffer, (name, args) => seen.push([name, args.map(a => a instanceof Uint8Array ? [...a] : a)]));
  expect(seen).toEqual([['data', [[1, 2, 3]]], ['udpVoice', [[9]]], ['udpState', [true, 12]], ['data', [[]]]]);
});

test('UDP datagrams are joined with a u16 length each', () => {
  expect([...concat([new Uint8Array([7, 8]), new Uint8Array(300).fill(1)], 2).subarray(0, 6)]).toEqual([2, 0, 7, 8, 44, 1]);
  const one = new Uint8Array([5]);
  expect(concat([one], 0)).toBe(one);
});
