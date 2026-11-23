import { contextBridge, ipcRenderer } from 'electron';

type Listener = (connId: string, ...args: any[]) => void;
const listeners = {
  secure: new Set<Listener>(), data: new Set<Listener>(), close: new Set<Listener>(),
  udpVoice: new Set<Listener>(), udpState: new Set<Listener>(), udpResync: new Set<Listener>(), relayClose: new Set<Listener>()
};
for (const key of Object.keys(listeners) as (keyof typeof listeners)[]) {
  ipcRenderer.on(`mumble:${key}`, (_e, connId: string, ...args: any[]) => {
    for (const fn of listeners[key]) fn(connId, ...args);
  });
}

// The only native surface the renderer gets
contextBridge.exposeInMainWorld('mumh5Native', {
  platformInfo: () => ipcRenderer.invoke('platform:info'),
  // host:port of a test server to add and join at start (scripts/test-client.mjs sets it)
  testServer: process.env.MUMH5_TEST_SERVER ?? null,
  // Synchronous: the settings store reads these while the page loads
  savedState: {
    sync: (key: string, local: string | null, merge: boolean) => ipcRenderer.sendSync('state:sync', key, local, merge),
    write: (key: string, raw: string) => ipcRenderer.sendSync('state:write', key, raw)
  },
  sounds: {
    load: () => ipcRenderer.invoke('sounds:load'),
    save: (settings: unknown) => ipcRenderer.invoke('sounds:save', settings),
    read: (key: string) => ipcRenderer.invoke('sounds:read', key),
    write: (key: string, bytes: Uint8Array) => ipcRenderer.invoke('sounds:write', key, bytes),
    remove: (key: string) => ipcRenderer.invoke('sounds:remove', key)
  },
  updateTray: (state: unknown) => ipcRenderer.send('tray:update', state),
  attention: () => ipcRenderer.send('window:attention'),
  showWindow: () => ipcRenderer.send('window:show'),
  // Calls fn with the current state, then on every change; returns the unsubscribe
  onWindowShown: (fn: (shown: boolean) => void) => {
    const listener = (_e: unknown, shown: boolean) => fn(shown);
    ipcRenderer.on('window:shown', listener);
    ipcRenderer.invoke('window:isShown').then(fn);
    return () => { ipcRenderer.removeListener('window:shown', listener); };
  },
  linkPreview: (url: string) => ipcRenderer.invoke('preview:fetch', url),
  publicServers: (url: string) => ipcRenderer.invoke('publist:fetch', url),
  pingServer: (host: string, port: number) => ipcRenderer.invoke('publist:ping', host, port),
  onContextMenu: (fn: (params: unknown) => void) => { ipcRenderer.on('context-menu', (_e, p) => fn(p)); },
  editAction: (action: string, arg?: unknown) => ipcRenderer.send('edit:action', action, arg),
  onTrayAction: (fn: (action: string) => void) => { ipcRenderer.on('tray:action', (_e, a: string) => fn(a)); },
  screenSources: (thumbnails: boolean) => ipcRenderer.invoke('share:sources', !!thumbnails),
  pickScreenSource: (id: string) => ipcRenderer.send('share:pick', id),
  shareInfo: () => ipcRenderer.invoke('share:info'),
  canPickColor: () => ipcRenderer.invoke('color:canPick'),
  pickColor: () => ipcRenderer.invoke('color:pick'),
  shareAudioApps: () => ipcRenderer.invoke('share:audioApps'),
  shareAudioStart: (target: unknown) => ipcRenderer.invoke('share:audioStart', target),
  shareAudioStop: () => ipcRenderer.invoke('share:audioStop'),
  describeCerts: (ders: Uint8Array[]) => ipcRenderer.invoke('certs:describe', ders),
  identities: {
    list: () => ipcRenderer.invoke('identities:list'),
    create: (name: string, email: string) => ipcRenderer.invoke('identities:create', name, email),
    importP12: (bytes: Uint8Array, password: string, name: string) => ipcRenderer.invoke('identities:import', bytes, password, name),
    findMumble: () => ipcRenderer.invoke('identities:findMumble'),
    importMumble: (name: string) => ipcRenderer.invoke('identities:importMumble', name),
    exportP12: (id: string, password: string) => ipcRenderer.invoke('identities:export', id, password),
    setDefault: (id: string) => ipcRenderer.invoke('identities:setDefault', id),
    rename: (id: string, name: string) => ipcRenderer.invoke('identities:rename', id, name),
    remove: (id: string) => ipcRenderer.invoke('identities:remove', id),
    finishSetup: () => ipcRenderer.invoke('identities:finishSetup')
  },
  open: (connId: string, host: string, port: number, identityId?: string) => ipcRenderer.invoke('mumble:open', connId, host, port, identityId),
  send: (connId: string, bytes: Uint8Array) => ipcRenderer.send('mumble:send', connId, bytes),
  close: (connId: string) => ipcRenderer.send('mumble:close', connId),
  relayOpen: (connId: string, rid: string, endpoint: unknown, token: string, lowSide: boolean) =>
    ipcRenderer.invoke('mumpeer:open', connId, rid, endpoint, token, lowSide),
  relayTurn: (connId: string, rid: string, lane: number) => ipcRenderer.invoke('mumpeer:turn', connId, rid, lane),
  relayCloseLane: (connId: string, rid: string, lane: number) => ipcRenderer.send('mumpeer:closeLane', connId, rid, lane),
  relayClose: (connId: string, rid: string) => ipcRenderer.send('mumpeer:close', connId, rid),
  udpSetup: (connId: string, key: Uint8Array, cn: Uint8Array, sn: Uint8Array, protobuf: boolean) => ipcRenderer.send('mumble:udpSetup', connId, key, cn, sn, protobuf),
  udpNonce: (connId: string, sn: Uint8Array) => ipcRenderer.send('mumble:udpNonce', connId, sn),
  udpSend: (connId: string, bytes: Uint8Array) => ipcRenderer.send('mumble:udpSend', connId, bytes),
  udpClientNonce: (connId: string) => ipcRenderer.invoke('mumble:udpClientNonce', connId),
  on: (event: keyof typeof listeners, fn: Listener) => {
    listeners[event].add(fn);
    return () => listeners[event].delete(fn);
  }
});
