// Service worker of the web build. the Bun build fills in the version and the file list.
// It keeps the files of this build so the page opens from the home screen without the network.
// Only those files: never api/ (identities, ping, relay) and never other hosts. WebSockets do
// not pass through a service worker at all.
const CACHE = 'mumh5-__VERSION__';
const FILES = __FILES__;
const scope = self.registration.scope;
const shell = new URL('./', scope).href;

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Past the HTTP cache, so a deploy never mixes old and new files
    await cache.addAll(['./', ...FILES].map(f => new Request(f, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('mumh5-') && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  if (!req.url.startsWith(scope) || req.url.startsWith(scope + 'api/')) return;
  if (req.mode === 'navigate') {
    // The network first, so a new deploy shows on the next load; the kept page when offline
    e.respondWith(fetch(req).catch(async () => (await caches.match(shell)) ?? Response.error()));
    return;
  }
  e.respondWith(caches.match(req).then(hit => hit ?? fetch(req)));
});
