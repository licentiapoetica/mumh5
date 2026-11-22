import type { Readable } from 'node:stream';

// Consume commands sequentially so stdin backpressure also bounds pending work.
export async function* commandLines(input: Readable, limit = 8 * 1024 * 1024): AsyncGenerator<string> {
  let parts: Buffer[] = [], length = 0;
  for await (const bytes of input) {
    const chunk = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    let start = 0;
    while (start < chunk.length) {
      const newline = chunk.indexOf(10, start), end = newline === -1 ? chunk.length : newline;
      const part = chunk.subarray(start, end); length += part.length;
      if (length > limit) throw new Error('Command exceeds 8 MiB');
      parts.push(part);
      if (newline === -1) break;
      yield Buffer.concat(parts, length).toString('utf8').replace(/\r$/, '');
      parts = []; length = 0; start = newline + 1;
    }
  }
  if (length) yield Buffer.concat(parts, length).toString('utf8').replace(/\r$/, '');
}
