import { app, BrowserWindow, dialog, ipcMain, shell, session, systemPreferences, type WebContents } from 'electron';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { IdentityStore } from './identity-store.ts';
import { describeCert } from './certs.ts';
import * as tray from './tray.ts';
import { fetchLinkPreview } from './link-preview.ts';
import { openTls } from './tls-transport.ts';

const devUrl = process.env.VITE_DEV_SERVER_URL;

let identityStore: IdentityStore | null = null;
const identities = () => (identityStore ??= new IdentityStore(app.getPath('userData')));

// ─── Mumble TLS connections, one per renderer request ─────────────────────────

type Conn = ReturnType<typeof openTls> & { owner: WebContents };
const conns = new Map<string, Conn>();

// ─── Identities (client certificates) ─────────────────────────────────────────

ipcMain.handle('identities:list', () => identities().list());
ipcMain.handle('identities:create', (_e, name: string, email: string) => identities().create(String(name), String(email ?? '')));
ipcMain.handle('identities:import', (_e, bytes: Uint8Array, password: string, name: string) =>
  identities().importP12(new Uint8Array(bytes), String(password ?? ''), String(name ?? '')));
ipcMain.handle('identities:findMumble', () => identities().findMumbleCertificate().then(f => f && { name: f.name }));
ipcMain.handle('identities:importMumble', (_e, name: string) => identities().importFromMumble(String(name ?? '')));
ipcMain.handle('identities:setDefault', (_e, id: string) => identities().setDefault(String(id)));
ipcMain.handle('identities:rename', (_e, id: string, name: string) => identities().rename(String(id), String(name)));
ipcMain.handle('identities:remove', (_e, id: string) => identities().remove(String(id)));
ipcMain.handle('identities:finishSetup', () => identities().finishSetup());

// Saves a password-protected .p12 backup where the user chooses; returns the path or null
ipcMain.handle('identities:export', async (e, id: string, password: string) => {
  const { bytes, name } = await identities().exportP12(String(id), String(password ?? ''));
  const win = BrowserWindow.fromWebContents(e.sender);
  const opts = {
    title: 'Save identity backup',
    defaultPath: path.join(app.getPath('documents'), `${name.replace(/[^\w.-]+/g, '_') || 'identity'}.p12`),
    filters: [{ name: 'PKCS#12 certificate', extensions: ['p12', 'pfx'] }]
  };
  const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
  if (res.canceled || !res.filePath) return null;
  await fs.writeFile(res.filePath, bytes, { mode: 0o600 });
  return res.filePath;
});

// The renderer picks the connection id and subscribes before calling open, so no event can be missed
ipcMain.handle('mumble:open', async (e, connId: string, host: string, port: number, identityId?: string) => {
  if (typeof connId !== 'string' || conns.has(connId)) throw new Error('Invalid connection id');
  const id = await identities().get(identityId);
  const owner = e.sender;
  const emit = (channel: string, ...args: unknown[]) => { if (!owner.isDestroyed()) owner.send(channel, connId, ...args); };
  const conn = openTls(String(host), Number(port) || 64738, id.certPem, id.keyPem, {
    onSecure: info => emit('mumble:secure', info),
    onData: chunk => emit('mumble:data', chunk),
    onClose: reason => { conns.delete(connId); emit('mumble:close', reason); }
  });
  conns.set(connId, Object.assign(conn, { owner }));
  owner.once('destroyed', () => conn.close());
});

ipcMain.on('mumble:send', (e, connId: string, bytes: Uint8Array) => {
  const conn = conns.get(connId);
  if (conn && conn.owner === e.sender) conn.send(bytes);
});

ipcMain.on('mumble:close', (e, connId: string) => {
  const conn = conns.get(connId);
  if (conn && conn.owner === e.sender) conn.close();
});

// Parses DER certificates (e.g. a user's chain from UserStats) for the viewer
ipcMain.handle('certs:describe', (_e, ders: Uint8Array[]) =>
  (Array.isArray(ders) ? ders.slice(0, 8) : []).flatMap(d => { try { return [describeCert(Buffer.from(d))]; } catch { return []; } }));

ipcMain.handle('preview:fetch', (_e, url: string) => fetchLinkPreview(String(url).slice(0, 2048)));

ipcMain.on('tray:update', (_e, state: tray.TrayState) => tray.update(state));

ipcMain.handle('platform:info', () => ({ os: process.platform, osVersion: os.release() }));

// ─── Window ────────────────────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 360,
    minHeight: 480,
    backgroundColor: '#111214',
    title: 'mumh5',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // Voice must play without a click first
      autoplayPolicy: 'no-user-gesture-required',
      // Keep audio and timers running at full speed when the window is in the background
      backgroundThrottling: false
    }
  });

  // Links from chat open in the system browser, never inside the app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (devUrl && url.startsWith(devUrl)) return;
    e.preventDefault();
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
  });

  mainWindow = win;
  win.on('close', e => {
    if (tray.shouldHideOnClose()) {
      e.preventDefault();
      win.hide();
    }
  });
  win.on('show', () => tray.onWindowVisibility());
  win.on('hide', () => tray.onWindowVisibility());
  win.on('closed', () => { if (mainWindow === win) mainWindow = null; });

  if (devUrl) win.loadURL(devUrl);
  else win.loadFile(path.join(__dirname, '../dist/index.html'));
}

app.whenReady().then(async () => {
  // macOS asks once per app for microphone access
  if (process.platform === 'darwin') await systemPreferences.askForMediaAccess('microphone').catch(() => false);
  // YouTube refuses embeds without a referrer (error 153); a file:// app sends none
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['https://www.youtube-nocookie.com/*'] }, (details, cb) => {
    if (!details.requestHeaders.Referer) details.requestHeaders.Referer = 'https://mumh5.app/';
    cb({ requestHeaders: details.requestHeaders });
  });

  // Microphone, camera and screen capture for voice and video; nothing else
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(['media', 'display-capture', 'clipboard-sanitized-write', 'notifications'].includes(permission));
  });
  createWindow();
  await tray.setupTray(() => mainWindow, action => mainWindow?.webContents.send('tray:action', action));
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
