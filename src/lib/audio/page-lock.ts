// A page that holds a Web Lock is not frozen by Chromium when it is hidden. Without one, a hidden
// page (a phone with the screen off, a background tab) is frozen after about a minute: no timers,
// no audio worklet, no Mumble pings, and the server drops the connection. Held only while voice runs.
let wanted = false;
let release: (() => void) | null = null;

export function holdPageLock(): void {
  wanted = true;
  if (release || typeof navigator === 'undefined' || !navigator.locks) return;
  navigator.locks.request('mumh5-voice', () => new Promise<void>(resolve => {
    if (!wanted) return resolve();
    release = resolve;
  })).catch(() => { release = null; });
}

export function releasePageLock(): void {
  wanted = false;
  release?.();
  release = null;
}
