// Desktop share end to end: two app instances (or one and a browser, see
// frontend/tools/share-interop.ts) on the test server; one shares, the other watches.
// Run by tools/desktop-share-e2e.sh, which prepends ROLE ('sender' | 'viewer') and KIND
// ('camera' | 'screen'). Needs the smoke-test build with MUMH5_SMOKE_MOCK_MEDIA=1 and
// MUMH5_SMOKE_STAY=1; the screen picker is opened through smoke_click, a GTK click,
// since getDisplayMedia needs a user gesture.
const kind = typeof KIND === 'undefined' ? 'camera' : KIND;
(async () => {
  const { invoke } = window.__TAURI_INTERNALS__;
  const r = { role: ROLE, steps: [] };
  const report = (extra = {}) => invoke('smoke_report', { report: { ...r, ...extra } });
  const sleep = ms => new Promise(res => setTimeout(res, ms));
  const wait = async (fn, label, ms = 20000) => { const start = Date.now(); let v; while (!(v = fn())) { if (Date.now() - start > ms) throw new Error(`Timed out: ${label}`); await sleep(100); } return v; };
  const button = text => [...document.querySelectorAll('button')].find(e => e.textContent.trim() === text);
  const click = async text => (await wait(() => button(text), text)).click();
  const input = (selector, value) => { const el = document.querySelector(selector); el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); };
  const step = async s => { r.steps.push(s); await report(); };
  try {
    await wait(() => window.mumh5Native && document.querySelector('[role=dialog]'), 'UI');
    (await wait(() => [...document.querySelectorAll('button')].find(e => e.textContent.includes('Create a new identity')), 'wizard')).click();
    await wait(() => document.querySelector('#w-name'), 'name field');
    input('#w-name', `share-${ROLE}`);
    await click('Create'); await click('Skip for now'); await click('Done');
    await wait(() => !document.querySelector('[role=dialog]'), 'wizard closes');
    await click('Add a server'); input('#c-host', '127.0.0.1'); input('[aria-label=Port]', '64750'); input('#c-user', `share-${ROLE}`);
    await click('Save and connect');
    await wait(() => document.body.innerText.includes('Root') && !document.querySelector('#connect'), 'connected');
    await step('connected');
    const accept = async () => { const b = await wait(() => button('Continue'), 'direct share note', 5000).catch(() => null); b?.click(); };
    if (ROLE === 'sender') {
      // Wait for the viewer, so the share announcement reaches it
      await wait(() => document.body.innerText.includes('share-viewer'), 'viewer present', 60000);
      if (kind === 'camera') {
        (await wait(() => document.querySelector('button[aria-label="Turn on your camera"]:not([disabled])'), 'camera button')).click();
        await accept();
        await wait(() => document.querySelector('button[aria-label="Turn off your camera"]'), 'camera on');
      } else {
        (await wait(() => document.querySelector('button[aria-label="Share your screen or camera"]:not([disabled])'), 'share button')).click();
        await accept();
        const choose = await wait(() => [...document.querySelectorAll('[role=dialog] button')].find(b => b.textContent.trim().startsWith('Choose a screen or window')), 'choose button');
        const box = choose.getBoundingClientRect();
        // A click through GTK: getDisplayMedia needs a user gesture
        await invoke('smoke_click', { x: box.left + box.width / 2, y: box.top + box.height / 2 });
        await step('picker clicked');
        const start = await wait(() => [...document.querySelectorAll('[role=dialog] button')].find(b => b.textContent.trim() === 'Start sharing' && !b.disabled), 'preview ready');
        const sound = document.querySelector('#sh-audio');
        if (sound && !sound.disabled) { sound.value = ''; sound.dispatchEvent(new Event('change', { bubbles: true })); }
        r.sound = sound ? sound.value : null;
        start.click();
        await wait(() => document.querySelector('button[aria-label="Stop sharing your screen"]'), 'sharing on');
      }
      await step(`${kind} on`);
      // Stay until the viewer reports; the runner stops this instance
      for (;;) await sleep(2000);
    } else {
      const tile = await wait(() => document.querySelector(`[aria-label^="Watch the ${kind} of"]`), `${kind} tile`, 60000);
      await step(`sender ${kind} announced`);
      tile.click();
      await accept();
      await step('watching');
      const result = await wait(() => {
        for (const canvas of document.querySelectorAll('canvas')) {
          if (!canvas.width || !canvas.isConnected || canvas.offsetWidth < 20) continue;
          try {
            const px = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
            let lit = 0; for (let i = 0; i < px.length; i += 4 * 97) if (px[i] + px[i + 1] + px[i + 2] > 60) lit++;
            if (lit > 10) return `${canvas.width}x${canvas.height} shown ${canvas.offsetWidth}x${canvas.offsetHeight}`;
          } catch { /* not a 2d canvas */ }
        }
        return null;
      }, 'picture on the stage', 40000);
      await report({ ok: true, done: true, result });
    }
  } catch (e) {
    await report({ ok: false, done: true, error: String(e), text: document.body?.innerText?.slice(0, 1500) });
  }
})();
