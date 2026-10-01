// Sound for screen sharing on Linux. Chromium cannot capture what other programs play, so a
// virtual microphone is created in PipeWire and the chosen programs' output is linked into it;
// the renderer then records that microphone like any other. Works through PipeWire's command
// line tools (pw-cli, pw-dump, pw-link, pw-mon), no native module.
import { execFile, spawn, type ChildProcess } from 'node:child_process';

export const VIRTUAL_MIC = 'mumh5-share-audio';
export const VIRTUAL_MIC_LABEL = 'mumh5 screen share audio';

// What to capture: everything except this app's own sound, or one program
export type AudioTarget = { kind: 'all' } | { kind: 'app'; name: string };

interface PwObject { id: number; type: string; info?: { direction?: string; props?: Record<string, any> } }

function run(cmd: string, args: string[], maxBuffer = 64 * 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer, timeout: 5000 }, (err, stdout) => err ? reject(err) : resolve(stdout));
  });
}

const dump = async (): Promise<PwObject[]> => JSON.parse(await run('pw-dump', []));

// A playing program: its name and process come from the stream itself or from the client that owns it
function describe(node: PwObject, byId: Map<number, PwObject>): { name: string; pid: number | null } {
  const p = node.info?.props ?? {};
  const client = byId.get(p['client.id'])?.info?.props ?? {};
  return {
    name: String(p['application.name'] ?? client['application.name'] ?? p['node.name'] ?? ''),
    pid: Number(p['application.process.id'] ?? client['application.process.id']) || null
  };
}

const outputs = (objects: PwObject[]) =>
  objects.filter(o => o.type === 'PipeWire:Interface:Node' && o.info?.props?.['media.class'] === 'Stream/Output/Audio');

// Programs currently playing sound, without this app
export function audioApps(objects: PwObject[], ownPids: number[]): string[] {
  const byId = new Map(objects.map(o => [o.id, o]));
  const names = new Set<string>();
  for (const node of outputs(objects)) {
    const d = describe(node, byId);
    if (d.name && !(d.pid && ownPids.includes(d.pid))) names.add(d.name);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

// Which output ports to connect to which inputs of the virtual microphone, and which existing
// links to remove. This app's own playback is never linked: the people watching are in the same
// voice channel and would hear themselves back.
export function planLinks(objects: PwObject[], target: AudioTarget, ownPids: number[]): { add: [number, number][]; remove: number[] } {
  const byId = new Map(objects.map(o => [o.id, o]));
  const mic = objects.find(o => o.type === 'PipeWire:Interface:Node' && o.info?.props?.['node.name'] === VIRTUAL_MIC);
  if (!mic) return { add: [], remove: [] };
  const ports = objects.filter(o => o.type === 'PipeWire:Interface:Port');
  const micIn = ports.filter(p => p.info?.props?.['node.id'] === mic.id && p.info?.direction === 'input');
  const input = (channel: string) => micIn.find(p => p.info?.props?.['audio.channel'] === channel)?.id;
  const left = input('FL'), right = input('FR');
  if (left == null || right == null) return { add: [], remove: [] };

  const wanted = new Set<string>();
  for (const node of outputs(objects)) {
    const d = describe(node, byId);
    if (d.pid && ownPids.includes(d.pid)) continue;
    if (target.kind === 'app' && d.name !== target.name) continue;
    for (const port of ports) {
      if (port.info?.props?.['node.id'] !== node.id || port.info?.direction !== 'output') continue;
      const channel = port.info.props['audio.channel'];
      // Mono programs go to both sides; surround beyond the front pair is left out
      if (channel === 'FL' || channel === 'MONO') wanted.add(`${port.id}:${left}`);
      if (channel === 'FR' || channel === 'MONO') wanted.add(`${port.id}:${right}`);
    }
  }
  const remove: number[] = [];
  for (const link of objects.filter(o => o.type === 'PipeWire:Interface:Link')) {
    const info = link.info as any;
    if (info?.['input-node-id'] !== mic.id) continue;
    const key = `${info['output-port-id']}:${info['input-port-id']}`;
    if (wanted.has(key)) wanted.delete(key);
    else remove.push(link.id);
  }
  return { add: [...wanted].map(k => k.split(':').map(Number) as [number, number]), remove };
}

// Whether PipeWire and its tools are there
export async function pipewireAvailable(): Promise<boolean> {
  if (process.platform !== 'linux') return false;
  try { await dump(); await run('pw-link', ['--version']); await run('pw-cli', ['--version']); return true; } catch { return false; }
}

export class ShareAudio {
  private target: AudioTarget | null = null;
  private monitor: ChildProcess | null = null;
  private debounce: ReturnType<typeof setTimeout> | undefined;
  private busy: Promise<void> = Promise.resolve();
  private ownPids: () => number[];

  constructor(ownPids: () => number[]) { this.ownPids = ownPids; }

  async apps(): Promise<string[]> {
    return audioApps(await dump(), this.ownPids());
  }

  // Creates the microphone, links the target and keeps the links right while programs come and go
  async start(target: AudioTarget): Promise<void> {
    this.target = target;
    if (!(await dump()).some(o => o.info?.props?.['node.name'] === VIRTUAL_MIC)) {
      await run('pw-cli', ['create-node', 'adapter',
        `{ factory.name=support.null-audio-sink node.name=${VIRTUAL_MIC} node.description="${VIRTUAL_MIC_LABEL}" media.class=Audio/Source/Virtual object.linger=1 audio.position=[FL,FR] audio.rate=48000 audio.channels=2 }`]);
      // Give PipeWire a moment to publish the node and its ports
      for (let i = 0; i < 20; i++) {
        const objects = await dump();
        const mic = objects.find(o => o.info?.props?.['node.name'] === VIRTUAL_MIC);
        if (mic && objects.some(o => o.type === 'PipeWire:Interface:Port' && o.info?.props?.['node.id'] === mic.id)) break;
        await new Promise(r => setTimeout(r, 100));
      }
    }
    await this.relink();
    if (!this.monitor) {
      const proc = spawn('pw-mon', ['--color=never'], { stdio: ['ignore', 'pipe', 'ignore'] });
      this.monitor = proc;
      proc.stdout!.on('data', (data: Buffer) => {
        const text = data.toString();
        if (!text.includes('added') && !text.includes('removed')) return;
        // Starting a program fires many events at once
        clearTimeout(this.debounce);
        this.debounce = setTimeout(() => this.relink().catch(() => {}), 400);
      });
      proc.on('error', () => { if (this.monitor === proc) this.monitor = null; });
      proc.on('exit', () => { if (this.monitor === proc) this.monitor = null; });
    }
  }

  // One at a time, so two graph changes cannot interleave their link commands
  private relink(): Promise<void> {
    const next = this.busy.then(async () => {
      if (!this.target) return;
      const { add, remove } = planLinks(await dump(), this.target, this.ownPids());
      for (const id of remove) await run('pw-link', ['-d', String(id)]).catch(() => {});
      // "File exists" when a link is already there is fine
      for (const [out, input] of add) await run('pw-link', [String(out), String(input)]).catch(() => {});
    });
    this.busy = next.catch(() => {});
    return next;
  }

  async stop(): Promise<void> {
    this.target = null;
    clearTimeout(this.debounce);
    this.monitor?.kill();
    this.monitor = null;
    await this.busy;
    try {
      for (const o of await dump()) {
        if (o.type === 'PipeWire:Interface:Node' && o.info?.props?.['node.name'] === VIRTUAL_MIC) await run('pw-cli', ['destroy', String(o.id)]).catch(() => {});
      }
    } catch { /* PipeWire gone */ }
  }
}
