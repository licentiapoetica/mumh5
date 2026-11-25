import { describe, test, expect } from 'bun:test';
import { WorkerTimers } from '../src/core/worker-timers.ts';
import { DebugLog, debugLog } from '../src/core/debug-log.ts';
import { MumbleClient } from '../src/core/client.ts';
import { createCodec } from '../src/core/proto.ts';
import type { Transport } from '../src/core/transport.ts';

class FakeWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  sent: unknown[] = [];
  terminated = false;
  failPost = false;
  postMessage(message: unknown) { if (this.failPost) throw new Error('Worker stopped'); this.sent.push(message); }
  terminate() { this.terminated = true; }
  message(data: unknown) { this.onmessage?.({ data } as MessageEvent); }
  fail() { this.onerror?.({ preventDefault() {} } as ErrorEvent); }
}
function harness() {
  const worker = new FakeWorker(); const active = new Set<() => void>();
  const timers = new WorkerTimers(() => worker as unknown as Worker, (_ms, fn) => { active.add(fn); return () => { active.delete(fn); }; });
  return { worker, active, timers };
}
describe('keepalive worker resilience', () => {
  test('keeps page timers until ready and restores them after an asynchronous worker failure', () => {
    const { worker, active, timers } = harness(); let ticks = 0;
    const stop = timers.every(5000, () => ticks++);
    expect(active.size).toBe(1);
    worker.message({ type: 'ready' }); expect(active.size).toBe(0);
    expect(worker.sent).toEqual([{ id: 1, ms: 5000 }]);
    worker.message(1); expect(ticks).toBe(1);
    worker.fail(); expect(worker.terminated).toBe(true); expect(active.size).toBe(1);
    for (const tick of active) tick(); expect(ticks).toBe(2);
    stop(); expect(active.size).toBe(0); timers.dispose();
  });
  test('falls back when posting fails and cancelled timers are not restarted', () => {
    const { worker, active, timers } = harness();
    const cancel = timers.every(5000, () => {}); cancel();
    worker.message({ type: 'ready' }); worker.failPost = true;
    const stop = timers.every(5000, () => {}); expect(active.size).toBe(1);
    stop(); expect(active.size).toBe(0); timers.dispose();
  });
  test('a failed worker constructor does not prevent keepalives', () => {
    let count = 0;
    const timers = new WorkerTimers(() => { throw new Error('Unsupported'); }, (_ms, fn) => { fn(); return () => {}; });
    timers.every(5000, () => count++); expect(count).toBe(1); timers.dispose();
  });
});
test('diagnostics are bounded, live, clearable and exportable', () => {
  const log = new DebugLog(3); let updates = 0; const off = log.subscribe(() => updates++);
  for (let n = 0; n < 5; n++) log.record('warn', 'connection', `drop ${n}`, { code: 1006 });
  expect(log.snapshot().map(e => e.message)).toEqual(['drop 2', 'drop 3', 'drop 4']);
  expect(log.export()).toContain('"code":1006'); expect(updates).toBe(6);
  log.clear(); expect(log.snapshot()).toHaveLength(0); expect(updates).toBe(7); off();
  log.record('info', 'app', 'later'); expect(updates).toBe(7);
});
test('local timeout reason survives a synchronous native transport close and credentials stay out of diagnostics', () => {
  debugLog.clear();
  const transport: Transport = { onData: null, onClose: null, send() {}, close() { this.onClose?.('Connection closed'); } };
  const client = new MumbleClient(createCodec()); const reasons: string[] = [];
  client.on('close', reason => reasons.push(reason));
  client.connect(transport, { username: 'bot', password: 'private-password-sentinel', tokens: ['private-token-sentinel'] });
  client.disconnect('Connection timed out');
  expect(reasons).toEqual(['Connection timed out']);
  expect(debugLog.export()).toContain('Connection timed out');
  expect(debugLog.export()).not.toContain('private-password-sentinel');
  expect(debugLog.export()).not.toContain('private-token-sentinel');
});
