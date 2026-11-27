import { mount, unmount } from 'svelte';
import RolesWindow from '../ui/RolesWindow.svelte';
import { startHints } from './hints.ts';
import { followLook } from './popup-look.ts';
import { desktop } from './native.ts';
import { ui } from './ui.svelte.ts';

type Request = NonNullable<typeof ui.rolesDialog>;

// Roles and members in a window of its own, like Settings: an empty page that runs on this
// page's state, so a saved change shows in the app at once.
class RolesWindowStore {
  private win: Window | null = null;
  private view: ReturnType<typeof mount> | null = null;
  private unfollow: (() => void) | null = null;
  private listeners: AbortController | null = null;
  private props: { jump: Request | null } | null = null;

  /**
   * Where every Roles and members item goes: the window, opened or brought forward. False leaves
   * it to the dialog: a phone has no windows, a pop-up blocker said no, or the E2E keeps it
   * inline (localStorage mumh5.settingsInline, which covers this window too).
   */
  present(request: Request): boolean {
    if (this.win && !this.win.closed) {
      // An open window keeps its unsaved changes; only a named tab or person moves it
      if (request.tab || request.userId != null) this.props!.jump = { ...request };
      this.win.focus();
      return true;
    }
    let inline = false;
    try { inline = localStorage.getItem('mumh5.settingsInline') === '1'; } catch { /* storage blocked */ }
    if (inline || (!desktop && window.innerWidth < 760)) return false;

    const w = window.open('', 'mumh5-roles', 'popup,width=980,height=760');
    if (!w) return false;
    const doc = w.document;
    doc.head.replaceChildren();
    doc.title = 'Roles and members';
    this.unfollow = followLook(doc);

    const box = doc.createElement('div');
    box.style.height = '100%';
    doc.body.replaceChildren(box);
    startHints(doc);

    this.win = w;
    const listeners = this.listeners = new AbortController();
    w.addEventListener('pagehide', () => { if (this.win === w) this.close(); }, { signal: listeners.signal });
    // Without this it would outlive the app, and keep it running with nothing behind it
    window.addEventListener('pagehide', () => this.close(), { signal: listeners.signal });

    const props = $state({ open: { ...request }, jump: null as Request | null, onclose: () => this.close() });
    this.props = props;
    this.view = mount(RolesWindow, { target: box, props });
    w.focus();
    return true;
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
    if (!w.closed) w.close();
  }
}

export const rolesWindow = new RolesWindowStore();
