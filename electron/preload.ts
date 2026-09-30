import { contextBridge, ipcRenderer } from 'electron';

type Listener = (connId: string, ...args: any[]) => void;
const listeners = {
  secure: new Set<Listener>(), data: new Set<Listener>(), close: new Set<Listener>(),
  udpVoice: new Set<Listener>(), udpState: new Set<Listener>(), udpResync: new Set<Listener>()
};
for (const key of Object.keys(listeners) as (keyof typeof listeners)[]) {
  ipcRenderer.on(`mumble:${key}`, (_e, connId: string, ...args: any[]) => {
    for (const fn of listeners[key]) fn(connId, ...args);
  });
}

// The only native surface the renderer gets
contextBridge.exposeInMainWorld('mumh5Native', {
  platformInfo: () => ipcRenderer.invoke('platform:info'),
  updateTray: (state: unknown) => ipcRenderer.send('tray:update', state),
  linkPreview: (url: string) => ipcRenderer.invoke('preview:fetch', url),
  publicServers: (url: string) => ipcRenderer.invoke('publist:fetch', url),
  pingServer: (host: string, port: number) => ipcRenderer.invoke('publist:ping', host, port),
  onContextMenu: (fn: (params: unknown) => void) => { ipcRenderer.on('context-menu', (_e, p) => fn(p)); },
  editAction: (action: string, arg?: unknown) => ipcRenderer.send('edit:action', action, arg),
  onTrayAction: (fn: (action: string) => void) => { ipcRenderer.on('tray:action', (_e, a: string) => fn(a)); },
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
  udpSetup: (connId: string, key: Uint8Array, cn: Uint8Array, sn: Uint8Array, protobuf: boolean) => ipcRenderer.send('mumble:udpSetup', connId, key, cn, sn, protobuf),
  udpNonce: (connId: string, sn: Uint8Array) => ipcRenderer.send('mumble:udpNonce', connId, sn),
  udpSend: (connId: string, bytes: Uint8Array) => ipcRenderer.send('mumble:udpSend', connId, bytes),
  udpClientNonce: (connId: string) => ipcRenderer.invoke('mumble:udpClientNonce', connId),
  on: (event: keyof typeof listeners, fn: Listener) => {
    listeners[event].add(fn);
    return () => listeners[event].delete(fn);
  }
});
