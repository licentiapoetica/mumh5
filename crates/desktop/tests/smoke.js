// Compiled only with the smoke-test feature, run on an isolated Xvfb display/profile.
(async () => {
 const { invoke } = window.__TAURI_INTERNALS__;
 const results = []; const udpEvents = [];
 const wait = async (fn, label, ms = 15000) => { const start = Date.now(); while (!fn()) { if (Date.now() - start > ms) throw new Error(`Timed out: ${label}\n${document.body?.innerText}`); await new Promise(r => setTimeout(r, 80)); } return fn(); };
 const button = text => [...document.querySelectorAll('button')].find(e => e.textContent.trim() === text);
 const click = async text => (await wait(() => button(text), text)).click();
 const input = (selector, value) => { const el = document.querySelector(selector); if (!el) throw new Error(`Missing ${selector}`); el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); };
 try {
  await wait(() => window.mumh5Native && document.querySelector('[role=dialog]'), 'Tauri UI mounted');
  // No hardware access during tests. Normal builds use the WebView's own user-media API.
  // One context for every call: a new one per call stayed open and running, which added 8-15 % CPU to
  // measurements of a connected app. A fresh destination each time, since the app stops its tracks.
  let fakeMic = null;
  if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => (fakeMic ??= new AudioContext({ sampleRate: 48000 })).createMediaStreamDestination().stream;
  const wizardButton = await wait(() => [...document.querySelectorAll('button')].find(e => e.textContent.includes('Create a new identity')), 'identity wizard');
  // A notice the wizard shows (a damaged profile that was set aside), for the report
  const wizardAlert = document.querySelector('[role=dialog] [role=alert]')?.textContent?.trim() ?? null;
  wizardButton.click();
  await wait(() => document.querySelector('#w-name'), 'identity name field');
  input('#w-name', 'desktop-smoke');
  await click('Create'); await click('Skip for now'); await click('Done');
  await wait(() => !document.querySelector('[role=dialog]'), 'wizard closes');
  if (getComputedStyle(document.querySelector('.app')).display !== 'flex') throw new Error('Component styles missing');
  results.push('styled Tauri window');
  // The public list dialog: either servers or a plain explanation, never a raw error (reported, not required)
  await click('Browse public servers');
  const publicList = await wait(() => document.querySelector('[role=dialog] table tbody tr') ? 'servers listed' : document.querySelector('[role=dialog] .error')?.textContent?.trim(), 'public list answer', 40000);
  document.querySelector('[role=dialog] [aria-label=Close], [role=dialog] .close')?.click();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await wait(() => !document.querySelector('[role=dialog]'), 'public list closes');
  const api = window.mumh5Native;
  const list = await api.identities.list();
  if (!list.setupDone || list.identities.length !== 1 || 'keyPem' in list.identities[0]) throw new Error('Identity API failed');
  results.push('native identity wizard and private key isolation');
  const ping = await api.pingServer('127.0.0.1', 64750); if (!ping || ping.maxUsers < 1) throw new Error('UDP ping failed');
  results.push('native UDP server ping');
  await api.sounds.write('sound:message', new Uint8Array([1, 3, 5]));
  const sound = await api.sounds.read('sound:message'); if (sound?.join() !== '1,3,5') throw new Error('Sound file round trip failed'); await api.sounds.remove('sound:message');
  results.push('native sound storage');
  let udp = false; const stopUdp = api.on('udpState', (_id, ok) => { udpEvents.push(ok); if (ok) udp = true; });
  const originalSetup = api.udpSetup; api.udpSetup = (...args) => { udpEvents.push({key: args[1].length, cn: args[2].length, sn: args[3].length, protobuf: args[4]}); originalSetup(...args); };
  await click('Add a server'); input('#c-host', '127.0.0.1'); input('[aria-label=Port]', '64750'); input('#c-user', 'desktop-smoke');
  await click('Save and connect');
  await wait(() => document.body.innerText.includes('Root') && !document.querySelector('#connect'), 'server sync over native TLS');
  results.push('native TLS connection and rendered channel tree');
  await wait(() => udp, 'encrypted native UDP probe'); stopUdp(); results.push('native encrypted UDP voice lane');
  // Output devices (Linux): named outputs from the sound server, and switching to one and back
  let audioOutputs = null;
  if (api.audioOutputs) {
   audioOutputs = await api.audioOutputs();
   // Only a test output (a null sink named mumh5_test_*) is switched to, never a real device
   const other = (audioOutputs ?? []).find(o => o.id.startsWith('mumh5_test_'));
   if (other) { await api.setAudioOutput(other.id); await new Promise(r => setTimeout(r, 3000)); await api.setAudioOutput('default'); await new Promise(r => setTimeout(r, 1500)); }
  }
  if (!document.querySelector('[contenteditable=true]')) await wait(() => [...document.querySelectorAll('button')].find(e => /^(Chat|Text)$/.test(e.textContent.trim())), 'chat navigation').then(e => e.click());
  const composer = await wait(() => document.querySelector('[contenteditable=true]'), 'chat composer');
  composer.textContent = 'mumh5 desktop integration message'; composer.dispatchEvent(new Event('input', { bubbles: true })); composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
  await wait(() => document.querySelector('.msg')?.textContent?.includes('mumh5 desktop integration message') || [...document.querySelectorAll('.msg')].some(e => e.textContent.includes('mumh5 desktop integration message')), 'sent chat rendered');
  results.push('chat send and rendering');
  await invoke('smoke_report', { report: { ok: true, results, wizardAlert, publicList, audioOutputs, webCodecs: { audioDecoder: typeof AudioDecoder !== 'undefined', audioEncoder: typeof AudioEncoder !== 'undefined', videoDecoder: typeof VideoDecoder !== 'undefined' }, title: document.title, media: { camera: !!navigator.mediaDevices?.getUserMedia, screen: !!navigator.mediaDevices?.getDisplayMedia } } });
 } catch (error) { await invoke('smoke_report', { report: { ok: false, results, udpEvents, error: String(error), text: document.body?.innerText } }); }
})();
