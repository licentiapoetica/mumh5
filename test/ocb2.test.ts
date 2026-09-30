import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { ocbEncrypt, ocbDecrypt, CryptState } from '../electron/ocb2.ts';

const key = Buffer.from([...Array(16).keys()]);

test('OCB2 matches the test vectors used by Mumble (draft-krovetz-ocb-00)', () => {
  const [, blankTag] = ocbEncrypt(key, Buffer.alloc(0), key);
  assert.equal(blankTag.toString('hex'), 'bf3108130773ad5ec70ec69e7875a7b0');
  const source = Buffer.from([...Array(40).keys()]);
  const [crypt, tag] = ocbEncrypt(key, source, key);
  assert.equal(tag.toString('hex'), '9db0cdf880f73e3e10d4eb3217766688');
  assert.equal(crypt.toString('hex'), 'f75d6bc8b4dc8d66b836a2b08b32a6369f1cd3c5228d79fd6c267f5f6aa7b231c7dfb9d59951ae9c');
});

test('encrypt and decrypt round trip for every length up to 127 bytes', () => {
  const nonce = Buffer.from('ffeeddccbbaa99887766554433221100', 'hex');
  for (let len = 0; len < 128; len++) {
    const plain = randomBytes(len);
    const [ct, tag] = ocbEncrypt(key, plain, nonce);
    const [back, tag2, ok] = ocbDecrypt(key, ct, nonce);
    assert.ok(ok);
    assert.ok(back.equals(plain), `len ${len}`);
    assert.ok(tag.equals(tag2));
  }
});

function pair() {
  const k = randomBytes(16), cn = randomBytes(16), sn = randomBytes(16);
  const client = new CryptState(), server = new CryptState();
  client.setKey(k, cn, sn);
  server.setKey(k, sn, cn); // the server encrypts with the client's decrypt nonce and vice versa
  return { client, server };
}

test('crypt state: in order, lost, late, replay and tampering', () => {
  const { client, server } = pair();
  const packets = Array.from({ length: 300 }, (_, i) => client.encrypt(Buffer.from(`voice ${i}`)));
  // In order (crosses the 256 wrap of the IV byte)
  for (let i = 0; i < 280; i++) assert.equal(server.decrypt(packets[i])?.toString(), `voice ${i}`);
  // 280-282 missing, then 281 arrives late (lost goes back down, like Mumble)
  assert.equal(server.decrypt(packets[283])?.toString(), 'voice 283');
  assert.equal(server.lost, 3);
  assert.equal(server.decrypt(packets[281])?.toString(), 'voice 281');
  assert.equal(server.late, 1);
  assert.equal(server.lost, 2);
  // Replays are rejected
  assert.equal(server.decrypt(packets[281]), null);
  assert.equal(server.decrypt(packets[283]), null);
  // Tampered packets are rejected and do not disturb the state
  const bad = Buffer.from(packets[284]); bad[6] ^= 1;
  assert.equal(server.decrypt(bad), null);
  assert.equal(server.decrypt(packets[284])?.toString(), 'voice 284');
  assert.equal(server.good, 283);
});

test('XEX* attack counter-measure: the pattern is changed on encrypt and refused on decrypt', () => {
  const nonce = randomBytes(16);
  const attack = Buffer.alloc(32);
  attack[15] = 16 * 8; // second to last block all zero except the last byte
  const [, , okStrict] = ocbEncrypt(key, attack, nonce, false);
  assert.equal(okStrict, false, 'pattern detected');
  const [ct] = ocbEncrypt(key, attack, nonce);
  const [plain, , ok] = ocbDecrypt(key, ct, nonce);
  assert.ok(ok);
  assert.notDeepEqual([...plain], [...attack], 'one bit was flipped to defuse the pattern');
});
