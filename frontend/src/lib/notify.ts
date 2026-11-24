import { desktop } from './native.ts';
import { store } from './settings.svelte.ts';

const supported = () => typeof Notification !== 'undefined';

// What the system allows; the desktop app always does, a browser asks the user once
export function notifyPermission(): NotificationPermission | 'unsupported' {
  return supported() ? Notification.permission : 'unsupported';
}

// Must run from a click: browsers ignore or block requests without one
export async function askNotifyPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!supported()) return 'unsupported';
  if (Notification.permission === 'default') await Notification.requestPermission().catch(() => 'default');
  return Notification.permission;
}

// A system notification for a poke. Only while the window is not focused: in front of you
// the popup says it already. Silent, since the poke sound plays anyway. The same tag means a
// flood of pokes replaces one notification instead of stacking up.
export function notifyPoke(title: string, body: string): void {
  if (!store.settings.pokeNotify || !supported() || Notification.permission !== 'granted') return;
  if (document.hasFocus()) return;
  try {
    const n = new Notification(title, { body, tag: 'mumh5-poke', silent: true });
    n.onclick = () => {
      if (desktop) desktop.showWindow();
      else window.focus();
      n.close();
    };
  } catch {
    // Some browsers only allow notifications from a service worker; the popup is still there
  }
}
