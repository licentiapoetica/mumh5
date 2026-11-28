import { mount, unmount } from 'svelte';
import SettingsWindow from '../ui/SettingsWindow.svelte';
import { startHints } from './hints.ts';
import { followLook, raiseWindow } from './popup-look.ts';
import { fixSelects } from './popup-select.ts';
import { desktop } from './native.ts';
import { ui } from './ui.svelte.ts';

type Tab = typeof ui.settingsTab;

// Settings in a window of its own, beside the app it changes. The window is an empty page that
// runs on this page's state, so every change shows in the app at once and nothing needs syncing.
class SettingsWindowStore {
  isOpen = $state(false);
  // Whether the person last used that window: a question from Settings is asked where they are
  private usedLast = false;
  promptHere = $derived(!!ui.prompt && this.isOpen && this.usedLast);

  private win: Window | null = null;
  private view: ReturnType<typeof mount> | null = null;
  private unfollow: (() => void) | null = null;
  private listeners: AbortController | null = null;
  private props: { jump: { tab: Tab } | null } | null = null;

  /**
   * Where every Settings button goes: the window, opened or brought forward. False leaves it to
   * the dialog: a phone has no windows, a pop-up blocker said no, or the E2E keeps it inline
   * (localStorage mumh5.settingsInline). Voice is the tab every plain Settings button asks for,
   * so it does not move an open window off the section in use.
   */
  present(tab: Tab): boolean {
    if (this.win && !this.win.closed) {
      this.show(tab === 'voice' ? undefined : tab);
      return true;
    }
    let inline = false;
    try { inline = localStorage.getItem('mumh5.settingsInline') === '1'; } catch { /* storage blocked */ }
    if (inline || (!desktop && window.innerWidth < 760)) return false;
    return this.open(tab);
  }

  /** False when the window could not be opened (a pop-up blocker). */
  open(tab: Tab): boolean {
    if (this.win && !this.win.closed) {
      this.show(tab);
      return true;
    }
    const w = window.open('', 'mumh5-settings', 'popup,width=920,height=820');
    if (!w) return false;
    const doc = w.document;
    doc.head.replaceChildren();
    doc.title = 'Settings';
    this.unfollow = followLook(doc);

    const box = doc.createElement('div');
    box.style.height = '100%';
    doc.body.replaceChildren(box);
    startHints(doc);

    this.win = w;
    this.usedLast = true;
    const listeners = this.listeners = new AbortController();
    const { signal } = listeners;
    fixSelects(doc, signal);
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
    raiseWindow(this.win, 'mumh5-settings');
  }

  close() {
    const w = this.win;
    if (!w) return;
    this.win = null;
    this.props = null;
    this.listeners?.abort();
    this.listeners = null;
    this.unfollow?.();
    this.unfollow = null;
    if (this.view) unmount(this.view);
    this.view = null;
    this.isOpen = false;
    if (!w.closed) w.close();
  }
}

export const settingsWindow = new SettingsWindowStore();
