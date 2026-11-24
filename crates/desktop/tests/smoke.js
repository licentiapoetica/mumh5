// Compiled only with the smoke-test feature, run on an isolated Xvfb display/profile.
(async () => {
 const { invoke } = window.__TAURI_INTERNALS__;
 const results = []; const udpEvents = [];
 const wait = async (fn, label) => { const start = Date.now(); while (!fn()) { if (Date.now() - start > 15000) throw new Error(`Timed out: ${label}\n${document.body?.innerText}`); await new Promise(r => setTimeout(r, 80)); } return fn(); };
 const button = text => [...document.querySelectorAll('button')].find(e => e.textContent.trim() === text);
 const click = async text => (await wait(() => button(text), text)).click();
 const input = (selector, value) => { const el = document.querySelector(selector); if (!el) throw new Error(`Missing ${selector}`); el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); };
 try {
  await wait(() => window.dreamCordNative && document.querySelector('[role=dialog]'), 'Tauri UI mounted');
  // No hardware access during tests. Normal builds use the WebView's own user-media API.
  if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => { const ctx = new AudioContext(); return ctx.createMediaStreamDestination().stream; };
  await wait(() => [...document.querySelectorAll('button')].find(e => e.textContent.includes('Create a new identity')), 'identity wizard').then(e => e.click());
  input('#w-name', 'desktop-smoke');
  await click('Create'); await click('Skip for now'); await click('Done');
  await wait(() => !document.querySelector('[role=dialog]'), 'wizard closes');
  if (getComputedStyle(document.querySelector('.app')).display !== 'flex') throw new Error('Component styles missing');
  results.push('styled Tauri window');
  const api = window.dreamCordNative;
  const list = await api.identities.list();
  if (!list.setupDone || list.identities.length !== 1 || 'keyPem' in list.identities[0]) throw new Error('Identity API failed');
  results.push('native identity wizard and private key isolation');
  const ping = await api.pingServer('127.0.0.1', 64750); if (!ping || ping.maxUsers < 1) throw new Error('UDP ping failed');
  results.push('native UDP server ping');
  await api.sounds.write('test', new Uint8Array([1, 3, 5]));
  const sound = await api.sounds.read('test'); if (sound?.join() !== '1,3,5') throw new Error('Sound file round trip failed'); await api.sounds.remove('test');
  results.push('native sound storage');
  let udp = false; const stopUdp = api.on('udpState', (_id, ok) => { udpEvents.push(ok); if (ok) udp = true; });
  const originalSetup = api.udpSetup; api.udpSetup = (...args) => { udpEvents.push({key: args[1].length, cn: args[2].length, sn: args[3].length, protobuf: args[4]}); originalSetup(...args); };
  await click('Add a server'); input('#c-host', '127.0.0.1'); input('[aria-label=Port]', '64750'); input('#c-user', 'desktop-smoke');
  await click('Save and connect');
  await wait(() => document.body.innerText.includes('Root') && !document.querySelector('#connect'), 'server sync over native TLS');
  results.push('native TLS connection and rendered channel tree');
  await wait(() => udp, 'encrypted native UDP probe'); stopUdp(); results.push('native encrypted UDP voice lane');
  if (!document.querySelector('[contenteditable=true]')) await wait(() => [...document.querySelectorAll('button')].find(e => /^(Chat|Text)$/.test(e.textContent.trim())), 'chat navigation').then(e => e.click());
  const composer = await wait(() => document.querySelector('[contenteditable=true]'), 'chat composer');
  composer.textContent = 'Dream Cord desktop integration message'; composer.dispatchEvent(new Event('input', { bubbles: true })); composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
  await wait(() => document.querySelector('.msg')?.textContent?.includes('Dream Cord desktop integration message') || [...document.querySelectorAll('.msg')].some(e => e.textContent.includes('Dream Cord desktop integration message')), 'sent chat rendered');
  results.push('chat send and rendering');
  await invoke('smoke_report', { report: { ok: true, results, title: document.title, media: { camera: !!navigator.mediaDevices?.getUserMedia, screen: !!navigator.mediaDevices?.getDisplayMedia } } });
 } catch (error) { await invoke('smoke_report', { report: { ok: false, results, udpEvents, error: String(error), text: document.body?.innerText } }); }
})();
