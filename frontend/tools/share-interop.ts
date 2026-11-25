// Browser side of the desktop share interop check. ROLE=sender|viewer KIND=camera|screen
import { chromium } from 'playwright-core';
const role = Bun.env.ROLE!;
const base = 'http://127.0.0.1:18080';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-gpu', '--mute-audio', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--auto-select-desktop-capture-source=Entire screen'] });
const page = await (await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 800 } })).newPage();
const continueNote = async () => { const b = page.getByRole('button', { name: 'Continue', exact: true }); try { await b.click({ timeout: 4000 }); } catch { /* no note */ } };
try {
  await page.route('https://**/*', route => route.abort());
  await page.goto(base);
  await page.getByRole('button', { name: /Create a new identity/ }).click();
  await page.getByLabel('Name', { exact: true }).fill(`share-${role}`);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'Add a server', exact: true }).click();
  await page.getByLabel('Username', { exact: true }).fill(`share-${role}`);
  await page.getByRole('button', { name: 'Save and connect' }).click();
  await page.getByText('Root', { exact: true }).first().waitFor();
  console.log('browser connected');
  if (role === 'sender') {
    await page.getByText('share-viewer').first().waitFor({ timeout: 90000 });
    if (Bun.env.KIND === 'screen') {
      await page.locator('button[aria-label="Share your screen or camera"]:not([disabled])').first().click();
      await continueNote();
      await page.getByRole('button', { name: /^Choose a screen or window/ }).click();
      await page.getByRole('button', { name: 'Start sharing', exact: true }).click({ timeout: 15000 });
      await page.locator('button[aria-label="Stop sharing your screen"]').first().waitFor();
    } else {
      await page.locator('button[aria-label="Turn on your camera"]:not([disabled])').first().click();
      await continueNote();
      await page.locator('button[aria-label="Turn off your camera"]').first().waitFor();
    }
    console.log(`browser ${Bun.env.KIND ?? 'camera'} on`);
    await page.waitForTimeout(Number(Bun.env.HOLD ?? 60000));
  } else {
    await page.locator(`[aria-label^="Watch the ${Bun.env.KIND ?? 'camera'} of"]`).first().click({ timeout: 90000 });
    await continueNote();
    const size = await page.waitForFunction(() => {
      const v = [...document.querySelectorAll('video')].find(v => v.videoWidth > 0 && v.currentTime > 0.3);
      return v ? `${v.videoWidth}x${v.videoHeight}` : null;
    }, null, { timeout: 40000 });
    console.log(`PASS browser shows the desktop ${Bun.env.KIND ?? 'camera'}`, await size.jsonValue());
  }
} catch (e) {
  console.log('FAIL', String(e));
  console.log((await page.locator('body').innerText().catch(() => '')).slice(0, 800));
} finally {
  await browser.close();
}
