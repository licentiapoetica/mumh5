// Interval timers run by a worker, so hidden tabs keep the Mumble keepalive (browsers throttle page
// timers there). Page timers stay active until the worker says it is ready, and come back if it
// fails later: a worker script that does not load (404, CSP, a subpath) fails asynchronously, after
// `new Worker` returned, and without this the keepalive would stop and the server drop us.
export type Interval = (ms: number, fn: () => void) => () => void;
const pageInterval: Interval = (ms, fn) => { const id = setInterval(fn, ms); return () => clearInterval(id); };

export class WorkerTimers {
  private worker: Worker | null = null;
  private ready = false;
  private next = 1;
  private handlers = new Map<number, { ms: number; fn: () => void; stop?: () => void }>();
  private startup: ReturnType<typeof setTimeout> | undefined;
  private interval: Interval;
  private log: (reason: string) => void;

  constructor(create: () => Worker, interval: Interval = pageInterval, log: (reason: string) => void = r => console.warn('Timer worker:', r)) {
    this.interval = interval;
    this.log = log;
    try {
      this.worker = create();
      this.worker.onmessage = (e: MessageEvent) => {
        if (e.data?.type === 'ready') {
          if (!this.worker || this.ready) return;
          clearTimeout(this.startup);
          this.ready = true;
          for (const [id, timer] of this.handlers) {
            timer.stop?.();
            timer.stop = undefined;
            if (!this.post({ id, ms: timer.ms })) break;
          }
        } else if (this.ready && typeof e.data === 'number') this.handlers.get(e.data)?.fn();
      };
      this.worker.onerror = e => { e.preventDefault(); this.fallback('failed to load or stopped'); };
      this.worker.onmessageerror = () => this.fallback('message could not be read');
      this.startup = setTimeout(() => this.fallback('did not start in time'), 3000);
    } catch { this.fallback('could not be created'); }
  }

  readonly every: Interval = (ms, fn) => {
    const id = this.next++;
    const timer: { ms: number; fn: () => void; stop?: () => void } = { ms, fn };
    this.handlers.set(id, timer);
    if (this.ready && this.worker) this.post({ id, ms });
    else timer.stop = this.interval(ms, fn);
    return () => { timer.stop?.(); this.handlers.delete(id); if (this.ready) this.post({ id }); };
  };

  private post(message: { id: number; ms?: number }): boolean {
    try { this.worker?.postMessage(message); return true; } catch { this.fallback('could not send a timer request'); return false; }
  }

  private fallback(reason: string): void {
    clearTimeout(this.startup);
    this.ready = false;
    this.worker?.terminate();
    this.worker = null;
    this.log(`${reason}; using page timers`);
    for (const timer of this.handlers.values()) timer.stop ??= this.interval(timer.ms, timer.fn);
  }

  dispose(): void {
    clearTimeout(this.startup);
    this.worker?.terminate();
    this.worker = null;
    for (const timer of this.handlers.values()) timer.stop?.();
    this.handlers.clear();
  }
}
