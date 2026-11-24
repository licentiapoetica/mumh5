// Generated from proto/Mumble.proto by `npm run proto` (static code, no eval, so it runs under a strict CSP)
import { MumbleProto } from './mumble-pb.js';

// TCP control message type ids, in wire order (index = type id).
export const MESSAGE_TYPES = [
  'Version', 'UDPTunnel', 'Authenticate', 'Ping', 'Reject', 'ServerSync',
  'ChannelRemove', 'ChannelState', 'UserRemove', 'UserState', 'BanList',
  'TextMessage', 'PermissionDenied', 'ACL', 'QueryUsers', 'CryptSetup',
  'ContextActionModify', 'ContextAction', 'UserList', 'VoiceTarget',
  'PermissionQuery', 'CodecVersion', 'UserStats', 'RequestBlob',
  'ServerConfig', 'SuggestConfig', 'PluginDataTransmission'
] as const;

export type MessageName = (typeof MESSAGE_TYPES)[number];

export interface Codec {
  encode(name: MessageName, payload: Record<string, unknown>): Uint8Array;
  decode(typeId: number, body: Uint8Array): { name: MessageName; msg: any } | null;
}

interface GeneratedType {
  verify(obj: Record<string, unknown>): string | null;
  fromObject(obj: Record<string, unknown>): unknown;
  encode(msg: unknown): { finish(): Uint8Array };
  decode(body: Uint8Array): unknown;
  toObject(msg: unknown, opts: { longs: NumberConstructor }): any;
}

// Field names keep their snake_case spelling from the .proto file; 64-bit integers become numbers.
export function createCodec(): Codec {
  const types = MESSAGE_TYPES.map(n => (MumbleProto as unknown as Record<string, GeneratedType>)[n]);

  return {
    encode(name, payload) {
      const id = MESSAGE_TYPES.indexOf(name);
      const type = types[id];
      const err = type.verify(payload);
      if (err) throw new Error(`${name}: ${err}`);
      const body = type.encode(type.fromObject(payload)).finish();
      return frame(id, body);
    },
    decode(typeId, body) {
      const type = types[typeId];
      if (!type) return null;
      const msg = type.toObject(type.decode(body), { longs: Number });
      return { name: MESSAGE_TYPES[typeId], msg };
    }
  };
}

// 6-byte header: uint16 type, uint32 length (big endian), then the body.
export function frame(typeId: number, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(6 + body.length);
  const view = new DataView(out.buffer);
  view.setUint16(0, typeId);
  view.setUint32(2, body.length);
  out.set(body, 6);
  return out;
}

// Reassembles framed messages from an arbitrary chunked byte stream.
export class FrameReader {
  private buf = new Uint8Array(0);

  push(chunk: Uint8Array, onFrame: (typeId: number, body: Uint8Array) => void): void {
    const merged = new Uint8Array(this.buf.length + chunk.length);
    merged.set(this.buf);
    merged.set(chunk, this.buf.length);
    let off = 0;
    while (merged.length - off >= 6) {
      const view = new DataView(merged.buffer, merged.byteOffset + off);
      const typeId = view.getUint16(0);
      const len = view.getUint32(2);
      if (len > 8 * 1024 * 1024) throw new Error(`Frame too large: ${len}`);
      if (merged.length - off - 6 < len) break;
      onFrame(typeId, merged.subarray(off + 6, off + 6 + len));
      off += 6 + len;
    }
    this.buf = merged.slice(off);
  }
}
