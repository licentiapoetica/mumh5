import { MumbleClient } from '../core/client.ts';
import { WorkerTimers } from '../core/worker-timers.ts';
import workerUrl from './tick.worker.ts?worker&url';

export function useWorkerTimers(): void {
  const timers = new WorkerTimers(() => new Worker(new URL(workerUrl, document.baseURI), { type: 'module' }));
  MumbleClient.every = timers.every;
}
