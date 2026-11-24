import { MumbleClient } from '../core/client.ts';

// Runs the Mumble keepalive from a worker (see tick.worker.ts). Falls back to page timers if the
// worker cannot start.
export function useWorkerTimers(): void {
  let worker: Worker;
  try {
    worker = new Worker(new URL('./tick.worker.ts', import.meta.url), { type: 'module' });
  } catch (e) {
    console.warn('Timer worker not started:', e);
    return;
  }
  const handlers = new Map<number, () => void>();
  let next = 1;
  worker.onmessage = (e: MessageEvent<number>) => handlers.get(e.data)?.();
  MumbleClient.every = (ms, fn) => {
    const id = next++;
    handlers.set(id, fn);
    worker.postMessage({ id, ms });
    return () => {
      handlers.delete(id);
      worker.postMessage({ id });
    };
  };
}
