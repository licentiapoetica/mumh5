// Mumble voice packets, as sent over UDP or tunneled through TCP (UDPTunnel).
// Two wire formats exist: the legacy one (header byte + Mumble varints) and, since 1.5,
// a protobuf one (type byte 0 + MumbleUDP.Audio). Servers pick per client version.
import { MumbleUDP } from './mumble-udp-pb.js';

export interface VoicePacket {
  session: number;       // sender (only in packets from the server)
  target: number;        // 0 normal talking, 1-30 whisper targets, 31 server loopback; context when received
  frame: number;         // sequence number, in 10 ms audio frames
  opus: Uint8Array;
  last: boolean;         // end of this transmission
}

const LEGACY_OPUS = 4;
const PROTOBUF_AUDIO = 0;

// ─── Mumble varint (PacketDataStream) ─────────────────────────────────────────

export function writeVarint(out: number[], value: number): void {
  if (!Number.isInteger(value) || value < 0) throw new Error(`Unsupported varint ${value}`);
  if (value < 0x80) out.push(value);
  else if (value < 0x4000) out.push(0x80 | (value >> 8), value & 0xff);
  else if (value < 0x200000) out.push(0xc0 | (value >> 16), (value >> 8) & 0xff, value & 0xff);
  else if (value < 0x10000000) out.push(0xe0 | (value >> 24), (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff);
  else if (value < 0x100000000) out.push(0xf0, (value >>> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff);
  else {
    const hi = Math.floor(value / 0x100000000), lo = value >>> 0;
    out.push(0xf4, (hi >>> 24) & 0xff, (hi >> 16) & 0xff, (hi >> 8) & 0xff, hi & 0xff,
      (lo >>> 24) & 0xff, (lo >> 16) & 0xff, (lo >> 8) & 0xff, lo & 0xff);
  }
}

export function readVarint(buf: Uint8Array, pos: number): [value: number, next: number] {
  const need = (n: number) => { if (pos + n > buf.length) throw new Error('Truncated varint'); };
  need(1);
  const b = buf[pos];
  if ((b & 0x80) === 0) return [b, pos + 1];
  if ((b & 0xc0) === 0x80) { need(2); return [((b & 0x3f) << 8) | buf[pos + 1], pos + 2]; }
  if ((b & 0xe0) === 0xc0) { need(3); return [((b & 0x1f) << 16) | (buf[pos + 1] << 8) | buf[pos + 2], pos + 3]; }
  if ((b & 0xf0) === 0xe0) { need(4); return [((b & 0x0f) << 24 | (buf[pos + 1] << 16) | (buf[pos + 2] << 8) | buf[pos + 3]) >>> 0, pos + 4]; }
  const be32 = (p: number) => ((buf[p] << 24) | (buf[p + 1] << 16) | (buf[p + 2] << 8) | buf[p + 3]) >>> 0;
  if ((b & 0xfc) === 0xf0) { need(5); return [be32(pos + 1), pos + 5]; }
  if ((b & 0xfc) === 0xf4) { need(9); return [be32(pos + 1) * 0x100000000 + be32(pos + 5), pos + 9]; }
  // Negative numbers (0xf8, 0xfc prefixes) never occur in audio headers
  throw new Error('Unsupported varint prefix');
}

// ─── Encoding (client to server) ──────────────────────────────────────────────

export function encodeVoice(p: Omit<VoicePacket, 'session'>, protobuf: boolean): Uint8Array {
  if (protobuf) {
    const msg = MumbleUDP.Audio.fromObject({
      target: p.target,
      frame_number: p.frame,
      opus_data: p.opus,
      is_terminator: p.last
    });
    const body: Uint8Array = MumbleUDP.Audio.encode(msg).finish();
    const out = new Uint8Array(body.length + 1);
    out[0] = PROTOBUF_AUDIO;
    out.set(body, 1);
    return out;
  }
  if (p.opus.length >= 0x2000) throw new Error('Opus frame too large');
  const head: number[] = [(LEGACY_OPUS << 5) | (p.target & 0x1f)];
  writeVarint(head, p.frame);
  writeVarint(head, p.opus.length | (p.last ? 0x2000 : 0));
  const out = new Uint8Array(head.length + p.opus.length);
  out.set(head);
  out.set(p.opus, head.length);
  return out;
}

// ─── Decoding (server to client) ──────────────────────────────────────────────

// Returns null for pings, other codecs and malformed packets.
export function decodeVoice(buf: Uint8Array): VoicePacket | null {
  if (!buf.length) return null;
  try {
    if (buf[0] === PROTOBUF_AUDIO) {
      const m = MumbleUDP.Audio.toObject(MumbleUDP.Audio.decode(buf.subarray(1)), { longs: Number, defaults: true });
      return {
        session: m.sender_session,
        target: m.context ?? m.target ?? 0,
        frame: m.frame_number,
        opus: m.opus_data instanceof Uint8Array ? m.opus_data : new Uint8Array(m.opus_data ?? []),
        last: !!m.is_terminator
      };
    }
    if (buf[0] >> 5 !== LEGACY_OPUS) return null;
    const target = buf[0] & 0x1f;
    let pos = 1, session, frame, size;
    [session, pos] = readVarint(buf, pos);
    [frame, pos] = readVarint(buf, pos);
    [size, pos] = readVarint(buf, pos);
    const len = size & 0x1fff;
    if (pos + len > buf.length) return null;
    return { session, target, frame, opus: buf.slice(pos, pos + len), last: (size & 0x2000) !== 0 };
  } catch {
    return null;
  }
}

// For tests and the server-side view: a client packet as the server would relay it
export function relayAsServer(clientPacket: Uint8Array, session: number, protobuf: boolean): Uint8Array {
  if (protobuf) {
    const m = MumbleUDP.Audio.decode(clientPacket.subarray(1));
    m.sender_session = session;
    m.context = 0;
    const body: Uint8Array = MumbleUDP.Audio.encode(m).finish();
    const out = new Uint8Array(body.length + 1);
    out.set(body, 1);
    return out;
  }
  const head: number[] = [clientPacket[0] & 0xe0];
  writeVarint(head, session);
  const out = new Uint8Array(head.length + clientPacket.length - 1);
  out.set(head);
  out.set(clientPacket.subarray(1), head.length);
  return out;
}
