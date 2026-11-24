// Mumble OCB2-AES128, including XEX* countermeasures. Shared by the desktop and native bot client.
use aes::{
    Aes128,
    cipher::{BlockDecrypt, BlockEncrypt, KeyInit},
};
type Block = [u8; 16];
fn xor(a: Block, b: Block) -> Block {
    std::array::from_fn(|i| a[i] ^ b[i])
}
fn twice(a: Block) -> Block {
    let mut b = [0; 16];
    for i in 0..15 {
        b[i] = (a[i] << 1) | (a[i + 1] >> 7);
    }
    b[15] = (a[15] << 1) ^ if a[0] & 128 != 0 { 0x87 } else { 0 };
    b
}
fn encrypt(aes: &Aes128, a: Block) -> Block {
    let mut b = a.into();
    aes.encrypt_block(&mut b);
    b.into()
}
fn decrypt(aes: &Aes128, a: Block) -> Block {
    let mut b = a.into();
    aes.decrypt_block(&mut b);
    b.into()
}
fn increment(iv: &mut Block, start: usize) {
    for b in &mut iv[start..] {
        *b = b.wrapping_add(1);
        if *b != 0 {
            break;
        }
    }
}
fn decrement(iv: &mut Block) {
    for b in &mut iv[1..] {
        let was = *b;
        *b = b.wrapping_sub(1);
        if was != 0 {
            break;
        }
    }
}
fn ocb(aes: &Aes128, input: &[u8], nonce: Block, encoding: bool) -> Option<(Vec<u8>, Block)> {
    let mut delta = encrypt(aes, nonce);
    let mut checksum = [0; 16];
    let mut out = vec![0; input.len()];
    let mut at = 0;
    while input.len() - at > 16 {
        delta = twice(delta);
        let mut block: Block = input[at..at + 16].try_into().ok()?;
        if encoding {
            if input.len() - at <= 32 && block[..15].iter().all(|b| *b == 0) {
                block[0] ^= 1;
            }
            checksum = xor(checksum, block);
            block = xor(delta, encrypt(aes, xor(delta, block)));
        } else {
            block = xor(delta, decrypt(aes, xor(delta, block)));
            checksum = xor(checksum, block);
        }
        out[at..at + 16].copy_from_slice(&block);
        at += 16;
    }
    let len = input.len() - at;
    delta = twice(delta);
    let mut bits = [0; 16];
    bits[15] = (len * 8) as u8;
    let pad = encrypt(aes, xor(bits, delta));
    let mut block;
    if encoding {
        block = pad;
        block[..len].copy_from_slice(&input[at..]);
        checksum = xor(checksum, block);
        block = xor(pad, block);
    } else {
        block = [0; 16];
        block[..len].copy_from_slice(&input[at..]);
        block = xor(block, pad);
        if block[..15] == delta[..15] {
            return None;
        }
        checksum = xor(checksum, block);
    }
    out[at..].copy_from_slice(&block[..len]);
    let tag = encrypt(aes, xor(xor(delta, twice(delta)), checksum));
    Some((out, tag))
}
pub struct Crypt {
    aes: Aes128,
    pub send_iv: Block,
    receive_iv: Block,
    history: [Option<u8>; 256],
}
impl Crypt {
    pub fn new(key: &[u8], client: &[u8], server: &[u8]) -> Option<Self> {
        Some(Self {
            aes: Aes128::new_from_slice(key).ok()?,
            send_iv: client.try_into().ok()?,
            receive_iv: server.try_into().ok()?,
            history: [None; 256],
        })
    }
    pub fn resync(&mut self, nonce: &[u8]) {
        if let Ok(iv) = nonce.try_into() {
            self.receive_iv = iv;
            self.history = [None; 256];
        }
    }
    pub fn encode(&mut self, input: &[u8]) -> Vec<u8> {
        increment(&mut self.send_iv, 0);
        let (bytes, tag) = ocb(&self.aes, input, self.send_iv, true).unwrap();
        let mut out = vec![self.send_iv[0], tag[0], tag[1], tag[2]];
        out.extend(bytes);
        out
    }
    pub fn decode(&mut self, packet: &[u8]) -> Option<Vec<u8>> {
        if packet.len() < 4 {
            return None;
        }
        let saved = self.receive_iv;
        let byte = packet[0];
        let mut restore = false;
        if self.receive_iv[0].wrapping_add(1) == byte {
            if byte < self.receive_iv[0] {
                increment(&mut self.receive_iv, 1);
            }
            self.receive_iv[0] = byte;
        } else {
            let mut diff = byte as i16 - self.receive_iv[0] as i16;
            if diff > 128 {
                diff -= 256;
            } else if diff < -128 {
                diff += 256;
            }
            if byte < self.receive_iv[0] && diff > -30 && diff < 0 {
                self.receive_iv[0] = byte;
                restore = true;
            } else if byte > self.receive_iv[0] && diff > -30 && diff < 0 {
                self.receive_iv[0] = byte;
                decrement(&mut self.receive_iv);
                restore = true;
            } else if byte > self.receive_iv[0] && diff > 0 {
                self.receive_iv[0] = byte;
            } else if byte < self.receive_iv[0] && diff > 0 {
                self.receive_iv[0] = byte;
                increment(&mut self.receive_iv, 1);
            } else {
                return None;
            }
        }
        if self.history[self.receive_iv[0] as usize] == Some(self.receive_iv[1]) {
            self.receive_iv = saved;
            return None;
        }
        let result = ocb(&self.aes, &packet[4..], self.receive_iv, false);
        let valid = result
            .as_ref()
            .is_some_and(|(_, tag)| openssl::memcmp::eq(&tag[..3], &packet[1..4]));
        if !valid {
            self.receive_iv = saved;
            return None;
        }
        self.history[self.receive_iv[0] as usize] = Some(self.receive_iv[1]);
        if restore {
            self.receive_iv = saved;
        }
        result.map(|r| r.0)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn matches_mumble_ocb2_vectors() {
        let key: Block = std::array::from_fn(|i| i as u8);
        let aes = Aes128::new_from_slice(&key).unwrap();
        let (_, tag) = ocb(&aes, &[], key, true).unwrap();
        assert_eq!(hex::encode(tag), "bf3108130773ad5ec70ec69e7875a7b0");
        let bytes: Vec<u8> = (0..40).collect();
        let (cipher, tag) = ocb(&aes, &bytes, key, true).unwrap();
        assert_eq!(hex::encode(tag), "9db0cdf880f73e3e10d4eb3217766688");
        assert_eq!(
            hex::encode(cipher),
            "f75d6bc8b4dc8d66b836a2b08b32a6369f1cd3c5228d79fd6c267f5f6aa7b231c7dfb9d59951ae9c"
        );
    }
    #[test]
    fn roundtrip_reorder_and_replay() {
        let key = [4; 16];
        let mut a = Crypt::new(&key, &[1; 16], &[2; 16]).unwrap();
        let mut b = Crypt::new(&key, &[2; 16], &[1; 16]).unwrap();
        let one = a.encode(b"one");
        let two = a.encode(b"two");
        assert_eq!(b.decode(&two), Some(b"two".to_vec()));
        assert_eq!(b.decode(&one), Some(b"one".to_vec()));
        assert!(b.decode(&one).is_none());
        let mut bad = a.encode(b"three");
        bad[1] ^= 1;
        assert!(b.decode(&bad).is_none());
        for n in 0..70 {
            let data = vec![43; n];
            assert_eq!(b.decode(&a.encode(&data)), Some(data));
        }
    }
}
