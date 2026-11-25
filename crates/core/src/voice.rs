use crate::proto::udp;
use prost::Message;
pub fn write_varint(out: &mut Vec<u8>, value: u64) {
    if value < 0x80 {
        out.push(value as u8);
    } else if value < 0x4000 {
        out.extend_from_slice(&[(0x80 | (value >> 8)) as u8, value as u8]);
    } else if value < 0x200000 {
        out.extend_from_slice(&[
            (0xc0 | (value >> 16)) as u8,
            (value >> 8) as u8,
            value as u8,
        ]);
    } else if value < 0x10000000 {
        out.extend_from_slice(&[
            (0xe0 | (value >> 24)) as u8,
            (value >> 16) as u8,
            (value >> 8) as u8,
            value as u8,
        ]);
    } else if value <= u32::MAX as u64 {
        out.push(0xf0);
        out.extend_from_slice(&(value as u32).to_be_bytes());
    } else {
        out.push(0xf4);
        out.extend_from_slice(&value.to_be_bytes());
    }
}
pub fn read_varint(input: &mut &[u8]) -> Option<u64> {
    let b = *input.first()?;
    let (count, mut value) = if b < 0x80 {
        (1, b as u64)
    } else if b < 0xc0 {
        (2, (b & 0x3f) as u64)
    } else if b < 0xe0 {
        (3, (b & 0x1f) as u64)
    } else if b < 0xf0 {
        (4, (b & 0xf) as u64)
    } else if b & 0xfc == 0xf0 {
        (5, 0)
    } else if b & 0xfc == 0xf4 {
        (9, 0)
    } else {
        return None;
    };
    if input.len() < count {
        return None;
    }
    for byte in &input[1..count] {
        value = (value << 8) | *byte as u64;
    }
    *input = &input[count..];
    Some(value)
}
pub fn encode(sequence: u64, opus: &[u8], last: bool, protobuf: bool) -> Vec<u8> {
    if protobuf {
        let mut out = vec![0];
        udp::Audio {
            header: Some(udp::audio::Header::Target(0)),
            frame_number: sequence,
            opus_data: opus.to_vec(),
            is_terminator: last,
            ..Default::default()
        }
        .encode(&mut out)
        .unwrap();
        out
    } else {
        let mut out = vec![4 << 5];
        write_varint(&mut out, sequence);
        write_varint(&mut out, opus.len() as u64 | if last { 0x2000 } else { 0 });
        out.extend_from_slice(opus);
        out
    }
}
pub struct Packet {
    pub session: u32,
    pub sequence: u64,
    pub opus: Vec<u8>,
    pub last: bool,
}
pub fn decode(mut data: &[u8]) -> Option<Packet> {
    let head = *data.first()?;
    data = &data[1..];
    if head == 0 {
        let p = udp::Audio::decode(data).ok()?;
        return Some(Packet {
            session: p.sender_session,
            sequence: p.frame_number,
            opus: p.opus_data,
            last: p.is_terminator,
        });
    }
    if head >> 5 != 4 {
        return None;
    }
    let session = u32::try_from(read_varint(&mut data)?).ok()?;
    let sequence = read_varint(&mut data)?;
    let size = read_varint(&mut data)?;
    let len = (size & 0x1fff) as usize;
    if len > data.len() {
        return None;
    }
    Some(Packet {
        session,
        sequence,
        opus: data[..len].to_vec(),
        last: size & 0x2000 != 0,
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn varints() {
        for n in [
            0,
            127,
            128,
            16383,
            16384,
            0x1fffff,
            0x200000,
            0xfffffff,
            0x10000000,
            u32::MAX as u64,
            u64::MAX,
        ] {
            let mut b = vec![];
            write_varint(&mut b, n);
            assert_eq!(read_varint(&mut &b[..]), Some(n));
            for cut in 0..b.len() {
                assert!(read_varint(&mut &b[..cut]).is_none());
            }
        }
    }
}
