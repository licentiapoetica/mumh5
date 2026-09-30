import { app, BrowserWindow, Menu, Tray, nativeImage } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';

// State the renderer reports; the tray mirrors it
export interface TrayState {
  icon: string;             // PNG data URL drawn by the renderer
  tooltip: string;
  connected: boolean;
  server: string;
  muted: boolean;
  deafened: boolean;
  mode: 'vad' | 'ptt' | 'continuous';
}

let tray: Tray | null = null;
let state: TrayState | null = null;
let closeToTray = true;
let quitting = false;
const prefsFile = () => path.join(app.getPath('userData'), 'tray.json');

export async function setupTray(getWindow: () => BrowserWindow | null, send: (action: string) => void): Promise<void> {
  try { closeToTray = JSON.parse(await fs.readFile(prefsFile(), 'utf8')).closeToTray !== false; } catch { /* defaults */ }

  const show = () => {
    const win = getWindow();
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  };

  const rebuild = () => {
    if (!tray || !state) return;
    const win = getWindow();
    const s = state;
    const menu = Menu.buildFromTemplate([
      { label: win?.isVisible() ? 'Hide mumh5' : 'Show mumh5', click: () => (win?.isVisible() ? win.hide() : show()) },
      { type: 'separator' },
      { label: s.connected ? `Connected: ${s.server}` : 'Not connected', enabled: false },
      { label: 'Mute', type: 'checkbox', checked: s.muted, enabled: s.connected, click: () => send('toggle-mute') },
      { label: 'Deafen', type: 'checkbox', checked: s.deafened, enabled: s.connected, click: () => send('toggle-deafen') },
      {
        label: 'Transmit', submenu: [
          { label: 'Voice activity', type: 'radio', checked: s.mode === 'vad', click: () => send('mode:vad') },
          { label: 'Push to talk', type: 'radio', checked: s.mode === 'ptt', click: () => send('mode:ptt') },
          { label: 'Always on', type: 'radio', checked: s.mode === 'continuous', click: () => send('mode:continuous') }
        ]
      },
      { label: 'Voice settings...', click: () => { show(); send('settings'); } },
      { label: 'Disconnect', enabled: s.connected, click: () => send('disconnect') },
      { type: 'separator' },
      {
        label: 'Close to tray', type: 'checkbox', checked: closeToTray, click: item => {
          closeToTray = item.checked;
          fs.writeFile(prefsFile(), JSON.stringify({ closeToTray })).catch(() => {});
        }
      },
      { label: 'Quit mumh5', click: () => { quitting = true; app.quit(); } }
    ]);
    tray.setContextMenu(menu);
    // Inspection hook for the end-to-end tests (tray menus cannot be clicked by automation)
    (globalThis as any).__mumh5Tray = {
      state: { ...s, icon: s.icon.slice(0, 22) },
      tooltip: s.tooltip,
      items: menu.items.map(i => ({ label: i.label, checked: i.checked, enabled: i.enabled })),
      click: (label: string) => { const item = menu.items.find(i => i.label === label); item?.click(undefined, getWindow() ?? undefined, getWindow()?.webContents); }
    };
  };

  app.on('before-quit', () => { quitting = true; });

  // Called for every state change from the renderer
  update = (next: TrayState) => {
    state = next;
    const image = nativeImage.createFromDataURL(next.icon);
    if (!tray) {
      tray = new Tray(image);
      tray.on('click', show);
    } else {
      tray.setImage(image);
    }
    tray.setToolTip(next.tooltip);
    rebuild();
  };

  // Keep the Show/Hide label right
  onWindowVisibility = rebuild;
}

export let update: (s: TrayState) => void = () => {};
export let onWindowVisibility: () => void = () => {};

// Closing the window hides it while the tray is there, unless the user quits
export function shouldHideOnClose(): boolean {
  return !!tray && closeToTray && !quitting && process.platform !== 'darwin';
}
