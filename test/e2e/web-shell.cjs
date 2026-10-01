// A bare browser window for the web E2E: no preload, so the page runs as it would in a browser.
const { app, BrowserWindow, desktopCapturer, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, cb) => cb(true));
  // Electron would open a save dialog; a browser saves to the downloads folder
  session.defaultSession.on('will-download', (_e, item) => {
    const file = path.join(process.env.MUMH5_DOWNLOADS, item.getFilename());
    item.setSavePath(file);
    item.once('done', (_ev, state) => { if (state === 'completed') fs.writeFileSync(file + '.done', ''); });
  });
  // Stands in for the browser's own "choose what to share" dialog: always the first screen
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    let sources = [];
    for (let i = 0; i < 10 && !sources.length; i++) sources = await desktopCapturer.getSources({ types: ['screen'] });
    try { callback(sources.length ? { video: sources[0] } : {}); } catch { /* refused */ }
  });
  const win = new BrowserWindow({ width: 1280, height: 800, webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false } });
  win.loadURL(process.env.MUMH5_WEB_URL);
});
app.on('window-all-closed', () => app.quit());
