import { mount, unmount } from 'svelte';
import SettingsWindow from '../ui/SettingsWindow.svelte';
import { startHints } from './hints.ts';
import { ui } from './ui.svelte.ts';

type Tab = typeof ui.settingsTab;

// Settings in a window of its own, beside the app it changes. The window is an empty page that
// runs on this page's state, so every change shows in the app at once and nothing needs syncing.
class SettingsWindowStore {
  isOpen = $state(false);
  // False once a window could not be opened (a pop-up blocker); Settings then shows in the app
  canOpen = $state(true);
  // Whether the person last used that window: a question from Settings is asked where they are
  private usedLast = false;
  promptHere = $derived(!!ui.prompt && this.isOpen && this.usedLast);

  private win: Window | null = null;
  private view: ReturnType<typeof mount> | null = null;
  private look: MutationObserver | null = null;
  private listeners: AbortController | null = null;
  private props: { jump: { tab: Tab } | null } | null = null;

  /** False when the window could not be opened (a pop-up blocker). */
  open(tab: Tab): boolean {
    if (this.win && !this.win.closed) {
      this.show(tab);
      return true;
    }
    const w = window.open('', 'mumh5-settings', 'popup,width=920,height=820');
    if (!w) {
      this.canOpen = false;
      return false;
    }
    const doc = w.document;
    doc.head.replaceChildren();
    doc.title = 'Settings';
    for (const el of document.querySelectorAll<HTMLLinkElement | HTMLStyleElement>('link[rel="stylesheet"], style')) {
      const copy = el.cloneNode(true) as HTMLElement;
      // The empty page has no address of its own to resolve a relative one against
      if (el instanceof HTMLLinkElement) copy.setAttribute('href', el.href);
      doc.head.append(copy);
    }
    // The color scheme and rounded corners are attributes of the root element
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
    this.usedLast = true;
    const listeners = this.listeners = new AbortController();
    const { signal } = listeners;
    for (const type of ['pointerdown', 'keydown']) {
      doc.addEventListener(type, () => { this.usedLast = true; }, { capture: true, signal });
      document.addEventListener(type, () => { this.usedLast = false; }, { capture: true, signal });
    }
    w.addEventListener('pagehide', () => { if (this.win === w) this.close(); }, { signal });
    // Without this it would outlive the app, and keep it running with nothing behind it
    window.addEventListener('pagehide', () => this.close(), { signal });

    const props = $state({ tab, jump: null as { tab: Tab } | null, onclose: () => this.close(), asking: () => this.promptHere });
    this.props = props;
    this.view = mount(SettingsWindow, { target: box, props });
    this.isOpen = true;
    w.focus();
    return true;
  }

  /** Brings the window forward, on a section if one is named. Does nothing while it is closed. */
  show(tab?: Tab) {
    if (!this.win || this.win.closed) return;
    if (tab && this.props) this.props.jump = { tab };
    this.win.focus();
  }

  close() {
    const w = this.win;
    if (!w) return;
    this.win = null;
    this.props = null;
    this.listeners?.abort();
    this.listeners = null;
    this.look?.disconnect();
    this.look = null;
    if (this.view) unmount(this.view);
    this.view = null;
    this.isOpen = false;
    if (!w.closed) w.close();
  }
}

export const settingsWindow = new SettingsWindowStore();
