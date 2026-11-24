// Interval timers for the page. Browsers slow timers of hidden pages a lot more than those of
// workers, and the Mumble keepalive must keep its pace while the phone is locked.
// Typed as a worker, not a window (whose postMessage needs a target origin)
const scope = self as unknown as { postMessage(m: unknown): void; onmessage: ((e: MessageEvent<{ id: number; ms?: number }>) => void) | null };
const timers = new Map<number, ReturnType<typeof setInterval>>();

scope.onmessage = e => {
  const { id, ms } = e.data;
  if (ms) timers.set(id, setInterval(() => scope.postMessage(id), ms));
  else {
    clearInterval(timers.get(id));
    timers.delete(id);
  }
};

scope.postMessage({ type: 'ready' });
