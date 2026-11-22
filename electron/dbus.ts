// Just enough of the D-Bus wire protocol to talk to the desktop portal: marshalling, the session
// bus connection with EXTERNAL authentication, method calls and signals.
// Values: numbers for y b n q i u d (b also as boolean), bigint for x t, strings for s o g,
// [signature, value] for v, arrays for a and ( ), arrays of [key, value] for a{..}.
import net from 'node:net';

export type Value = unknown;

const ALIGN: Record<string, number> = { y: 1, b: 4, n: 2, q: 2, i: 4, u: 4, x: 8, t: 8, d: 8, h: 4, s: 4, o: 4, g: 1, v: 1, a: 4, '(': 8, '{': 8 };

/** The end (exclusive) of the single complete type starting at `i`. */
function typeEnd(sig: string, i: number): number {
  const c = sig[i];
  if (c === 'a') return typeEnd(sig, i + 1);
  if (c === '(' || c === '{') {
    const close = c === '(' ? ')' : '}';
    let j = i + 1;
    while (sig[j] !== close) {
      if (j >= sig.length) throw new Error(`Unclosed ${c} in signature ${sig}`);
      j = typeEnd(sig, j);
    }
    return j + 1;
  }
  if (!(c in ALIGN)) throw new Error(`Unknown type ${c} in signature ${sig}`);
  return i + 1;
}

/** The complete types of a signature, e.g. 'sa{sv}' -> ['s', 'a{sv}']. */
export function splitSignature(sig: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < sig.length;) {
    const end = typeEnd(sig, i);
    out.push(sig.slice(i, end));
    i = end;
  }
  return out;
}

export class Writer {
  private buf = Buffer.alloc(256);
  length = 0;

  private room(n: number) {
    if (this.length + n <= this.buf.length) return;
    const next = Buffer.alloc(Math.max(this.buf.length * 2, this.length + n));
    this.buf.copy(next, 0, 0, this.length);
    this.buf = next;
  }

  pad(align: number) {
    const n = (align - (this.length % align)) % align;
    this.room(n);
    this.buf.fill(0, this.length, this.length + n);
    this.length += n;
  }

  private bytes(b: Uint8Array) {
    this.room(b.length);
    this.buf.set(b, this.length);
    this.length += b.length;
  }

  private u32At(at: number, v: number) { this.buf.writeUInt32LE(v, at); }

  write(type: string, value: Value): void {
    const c = type[0];
    this.pad(ALIGN[c]);
    const n = (size: number, put: (b: Buffer, at: number) => void) => { this.room(size); put(this.buf, this.length); this.length += size; };
    switch (c) {
      case 'y': return n(1, (b, at) => b.writeUInt8(Number(value), at));
      case 'b': return n(4, (b, at) => b.writeUInt32LE(value ? 1 : 0, at));
      case 'n': return n(2, (b, at) => b.writeInt16LE(Number(value), at));
      case 'q': return n(2, (b, at) => b.writeUInt16LE(Number(value), at));
      case 'i': return n(4, (b, at) => b.writeInt32LE(Number(value), at));
      case 'u': case 'h': return n(4, (b, at) => b.writeUInt32LE(Number(value), at));
      case 'x': return n(8, (b, at) => b.writeBigInt64LE(BigInt(value as bigint), at));
      case 't': return n(8, (b, at) => b.writeBigUInt64LE(BigInt(value as bigint), at));
      case 'd': return n(8, (b, at) => b.writeDoubleLE(Number(value), at));
      case 's': case 'o': {
        const text = Buffer.from(String(value), 'utf8');
        n(4, (b, at) => b.writeUInt32LE(text.length, at));
        this.bytes(text);
        return this.bytes(Uint8Array.of(0));
      }
      case 'g': {
        const text = Buffer.from(String(value), 'utf8');
        n(1, (b, at) => b.writeUInt8(text.length, at));
        this.bytes(text);
        return this.bytes(Uint8Array.of(0));
      }
      case 'v': {
        const [sig, inner] = value as [string, Value];
        this.write('g', sig);
        return this.write(sig, inner);
      }
      case 'a': {
        const elem = type.slice(1);
        const at = this.length;
        n(4, () => {});
        // The length counts the elements only, not the padding before the first one
        this.pad(ALIGN[elem[0]]);
        const start = this.length;
        for (const item of value as Value[]) this.write(elem, item);
        return this.u32At(at, this.length - start);
      }
      case '(': case '{': {
        const parts = splitSignature(type.slice(1, -1));
        const items = value as Value[];
        parts.forEach((t, k) => this.write(t, items[k]));
        return;
      }
    }
    throw new Error(`Cannot write type ${type}`);
  }

  writeAll(sig: string, values: Value[]) { splitSignature(sig).forEach((t, k) => this.write(t, values[k])); }

  bytesWritten(): Buffer { return Buffer.from(this.buf.subarray(0, this.length)); }
}

export class Reader {
  pos: number;
  private readonly buf: Buffer;
  private readonly base: number;
  private readonly le: boolean;

  // base: where alignment counts from (the start of the message)
  constructor(buf: Buffer, pos = 0, base = 0, le = true) {
    this.buf = buf;
    this.pos = pos;
    this.base = base;
    this.le = le;
  }

  private align(a: number) { this.pos += (a - ((this.pos - this.base) % a)) % a; }

  private take<T>(size: number, get: (at: number) => T): T {
    if (this.pos + size > this.buf.length) throw new Error('D-Bus message ends early');
    const v = get(this.pos);
    this.pos += size;
    return v;
  }

  read(type: string): Value {
    const c = type[0];
    this.align(ALIGN[c]);
    const b = this.buf, le = this.le;
    switch (c) {
      case 'y': return this.take(1, at => b.readUInt8(at));
      case 'b': return this.take(4, at => (le ? b.readUInt32LE(at) : b.readUInt32BE(at)) !== 0);
      case 'n': return this.take(2, at => le ? b.readInt16LE(at) : b.readInt16BE(at));
      case 'q': return this.take(2, at => le ? b.readUInt16LE(at) : b.readUInt16BE(at));
      case 'i': return this.take(4, at => le ? b.readInt32LE(at) : b.readInt32BE(at));
      case 'u': case 'h': return this.take(4, at => le ? b.readUInt32LE(at) : b.readUInt32BE(at));
      case 'x': return this.take(8, at => le ? b.readBigInt64LE(at) : b.readBigInt64BE(at));
      case 't': return this.take(8, at => le ? b.readBigUInt64LE(at) : b.readBigUInt64BE(at));
      case 'd': return this.take(8, at => le ? b.readDoubleLE(at) : b.readDoubleBE(at));
      case 's': case 'o': {
        const len = this.read('u') as number;
        const text = this.take(len + 1, at => b.toString('utf8', at, at + len));
        return text;
      }
      case 'g': {
        const len = this.read('y') as number;
        return this.take(len + 1, at => b.toString('utf8', at, at + len));
      }
      case 'v': {
        const sig = this.read('g') as string;
        return [sig, this.read(sig)];
      }
      case 'a': {
        const elem = type.slice(1);
        const len = this.read('u') as number;
        this.align(ALIGN[elem[0]]);
        const end = this.pos + len;
        if (end > b.length) throw new Error('D-Bus array runs past the message');
        const out: Value[] = [];
        while (this.pos < end) out.push(this.read(elem));
        return out;
      }
      case '(': case '{':
        return splitSignature(type.slice(1, -1)).map(t => this.read(t));
    }
    throw new Error(`Cannot read type ${type}`);
  }

  readAll(sig: string): Value[] { return splitSignature(sig).map(t => this.read(t)); }
}

export const Kind = { Call: 1, Return: 2, Error: 3, Signal: 4 } as const;
const FIELD = { path: 1, interface: 2, member: 3, errorName: 4, replySerial: 5, destination: 6, sender: 7, signature: 8 } as const;
const FIELD_TYPE: Record<number, string> = { 1: 'o', 2: 's', 3: 's', 4: 's', 5: 'u', 6: 's', 7: 's', 8: 'g', 9: 'u' };

export interface Message {
  kind: number;
  serial: number;
  path?: string;
  interface?: string;
  member?: string;
  errorName?: string;
  replySerial?: number;
  destination?: string;
  sender?: string;
  signature?: string;
  body: Value[];
}

export function encodeMessage(m: Omit<Message, 'body'> & { body?: Value[] }): Buffer {
  const body = new Writer();
  if (m.signature) body.writeAll(m.signature, m.body ?? []);
  const fields: [number, [string, Value]][] = [];
  for (const [name, code] of Object.entries(FIELD)) {
    const v = m[name as keyof typeof FIELD];
    if (v !== undefined && v !== '') fields.push([code, [FIELD_TYPE[code], v]]);
  }
  const head = new Writer();
  head.write('y', 'l'.charCodeAt(0));
  head.write('y', m.kind);
  head.write('y', 0);
  head.write('y', 1);
  head.write('u', body.length);
  head.write('u', m.serial);
  head.write('a(yv)', fields);
  head.pad(8);
  return Buffer.concat([head.bytesWritten(), body.bytesWritten()]);
}

/** The length of the first complete message in `buf`, or 0 while more bytes are needed. */
export function messageLength(buf: Buffer): number {
  if (buf.length < 16) return 0;
  const le = buf[0] === 0x6c;
  const bodyLen = le ? buf.readUInt32LE(4) : buf.readUInt32BE(4);
  const fieldsLen = le ? buf.readUInt32LE(12) : buf.readUInt32BE(12);
  const headLen = 16 + fieldsLen + ((8 - (fieldsLen % 8)) % 8);
  const total = headLen + bodyLen;
  return buf.length >= total ? total : 0;
}

export function decodeMessage(buf: Buffer): Message {
  const le = buf[0] === 0x6c;
  if (!le && buf[0] !== 0x42) throw new Error('Not a D-Bus message');
  const r = new Reader(buf, 0, 0, le);
  r.read('y');
  const kind = r.read('y') as number;
  r.read('y');
  r.read('y');
  r.read('u');
  const serial = r.read('u') as number;
  const m: Message = { kind, serial, body: [] };
  const names = Object.fromEntries(Object.entries(FIELD).map(([k, v]) => [v, k])) as Record<number, keyof typeof FIELD>;
  for (const [code, [, v]] of r.read('a(yv)') as [number, [string, Value]][]) {
    const name = names[code];
    if (name) (m as unknown as Record<string, Value>)[name] = v;
  }
  const fieldsLen = le ? buf.readUInt32LE(12) : buf.readUInt32BE(12);
  const bodyStart = 16 + fieldsLen + ((8 - (fieldsLen % 8)) % 8);
  if (m.signature) m.body = new Reader(buf, bodyStart, bodyStart, le).readAll(m.signature);
  return m;
}

/** A path for net.connect from a D-Bus address like unix:path=/run/user/1000/bus. */
export function socketPath(address: string): string | null {
  for (const one of address.split(';')) {
    const [transport, rest = ''] = one.split(/:(.*)/s);
    if (transport !== 'unix') continue;
    const params = Object.fromEntries(rest.split(',').map(p => p.split(/=(.*)/s)).map(([k, v]) => [k, decodeURIComponent(v ?? '')]));
    if (params.path) return params.path;
    if (params.abstract) return `\0${params.abstract}`;
  }
  return null;
}

export class DBusError extends Error {
  readonly name: string;
  constructor(name: string, message: string) {
    super(message || name);
    this.name = name;
  }
}

export interface CallOptions {
  destination: string;
  path: string;
  interface: string;
  member: string;
  signature?: string;
  body?: Value[];
}

export class Bus {
  /** This connection's unique name, like :1.42 */
  name = '';
  private serial = 0;
  private pending = new Map<number, { resolve: (m: Message) => void; reject: (e: Error) => void }>();
  private listeners = new Set<(m: Message) => void>();
  private incoming = Buffer.alloc(0);
  private readonly socket: net.Socket;

  private constructor(socket: net.Socket) {
    this.socket = socket;
  }

  static async session(timeoutMs = 5000): Promise<Bus> {
    const path = socketPath(process.env.DBUS_SESSION_BUS_ADDRESS ?? (process.env.XDG_RUNTIME_DIR ? `unix:path=${process.env.XDG_RUNTIME_DIR}/bus` : ''));
    if (!path) throw new Error('No D-Bus session bus');
    const socket = net.connect(path);
    const bus = new Bus(socket);
    const timer = setTimeout(() => socket.destroy(new Error('The D-Bus session bus did not answer')), timeoutMs);
    try {
      await bus.authenticate();
      bus.listen();
      bus.name = (await bus.call({ destination: 'org.freedesktop.DBus', path: '/org/freedesktop/DBus', interface: 'org.freedesktop.DBus', member: 'Hello' }))[0] as string;
      return bus;
    } catch (e) {
      socket.destroy();
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  private authenticate(): Promise<void> {
    return new Promise((resolve, reject) => {
      const uid = String(process.getuid?.() ?? 0);
      let text = '';
      const onData = (chunk: Buffer) => {
        text += chunk.toString('latin1');
        const end = text.indexOf('\r\n');
        if (end < 0) return;
        this.socket.off('data', onData);
        this.socket.off('error', reject);
        if (!text.startsWith('OK ')) return reject(new Error(`D-Bus refused the connection: ${text.slice(0, end)}`));
        this.socket.write('BEGIN\r\n');
        resolve();
      };
      this.socket.on('data', onData);
      this.socket.once('error', reject);
      this.socket.write(`\0AUTH EXTERNAL ${Buffer.from(uid).toString('hex')}\r\n`);
    });
  }

  private listen() {
    this.socket.on('data', (chunk: Buffer) => {
      this.incoming = Buffer.concat([this.incoming, chunk]);
      for (let len = messageLength(this.incoming); len; len = messageLength(this.incoming)) {
        const raw = this.incoming.subarray(0, len);
        this.incoming = this.incoming.subarray(len);
        let m: Message;
        try { m = decodeMessage(Buffer.from(raw)); } catch { continue; }
        this.dispatch(m);
      }
    });
    const fail = (e: Error) => {
      for (const p of this.pending.values()) p.reject(e);
      this.pending.clear();
    };
    this.socket.on('error', fail);
    this.socket.on('close', () => fail(new Error('The D-Bus connection closed')));
  }

  private dispatch(m: Message) {
    if (m.kind === Kind.Signal) {
      for (const l of this.listeners) l(m);
      return;
    }
    const p = m.replySerial !== undefined ? this.pending.get(m.replySerial) : undefined;
    if (!p) return;
    this.pending.delete(m.replySerial!);
    if (m.kind === Kind.Error) p.reject(new DBusError(m.errorName ?? 'org.freedesktop.DBus.Error.Failed', String(m.body[0] ?? '')));
    else p.resolve(m);
  }

  async call(o: CallOptions): Promise<Value[]> {
    const serial = ++this.serial;
    const reply = new Promise<Message>((resolve, reject) => this.pending.set(serial, { resolve, reject }));
    this.socket.write(encodeMessage({ kind: Kind.Call, serial, ...o }));
    return (await reply).body;
  }

  onSignal(listener: (m: Message) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close() { this.socket.destroy(); }
}
