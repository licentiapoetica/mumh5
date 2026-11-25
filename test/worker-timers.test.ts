// The keepalive timers: page timers until the worker is ready, and back to them when it fails.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WorkerTimers } from '../src/core/worker-timers.ts';

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
  const worker = new FakeWorker();
  const active = new Set<() => void>();
  const logged: string[] = [];
  const timers = new WorkerTimers(() => worker as unknown as Worker, (_ms, fn) => { active.add(fn); return () => { active.delete(fn); }; }, r => logged.push(r));
  return { worker, active, timers, logged };
}

test('page timers run until the worker is ready, and again after it fails later', () => {
  const { worker, active, timers, logged } = harness();
  let ticks = 0;
  const stop = timers.every(5000, () => ticks++);
  assert.equal(active.size, 1);
  worker.message({ type: 'ready' });
  assert.equal(active.size, 0);
  assert.deepEqual(worker.sent, [{ id: 1, ms: 5000 }]);
  worker.message(1);
  assert.equal(ticks, 1);
  worker.fail();
  assert.equal(worker.terminated, true);
  assert.equal(active.size, 1);
  for (const tick of active) tick();
  assert.equal(ticks, 2);
  assert.equal(logged.length, 1);
  stop();
  assert.equal(active.size, 0);
  timers.dispose();
});

test('a failed post falls back, and cancelled timers are not restarted', () => {
  const { worker, active, timers } = harness();
  const cancel = timers.every(5000, () => {});
  cancel();
  worker.message({ type: 'ready' });
  worker.failPost = true;
  const stop = timers.every(5000, () => {});
  assert.equal(active.size, 1);
  stop();
  assert.equal(active.size, 0);
  timers.dispose();
});

test('a worker that cannot be created still leaves working keepalives', () => {
  let count = 0;
  const timers = new WorkerTimers(() => { throw new Error('Unsupported'); }, (_ms, fn) => { fn(); return () => {}; }, () => {});
  timers.every(5000, () => count++);
  assert.equal(count, 1);
  timers.dispose();
});

test('a worker that never reports ready is replaced by page timers after 3 s', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { active, timers, worker } = harness();
  timers.every(5000, () => {});
  assert.equal(active.size, 1);
  t.mock.timers.tick(3000);
  assert.equal(worker.terminated, true);
  assert.equal(active.size, 1);
  timers.dispose();
});
