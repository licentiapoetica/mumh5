import { debugLog } from './debug-log.ts';
type Interval = (ms: number, fn: () => void) => () => void;
const pageInterval: Interval = (ms, fn) => { const id = setInterval(fn, ms); return () => clearInterval(id); };
/** Page timers stay active until the worker acknowledges startup, and resume if it fails. */
export class WorkerTimers {
  private worker: Worker | null = null;
  private ready = false;
  private next = 1;
  private handlers = new Map<number, { ms: number; fn: () => void; stop?: () => void }>();
  private startup: ReturnType<typeof setTimeout> | undefined;
  constructor(create: () => Worker, private interval: Interval = pageInterval) {
    try {
      this.worker = create();
      this.worker.onmessage = (e: MessageEvent) => {
        if (e.data?.type === 'ready') {
          if (!this.worker || this.ready) return;
          clearTimeout(this.startup); this.ready = true;
          debugLog.record('info', 'keepalive', 'Background timer worker ready');
          for (const [id, timer] of this.handlers) {
            timer.stop?.(); timer.stop = undefined;
            if (!this.post({ id, ms: timer.ms })) break;
          }
        } else if (this.ready && typeof e.data === 'number') this.handlers.get(e.data)?.fn();
      };
      this.worker.onerror = e => { e.preventDefault(); this.fallback('Worker failed to load or stopped'); };
      this.worker.onmessageerror = () => this.fallback('Worker message could not be read');
      this.startup = setTimeout(() => this.fallback('Worker startup timed out'), 3000);
    } catch { this.fallback('Worker could not be created'); }
  }
  readonly every: Interval = (ms, fn) => {
    const id = this.next++;
    const timer = { ms, fn, stop: undefined as (() => void) | undefined };
    this.handlers.set(id, timer);
    if (this.ready && this.worker) this.post({ id, ms });
    else timer.stop = this.interval(ms, fn);
    return () => { timer.stop?.(); this.handlers.delete(id); if (this.ready) this.post({ id }); };
  };
  private post(message: { id: number; ms?: number }): boolean {
    try { this.worker?.postMessage(message); return true; }
    catch { this.fallback('Could not send timer request'); return false; }
  }
  private fallback(reason: string): void {
    clearTimeout(this.startup); this.ready = false; this.worker?.terminate(); this.worker = null;
    debugLog.record('warn', 'keepalive', reason, { fallback: 'page timers' });
    for (const timer of this.handlers.values()) timer.stop ??= this.interval(timer.ms, timer.fn);
  }
  dispose(): void { clearTimeout(this.startup); this.worker?.terminate(); this.worker = null; for (const timer of this.handlers.values()) timer.stop?.(); this.handlers.clear(); }
}
