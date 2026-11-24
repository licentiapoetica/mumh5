import { chromium, type Page } from 'playwright-core';
const base = Bun.env.DREAM_CORD_TEST_URL ?? 'http://127.0.0.1:18080';
const browser = await chromium.launch({ executablePath: Bun.env.CHROMIUM_PATH ?? '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-gpu', '--mute-audio', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['clipboard-read', 'clipboard-write'] });
context.setDefaultTimeout(10000);
const errors: string[] = [];
const require = (ok: unknown, message: string) => { if (!ok) throw new Error(message); };
async function oneSettings(page: Page) {
 const button = page.getByRole('button', { name: 'Settings', exact: true });
 for (let n = 0; n < 50; n++) { if (await button.count() === 1 && await button.isVisible()) return; await page.waitForTimeout(100); }
 throw new Error(`Expected one visible Settings button, got ${await button.count()}`);
}
try {
 await context.addInitScript(() => {
  localStorage.setItem('mumh5.settings', JSON.stringify({ interface: 'rooms', arrangement: 'classic', railHidden: false, toolbar: { items: ['settings', 'settings', 'mic'], hidden: ['settings'] } }));
  const Original = window.WebSocket;
  window.WebSocket = class extends Original {
   constructor(url: string | URL, protocols?: string | string[]) { super(url, protocols); (window as unknown as { testSocket: WebSocket }).testSocket = this; }
  };
 });
 const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
 await page.route('https://**/*', route => route.abort());
 await page.goto(base);
 await page.getByRole('button', { name: /Create a new identity/ }).click();
 await page.getByLabel('Name', { exact: true }).fill('debug-smoke');
 await page.getByRole('button', { name: 'Create', exact: true }).click();
 await page.getByRole('button', { name: 'Skip for now' }).click();
 await page.getByRole('button', { name: 'Done', exact: true }).click();
 await page.locator('.app.classic').waitFor(); await oneSettings(page);
 console.log('PASS legacy Rooms setting falls back without changing Classic layout');
 for (const name of ['Modern', 'Classic', 'Stacked']) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Appearance', exact: true }).click();
  require(await page.getByRole('radiogroup', { name: 'Interface', exact: true }).count() === 0, 'Interface selector remains');
  const layouts = page.getByRole('radiogroup', { name: 'Layout', exact: true });
  require(await layouts.getByRole('radio').count() === 3, 'Existing layout options changed');
  await layouts.getByRole('radio', { name, exact: true }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await oneSettings(page); await page.setViewportSize({ width: 390, height: 844 }); await oneSettings(page);
  await page.setViewportSize({ width: 1280, height: 800 });
 }
 console.log('PASS one Settings button across layouts and sizes, with rail shown');
 await page.locator('section.home').getByRole('button', { name: 'Add a server', exact: true }).click();
 await page.getByLabel('Address', { exact: true }).fill('127.0.0.1'); await page.getByLabel('Port', { exact: true }).fill('64750');
 await page.getByLabel('Username', { exact: true }).fill('debug-smoke');
 await page.getByLabel('Password', { exact: false }).fill('private-password-sentinel');
 await page.getByRole('button', { name: 'Save and connect' }).click(); await page.getByText('Root', { exact: true }).first().waitFor();
 await oneSettings(page);
 async function openLog() {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'About', exact: true }).click();
  await page.getByRole('button', { name: 'Open debug log', exact: true }).click();
  return page.getByRole('dialog', { name: 'Debug log', exact: true });
 }
 let log = await openLog(); await log.getByText('Background timer worker ready', { exact: false }).waitFor();
 await log.getByText('Server synchronized', { exact: false }).waitFor();
 await log.getByRole('button', { name: 'Copy log' }).click();
 const copied = await page.evaluate(() => navigator.clipboard.readText());
 require(copied.includes('Server synchronized') && !copied.includes('private-password-sentinel'), 'Copy log missing diagnostics or includes credentials');
 const downloading = page.waitForEvent('download'); await log.getByRole('button', { name: 'Download log' }).click();
 require((await downloading).suggestedFilename().startsWith('dream-cord-debug-'), 'Debug download missing');
 await log.getByRole('searchbox').fill('nonexistent-filter-value'); await log.getByText('No matching events.').waitFor();
 await log.getByRole('searchbox').fill('');
 await page.screenshot({ path: `${new URL('../../', import.meta.url).pathname}.tooling/debug-log.png` });
 await page.keyboard.press('Escape'); await log.waitFor({ state: 'detached' });
 require(await page.getByRole('dialog', { name: 'Settings', exact: true }).count() === 1, 'Escape also closed Settings');
 await page.getByRole('button', { name: 'Done', exact: true }).click();
 console.log('PASS live debug window, copy, download, filtering, and nested Escape');
 // The previous missing worker meant no keepalives; stock Mumble times out after 30s.
 const background = await context.newPage(); await background.goto('about:blank'); await background.bringToFront();
 await page.waitForTimeout(36000); await page.bringToFront();
 await page.locator('.app:not(.home)').waitFor(); log = await openLog();
 const contents = await log.innerText(); require(contents.includes('Keepalive tick'), 'No keepalive diagnostics');
 require(!contents.includes('Connection closed'), 'Connection dropped during idle keepalive test');
 console.log('PASS idle/background connection survives stock Mumble timeout');
 await log.getByRole('button', { name: 'Done', exact: true }).click();
 await page.getByRole('tab', { name: 'Appearance', exact: true }).click();
 await page.getByRole('radio', { name: 'Modern', exact: true }).click(); await page.getByRole('button', { name: 'Done', exact: true }).click();
 await page.setViewportSize({ width: 390, height: 844 }); await oneSettings(page);
 await page.getByRole('button', { name: 'Open channels' }).click(); await oneSettings(page);
 const scrim = page.getByRole('button', { name: 'Close', exact: true });
 const scrimBox = await scrim.boundingBox(); require(scrimBox, 'Drawer backdrop missing');
 await scrim.click({ position: { x: scrimBox!.width - 8, y: scrimBox!.height / 2 } }); await oneSettings(page);
 console.log('PASS one Settings button in connected phone header and open drawer');
 await page.evaluate(() => (window as unknown as { testSocket: WebSocket }).testSocket.close(4001, 'Simulated gateway interruption'));
 log = await openLog(); await log.getByText('Simulated gateway interruption', { exact: false }).first().waitFor();
 require((await log.innerText()).includes('4001'), 'WebSocket close code missing');
 await log.getByRole('button', { name: 'Clear log' }).click(); await log.getByText('No matching events.').waitFor();
 console.log('PASS disconnect close code/reason captured and log can be cleared');
 require(errors.length === 0, errors.join('\n')); console.log('PASS settings/debug/keepalive integration');
} finally { await browser.close(); }
