import { MumbleClient } from '../core/client.ts';
import { WorkerTimers } from '../core/worker-timers.ts';

// Runs the Mumble keepalive from a worker (see tick.worker.ts and WorkerTimers)
export function useWorkerTimers(): void {
  const timers = new WorkerTimers(() => new Worker(new URL('./tick.worker.ts', import.meta.url), { type: 'module' }));
  MumbleClient.every = timers.every;
}
