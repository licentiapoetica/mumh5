import { mount, unmount } from 'svelte';
import ThemeCreator from '../ui/ThemeCreator.svelte';
import { startHints } from './hints.ts';
import { desktop } from './native.ts';
import { studio } from './theme-studio.svelte.ts';

// The creator in a window of its own, an empty page that runs on this page's state, so the app
// behind it keeps its layout and shows every change at once.
class ThemeWindow {
  private win: Window | null = null;
  private view: ReturnType<typeof mount> | null = null;
  private look: MutationObserver | null = null;
  private listeners: AbortController | null = null;

  /** from: the window of the button, which needs the click to be allowed to open another. */
  show(from: Window = window) {
    if (this.win && !this.win.closed) {
      this.win.focus();
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
    for (const el of document.querySelectorAll<HTMLLinkElement | HTMLStyleElement>('link[rel="stylesheet"], style')) {
      const copy = el.cloneNode(true) as HTMLElement;
      // The empty page has no address of its own to resolve a relative one against
      if (el instanceof HTMLLinkElement) copy.setAttribute('href', el.href);
      doc.head.append(copy);
    }
    // The theme being edited is on the app's root element
    const follow = () => {
      for (const a of [...doc.documentElement.attributes]) doc.documentElement.removeAttribute(a.name);
      for (const a of document.documentElement.attributes) doc.documentElement.setAttribute(a.name, a.value);
    };
    follow();
    this.look = new MutationObserver(follow);
    this.look.observe(document.documentElement, { attributes: true });

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

  close() {
    const w = this.win;
    if (!w) return;
    this.win = null;
    this.listeners?.abort();
    this.listeners = null;
    this.look?.disconnect();
    this.look = null;
    if (this.view) unmount(this.view);
    this.view = null;
    if (!w.closed) w.close();
  }
}

export const themeWindow = new ThemeWindow();
studio.onfinish = () => themeWindow.close();
