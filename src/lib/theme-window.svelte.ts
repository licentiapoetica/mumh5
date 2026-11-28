import { mount, unmount } from 'svelte';
import ThemeCreator from '../ui/ThemeCreator.svelte';
import { startHints } from './hints.ts';
import { followLook, raiseWindow } from './popup-look.ts';
import { desktop } from './native.ts';
import { studio } from './theme-studio.svelte.ts';

// The creator in a window of its own, an empty page that runs on this page's state, so the app
// behind it keeps its layout and shows every change at once.
class ThemeWindow {
  private win: Window | null = null;
  private view: ReturnType<typeof mount> | null = null;
  private unfollow: (() => void) | null = null;
  private listeners: AbortController | null = null;

  /** from: the window of the button, which needs the click to be allowed to open another. */
  show(from: Window = window) {
    if (this.win && !this.win.closed) {
      raiseWindow(this.win, 'mumh5-themes');
      return;
    }
    // The desktop app only allows this window from its main page. A phone has no windows.
    const w = desktop ? window.open('', 'mumh5-themes', 'popup,width=460,height=820')
      : from.innerWidth >= 760 ? from.open('', 'mumh5-themes', 'popup,width=460,height=820') : null;
    if (!w) {
      studio.place = 'inline';
      return;
    }
    const doc = w.document;
    doc.head.replaceChildren();
    doc.title = 'Theme creator';
    this.unfollow = followLook(doc);

    const box = doc.createElement('div');
    box.style.height = '100%';
    doc.body.replaceChildren(box);
    startHints(doc);

    this.win = w;
    const listeners = this.listeners = new AbortController();
    w.addEventListener('pagehide', () => {
      if (this.win !== w) return;
      this.close();
      studio.windowClosed();
    }, { signal: listeners.signal });
    // Without this it would outlive the app, and keep it running with nothing behind it
    window.addEventListener('pagehide', () => this.close(), { signal: listeners.signal });

    this.view = mount(ThemeCreator, { target: box });
    studio.place = 'window';
    w.focus();
  }

  /** Starts something in the creator from a button; reads the button's window first, since
   *  starting closes a Settings dialog and with it the button. */
  openFrom(button: HTMLElement, start: () => void) {
    const from = button.ownerDocument.defaultView ?? window;
    start();
    this.show(from);
  }

  close() {
    const w = this.win;
    if (!w) return;
    this.win = null;
    this.listeners?.abort();
    this.listeners = null;
    this.unfollow?.();
    this.unfollow = null;
    if (this.view) unmount(this.view);
    this.view = null;
    if (!w.closed) w.close();
  }
}

export const themeWindow = new ThemeWindow();
studio.onfinish = () => themeWindow.close();
