import { createReadStream, createWriteStream, type WriteStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { finished } from 'node:stream/promises';
import type { VideoFrame } from './video.ts';

export async function binaryOutput(file: string): Promise<WriteStream> {
  const existing = await stat(file).catch((e: NodeJS.ErrnoException) => { if (e.code !== 'ENOENT') throw e; return undefined; });
  return createWriteStream(file, { flags: existing?.isFIFO() ? 'w' : 'wx' });
}

export async function* frames(file: string, size: number, signal: AbortSignal): AsyncGenerator<Buffer> {
  if (!Number.isInteger(size) || size <= 0 || size > 16 * 1024 * 1024) throw new Error('Invalid frame size');
  const input = createReadStream(file, { highWaterMark: size, signal });
  let rest = Buffer.alloc(0);
  try {
    for await (const chunk of input) {
      rest = Buffer.concat([rest, chunk as Buffer]);
      while (rest.length >= size) { yield rest.subarray(0, size); rest = rest.subarray(size); }
    }
    if (rest.length) throw new Error(`Incomplete raw frame at end of ${file}`);
  } finally { input.destroy(); }
}

export async function pumpVideo(file: string, size: number, fps: number, push: (frame: Buffer) => void, signal: AbortSignal): Promise<void> {
  let next = performance.now();
  for await (const frame of frames(file, size, signal)) {
    if (signal.aborted) return;
    await delay(Math.max(0, next - performance.now()), undefined, { signal });
    push(frame); next = Math.max(next + 1000 / fps, performance.now());
  }
}

export class VideoFiles {
  private directory: string;
  private fps: number;
  private output?: WriteStream;
  private shape = '';
  private blocked = false;
  private serial = 0;
  private pending = new Set<Promise<void>>();
  private notify: (event: { session: number; width: number; height: number; file: string }) => void;
  private fail: (error: Error) => void;

  constructor(directory: string, fps: number, notify: VideoFiles['notify'], fail: VideoFiles['fail']) {
    this.directory = directory; this.fps = fps; this.notify = notify; this.fail = fail;
  }
  async prepare(): Promise<void> { await mkdir(this.directory, { recursive: true }); }

  push(frame: VideoFrame): void {
    const shape = `${frame.session}:${frame.width}:${frame.height}`;
    if (shape !== this.shape) {
      if (this.pending.size >= 8) return;
      this.output?.end();
      const file = path.join(this.directory, `video-${frame.session}-${Date.now()}-${this.serial++}.y4m`);
      const output = createWriteStream(file, { flags: 'wx' });
      this.output = output; this.shape = shape; this.blocked = false;
      const done = finished(output).catch(this.fail);
      this.pending.add(done); void done.then(() => this.pending.delete(done));
      output.on('error', this.fail);
      output.on('drain', () => { if (this.output === output) this.blocked = false; });
      output.write(`YUV4MPEG2 W${frame.width} H${frame.height} F${this.fps}:1 Ip A1:1 C420jpeg\n`);
      this.notify({ session: frame.session, width: frame.width, height: frame.height, file });
    }
    if (this.blocked) return;
    this.output!.write('FRAME\n');
    this.blocked = !this.output!.write(frame.data);
  }

  async close(): Promise<void> { this.output?.end(); await Promise.all(this.pending); }
}
