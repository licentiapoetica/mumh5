import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeBot, decodePair, encodePair, requestPair } from '../src/core/mumpeer-signal.ts';
import { SHARE, decodeShareFlow, decodeWatchRequest, encodeShare, ShareAssembler } from '../src/core/share-signal.ts';

const encoder = new TextEncoder();
const json = (value: object) => encoder.encode(JSON.stringify(value));
const rid = '123456789abcdef0';
const hash = 'ab'.repeat(20);
const fp = 'cd'.repeat(32);
const tok = 'A'.repeat(43);

test('relay requirements and endpoint are read from a bounded bot announcement', () => {
  const relay = { v: 1, t: 'relay', host: 'relay.example.org', tcp: 443, fp, state: 'up', seq: 3 };
  assert.deepEqual(decodeBot(json({ ...relay, u: ['img'], reg: true, unknown: 0 })), {
    t: 'relay', host: relay.host, tcp: 443, fp, state: 'up', seq: 3, registeredOnly: true, screen: false
  });
  assert.equal(decodeBot(json({ ...relay, host: '2001:db8::1' }))?.t, 'relay');
  assert.equal(decodeBot(json({ ...relay, host: 'localhost:443' })), null);
  assert.equal(decodeBot(json({ ...relay, tcp: 65536 })), null);
  assert.equal(decodeBot(json({ ...relay, fp: 'bad' })), null);
  assert.equal(decodeBot(json({ ...relay, extension: 'x'.repeat(1000) })), null);
});

test('only well-formed pair credentials enter share negotiation', () => {
  const token = { v: 1, t: 'token', rid, a: 5, b: 7, ttl: 120, tok };
  assert.equal(decodeBot(json(token))?.t, 'token');
  assert.equal(decodeBot(json({ ...token, a: 7 })), null);
  assert.equal(decodeBot(json({ ...token, rid: 'bad' })), null);
  assert.equal(decodeBot(json({ ...token, tok: token.tok + '=' })), null);
  assert.equal(decodeBot(json({ ...token, ttl: -1 })), null);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(requestPair(7, rid))), { v: 1, t: 'token-req', peer: 7, rid, use: 'scr' });
  const msg = { t: 'prepare', share: '0123456789abcdef', rid } as const;
  assert.deepEqual(decodePair(encodePair(msg)), msg);
  assert.equal(decodePair(json({ v: 2, ...msg })), null);
});

test('share capability is optional and the negotiated flow preserves its attempt id', async () => {
  const watch = { id: rid, only: true, direct: false, relay: `${hash}:${fp}` };
  const assembler = new ShareAssembler();
  const [packet] = await encodeShare(SHARE.watch, JSON.stringify({ v: 1, ...watch }));
  assert.equal((await assembler.push(5, packet))?.type, SHARE.watch);
  assert.deepEqual(decodeWatchRequest((await assembler.push(5, packet))?.text), watch);
  assert.equal(decodeWatchRequest(undefined), null);
  assert.equal(decodeWatchRequest(JSON.stringify({ v: 1, ...watch, direct: true })), null);
  const flow = { id: rid, t: 'offer', route: 'mumpeer', sdp: 'v=0\r\n', fallback: false };
  assert.deepEqual(decodeShareFlow(JSON.stringify({ v: 1, ...flow })), flow);
  assert.equal(decodeShareFlow(JSON.stringify({ v: 1, ...flow, route: 'unknown' })), null);
});
