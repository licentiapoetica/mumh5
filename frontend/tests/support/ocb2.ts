import { createCipheriv, createDecipheriv } from 'node:crypto';

// Mumble's UDP encryption: OCB2-AES128 with 4-byte packet headers (IV byte + 3 tag bytes),
// ported from Mumble's CryptStateOCB2.cpp including its counter-measures against the
// XEX* attack (https://eprint.iacr.org/2019/311, section 9).

const BLOCK = 16;

function aes(key: Buffer, block: Buffer): Buffer {
  const c = createCipheriv('aes-128-ecb', key, null);
  c.setAutoPadding(false);
  return c.update(block);
}

function aesDecrypt(key: Buffer, block: Buffer): Buffer {
  const d = createDecipheriv('aes-128-ecb', key, null);
  d.setAutoPadding(false);
  return d.update(block);
}

function xor(a: Buffer, b: Buffer): Buffer {
  const out = Buffer.alloc(BLOCK);
  for (let i = 0; i < BLOCK; i++) out[i] = a[i] ^ b[i];
  return out;
}

// Multiply by x in GF(2^128), big endian
function times2(b: Buffer): Buffer {
  const out = Buffer.alloc(BLOCK);
  const carry = b[0] >> 7;
  for (let i = 0; i < BLOCK - 1; i++) out[i] = ((b[i] << 1) | (b[i + 1] >> 7)) & 0xff;
  out[BLOCK - 1] = ((b[BLOCK - 1] << 1) ^ (carry * 0x87)) & 0xff;
  return out;
}

const times3 = (b: Buffer) => xor(b, times2(b));

// Returns [ciphertext, tag, ok]; ok is false only when an attack pattern was seen and
// modifyOnAttack is off (used by tests)
export function ocbEncrypt(key: Buffer, plain: Buffer, nonce: Buffer, modifyOnAttack = true): [Buffer, Buffer, boolean] {
  let delta: Buffer = aes(key, nonce);
  let checksum: Buffer = Buffer.alloc(BLOCK);
  const out = Buffer.alloc(plain.length);
  let ok = true;
  let off = 0;
  let len = plain.length;
  while (len > BLOCK) {
    const block = plain.subarray(off, off + BLOCK);
    let flip = false;
    if (len - BLOCK <= BLOCK) {
      let sum = 0;
      for (let i = 0; i < BLOCK - 1; i++) sum |= block[i];
      if (sum === 0) {
        if (modifyOnAttack) flip = true;
        else ok = false;
      }
    }
    delta = times2(delta);
    const tmp = xor(delta, block);
    if (flip) tmp[0] ^= 1;
    xor(delta, aes(key, tmp)).copy(out, off);
    checksum = xor(checksum, block);
    if (flip) checksum[0] ^= 1;
    len -= BLOCK;
    off += BLOCK;
  }
  delta = times2(delta);
  const lenBlock = Buffer.alloc(BLOCK);
  lenBlock[BLOCK - 1] = (len * 8) & 0xff;
  const pad = aes(key, xor(lenBlock, delta));
  const tmp = Buffer.from(pad);
  plain.copy(tmp, 0, off, off + len);
  checksum = xor(checksum, tmp);
  xor(pad, tmp).copy(out, off, 0, len);
  delta = times3(delta);
  const tag = aes(key, xor(delta, checksum));
  return [out, tag, ok];
}

export function ocbDecrypt(key: Buffer, encrypted: Buffer, nonce: Buffer): [Buffer, Buffer, boolean] {
  let delta: Buffer = aes(key, nonce);
  let checksum: Buffer = Buffer.alloc(BLOCK);
  const out = Buffer.alloc(encrypted.length);
  let off = 0;
  let len = encrypted.length;
  while (len > BLOCK) {
    delta = times2(delta);
    const plainBlock = xor(delta, aesDecrypt(key, xor(delta, encrypted.subarray(off, off + BLOCK))));
    plainBlock.copy(out, off);
    checksum = xor(checksum, plainBlock);
    len -= BLOCK;
    off += BLOCK;
  }
  delta = times2(delta);
  const lenBlock = Buffer.alloc(BLOCK);
  lenBlock[BLOCK - 1] = (len * 8) & 0xff;
  const pad = aes(key, xor(lenBlock, delta));
  const tmp = Buffer.alloc(BLOCK);
  encrypted.copy(tmp, 0, off, off + len);
  const last = xor(tmp, pad);
  checksum = xor(checksum, last);
  last.copy(out, off, 0, len);
  // Attack check: the decrypted last block must not equal delta (all but the length byte)
  const ok = !last.subarray(0, BLOCK - 1).equals(delta.subarray(0, BLOCK - 1));
  delta = times3(delta);
  const tag = aes(key, xor(delta, checksum));
  return [out, tag, ok];
}

export class CryptState {
  private key = Buffer.alloc(BLOCK);
  encryptIv = Buffer.alloc(BLOCK);
  decryptIv = Buffer.alloc(BLOCK);
  private history = new Uint8Array(256);
  valid = false;
  good = 0;
  late = 0;
  lost = 0;
  resync = 0;
  lastGood = 0;

  setKey(key: Uint8Array, clientNonce: Uint8Array, serverNonce: Uint8Array): void {
    this.key = Buffer.from(key);
    this.encryptIv = Buffer.from(clientNonce);
    this.decryptIv = Buffer.from(serverNonce);
    this.history.fill(0);
    this.valid = this.key.length === BLOCK && this.encryptIv.length === BLOCK && this.decryptIv.length === BLOCK;
  }

  setDecryptIv(iv: Uint8Array): void {
    this.decryptIv = Buffer.from(iv);
    this.resync++;
  }

  encrypt(plain: Uint8Array): Buffer {
    for (let i = 0; i < BLOCK; i++) {
      this.encryptIv[i] = (this.encryptIv[i] + 1) & 0xff;
      if (this.encryptIv[i]) break;
    }
    const [ct, tag] = ocbEncrypt(this.key, Buffer.from(plain), this.encryptIv);
    const out = Buffer.alloc(ct.length + 4);
    out[0] = this.encryptIv[0];
    tag.copy(out, 1, 0, 3);
    ct.copy(out, 4);
    return out;
  }

  // Mirrors CryptStateOCB2::decrypt: accepts late and out-of-order packets, rejects replays
  decrypt(packet: Uint8Array): Buffer | null {
    if (!this.valid || packet.length < 4) return null;
    const src = Buffer.from(packet);
    const save = Buffer.from(this.decryptIv);
    const ivbyte = src[0];
    const iv = this.decryptIv;
    let restore = false;
    let late = 0, lost = 0;

    if (((iv[0] + 1) & 0xff) === ivbyte) {
      if (ivbyte > iv[0]) iv[0] = ivbyte;
      else if (ivbyte < iv[0]) {
        iv[0] = ivbyte;
        for (let i = 1; i < BLOCK; i++) if ((iv[i] = (iv[i] + 1) & 0xff)) break;
      } else return null;
    } else {
      let diff = ivbyte - iv[0];
      if (diff > 128) diff -= 256;
      else if (diff < -128) diff += 256;
      if (ivbyte < iv[0] && diff > -30 && diff < 0) {
        late = 1; lost = -1; iv[0] = ivbyte; restore = true;
      } else if (ivbyte > iv[0] && diff > -30 && diff < 0) {
        late = 1; lost = -1; iv[0] = ivbyte;
        for (let i = 1; i < BLOCK; i++) { const was = iv[i]; iv[i] = (was - 1) & 0xff; if (was) break; }
        restore = true;
      } else if (ivbyte > iv[0] && diff > 0) {
        lost = ivbyte - iv[0] - 1; iv[0] = ivbyte;
      } else if (ivbyte < iv[0] && diff > 0) {
        lost = 256 - iv[0] + ivbyte - 1; iv[0] = ivbyte;
        for (let i = 1; i < BLOCK; i++) if ((iv[i] = (iv[i] + 1) & 0xff)) break;
      } else return null;
      if (this.history[iv[0]] === iv[1]) {
        save.copy(this.decryptIv);
        return null;
      }
    }

    const [plain, tag, ok] = ocbDecrypt(this.key, src.subarray(4), iv);
    if (!ok || !tag.subarray(0, 3).equals(src.subarray(1, 4))) {
      save.copy(this.decryptIv);
      return null;
    }
    this.history[iv[0]] = iv[1];
    if (restore) save.copy(this.decryptIv);
    this.good++;
    this.late = Math.max(0, this.late + late);
    this.lost = Math.max(0, this.lost + lost);
    this.lastGood = Date.now();
    return plain;
  }
}
