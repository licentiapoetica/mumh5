import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MumbleClient } from '../src/core/client.ts';
import { createCodec } from '../src/core/proto.ts';
import type { Transport } from '../src/core/transport.ts';

function setup(buffered: number) {
  const sent: Uint8Array[] = [];
  const transport: Transport = { onData: null, onClose: null, send: b => { sent.push(b); }, close() {}, get buffered() { return buffered; } };
  const client = new MumbleClient(createCodec());
  client.connect(transport, { username: 'u' });
  sent.length = 0;
  return { client, sent };
}

test('voice is dropped while the uplink is backed up, except the closing packet', () => {
  const { client, sent } = setup(64 * 1024);
  client.sendVoice(new Uint8Array(40));
  assert.equal(sent.length, 0);
  assert.equal(client.voiceDropped, 1);
  client.sendVoice(new Uint8Array(1), true);
  assert.equal(sent.length, 1);
  client.disconnect();
});

test('voice goes out when the uplink is clear', () => {
  const { client, sent } = setup(0);
  client.sendVoice(new Uint8Array(40));
  assert.equal(sent.length, 1);
  client.disconnect();
});
