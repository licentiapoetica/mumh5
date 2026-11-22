import { parseArgs } from 'node:util';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';

export const HELP = `mumh5 headless client (Node 22+, no browser or display)

Usage: npm run cli -- --server HOST --name BOT [options]

  --server HOST             Mumble server address
  --port PORT               Default: 64738
  --name NAME               Bot username
  --state-dir PATH          Persistent client certificate and server certificate pins
  --channel NAME_OR_ID      Join a voice channel; full paths such as /Lobby work
  --trust-new               Trust an unrecognized certificate on first connection
  --server-fingerprint HEX  Require this SHA-256 server certificate fingerprint
  --password-env NAME       Password environment variable (default: MUMH5_PASSWORD)
  --tcp-only                Tunnel voice over TCP instead of trying encrypted UDP
  --audio-in PATH           Outgoing raw s16le, mono, 48000 Hz
  --audio-out PATH          Incoming mixed raw s16le, mono, 48000 Hz
  --bitrate BITS            Outgoing Opus bitrate, 6000..128000 (default: 40000)
  --video-in PATH           Outgoing raw I420/yuv420p frames
  --video-out DIRECTORY     Record received video as YUV4MPEG2 (.y4m) segments
  --width N --height N      Outgoing video dimensions (default: 640 x 360)
  --fps N                   Input pacing/output file frame rate (default: 15)
  --watch NAME_OR_ID        Receive this user's video (otherwise first sharer)
  --stun URL               Explicit STUN server; repeat for several
  --ice-config PATH         JSON RTCIceServer[] for STUN/TURN, including credentials
  --exit-on-eof             Disconnect after stdin commands finish
  --help                   Show this help

stdin: newline-delimited JSON commands. stdout: newline-delimited JSON events/replies.
Media paths are separate from stdin/stdout. Existing output files are not overwritten.
Video runtime setup: npm run cli:setup
Commands and bot API: cli/README.md
`;

export function options(args: string[], env = process.env) {
  const { values } = parseArgs({ args, strict: true, allowPositionals: false, options: {
    help: { type: 'boolean', short: 'h' }, 'tcp-only': { type: 'boolean' }, server: { type: 'string' }, port: { type: 'string' }, name: { type: 'string' },
    'state-dir': { type: 'string' }, channel: { type: 'string' }, 'trust-new': { type: 'boolean' }, 'server-fingerprint': { type: 'string' },
    'password-env': { type: 'string' }, 'audio-in': { type: 'string' }, 'audio-out': { type: 'string' }, bitrate: { type: 'string' },
    'video-in': { type: 'string' }, 'video-out': { type: 'string' }, width: { type: 'string' }, height: { type: 'string' }, fps: { type: 'string' },
    watch: { type: 'string' }, stun: { type: 'string', multiple: true }, 'ice-config': { type: 'string' }, 'exit-on-eof': { type: 'boolean' }
  } });
  const integer = (value: string | undefined, fallback: number, min: number, max: number, label: string) => {
    const n = value === undefined ? fallback : Number(value);
    if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${label} must be an integer from ${min} to ${max}`);
    return n;
  };
  if (values.help) return { help: true } as const;
  const host = values.server?.trim(), name = values.name?.trim();
  if (!host || !name) throw new Error('--server and --name are required');
  if (name.length > 128) throw new Error('Bot name must be at most 128 characters');
  const port = integer(values.port, 64738, 1, 65535, 'port');
  for (const key of ['audio-in', 'audio-out', 'video-in'] as const) if (values[key] === '-') throw new Error(`${key} needs its own path; stdin/stdout are reserved for JSON`);
  if (values['audio-in'] && values['audio-out'] && path.resolve(values['audio-in']) === path.resolve(values['audio-out'])) throw new Error('Audio input and output must use different paths');
  if (values['server-fingerprint'] && !/^[a-f0-9]{64}$/i.test(values['server-fingerprint'].replace(/:/g, ''))) throw new Error('Server fingerprint must be a SHA-256 hexadecimal fingerprint');
  const profile = createHash('sha256').update(JSON.stringify([host.toLowerCase(), port, name])).digest('hex').slice(0, 16);
  return { help: false, host, name, port,
    stateDir: values['state-dir'] ?? path.join(env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'mumh5-cli', profile),
    password: env[values['password-env'] ?? 'MUMH5_PASSWORD'], trustNew: values['trust-new'] ?? false, serverFingerprint: values['server-fingerprint'],
    tcpOnly: values['tcp-only'] ?? false, channel: target(values.channel), audioIn: values['audio-in'], audioOut: values['audio-out'],
    bitrate: integer(values.bitrate, 40000, 6000, 128000, 'bitrate'), videoIn: values['video-in'], videoOut: values['video-out'],
    width: integer(values.width, 640, 2, 4096, 'width'), height: integer(values.height, 360, 2, 2160, 'height'),
    fps: integer(values.fps, 15, 1, 60, 'fps'), watch: target(values.watch), stun: values.stun ?? [], iceConfig: values['ice-config'], exitOnEof: values['exit-on-eof'] ?? false };
}

export function target(value?: string): string | number | undefined { return value === undefined ? undefined : /^\d+$/.test(value) ? Number(value) : value; }
