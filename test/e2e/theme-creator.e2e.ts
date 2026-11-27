// The theme creator, from source in a browser; no Mumble server required.
// CHROMIUM_PATH=/path/to/chromium npm run test:e2e:themes
import { chromium, type Locator, type Page } from 'playwright-core';
import { createServer } from 'vite';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const temp = await mkdtemp(path.join(tmpdir(), 'mumh5-theme-e2e-'));
// Its own dependency cache, so a running dev server is left alone
const server = await createServer({ cacheDir: path.join(temp, 'vite'), server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1400, height: 860 }, acceptDownloads: true });
  const page = await context.newPage();
  // Settings in the page, where the steps look for it, not in a window of its own
  await page.addInitScript(() => localStorage.setItem('mumh5.settingsInline', '1'));
  const failures: string[] = [];
  page.on('pageerror', e => failures.push(e.message));
  await page.goto(server.resolvedUrls!.local[0]);

  const rootVar = (name: string, on: Page = page) => on.evaluate(n => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
  const waitVar = (name: string, value: string, on: Page = page) => on.waitForFunction(([n, v]) =>
    getComputedStyle(document.documentElement).getPropertyValue(n).trim() === v, [name, value]);
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('mumh5.settings') ?? '{}'));
  const themes = () => page.evaluate(() => JSON.parse(localStorage.getItem('mumh5.customThemes') ?? '[]'));
  const panel = (on: Page) => on.getByRole('region', { name: 'Theme creator' });
  const setColor = (on: Page, label: string, value: string) => panel(on).getByLabel(label, { exact: true }).evaluate((el: HTMLInputElement, v) => {
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
  const button = (on: Page | Locator, name: string) => on.getByRole('button', { name, exact: true });
  // The click that opens the creator's window
  const opening = async (target: Locator) => {
    const [win] = await Promise.all([context.waitForEvent('page'), target.click()]);
    await panel(win).waitFor();
    return win;
  };
  const closing = async (win: Page, target: Locator) => { await Promise.all([win.waitForEvent('close'), target.click()]); };
  const shot = async (on: Page, name: string) => {
    if (!process.env.SHOTS_DIR) return;
    await mkdir(process.env.SHOTS_DIR, { recursive: true });
    await on.screenshot({ path: path.join(process.env.SHOTS_DIR, `${name}.png`), animations: 'disabled' });
  };
  const settings = page.getByRole('dialog', { name: 'Settings' });
  const appearance = async () => {
    await button(page, 'Configure').click();
    await settings.getByRole('tab', { name: 'Appearance' }).click();
  };

  await appearance();
  const originalAccent = await rootVar('--accent');
  const frameBefore = (await page.locator('.frame').boundingBox())!;

  // Its own window: the app keeps its size and layout
  let win = await opening(button(page, 'Create theme'));
  assert.equal(await settings.count(), 0, 'Settings makes way for the preview');
  assert.deepEqual(await page.locator('.frame').boundingBox(), frameBefore, 'the app is not resized');
  assert.equal(await panel(page).count(), 0, 'nothing is added to the app');
  assert.equal(await win.title(), 'Theme creator');
  console.log('ok: opens in its own window, the app keeps its layout');

  // Three colors fill in the palette, live on the app and in the creator's window
  await setColor(win, 'Background', '#102030');
  await setColor(win, 'Text', '#f4f0e8');
  await setColor(win, 'Accent', '#ff7a18');
  await waitVar('--accent', '#ff7a18');
  await waitVar('--accent', '#ff7a18', win);
  assert.equal(await rootVar('--bg-2'), '#102030');
  assert.notEqual(await rootVar('--bg-1'), '#102030', 'shades follow');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'custom');
  await panel(win).getByText('Contrast is fine').waitFor();
  console.log('ok: quick colors apply live and fill in the palette');

  // A color that cannot be read is flagged and fixed; Undo brings it back
  await button(panel(win), 'All colors').click();
  // Taller than the window: the list scrolls, from its very top, and the bars stay in place
  const list = panel(win).locator('.body');
  assert.equal(await list.evaluate(el => el.scrollTop), 0);
  assert.ok(await list.evaluate(el => el.scrollHeight > el.clientHeight), 'the list overflows');
  const listBox = (await list.boundingBox())!;
  await win.mouse.move(listBox.x + 40, listBox.y + listBox.height / 2);
  await win.mouse.wheel(0, 300);
  await win.waitForFunction(() => document.querySelector('.creator .body')!.scrollTop > 0);
  assert.equal((await panel(win).locator('header').boundingBox())!.y, 0, 'the top bar stays');
  const bar = (await panel(win).locator('footer').boundingBox())!;
  assert.equal(bar.y + bar.height, await win.evaluate(() => innerHeight), 'the bottom bar stays');
  await list.evaluate(el => el.scrollTo(0, 0));
  console.log('ok: all colors scroll between the bars');
  await setColor(win, 'Links', '#112233');
  await panel(win).getByText('1 color hard to read').waitFor();
  await button(panel(win), 'Fix').click();
  await panel(win).getByText('Contrast is fine').waitFor();
  assert.notEqual(await rootVar('--link'), '#112233');
  await button(panel(win), 'Undo').click();
  await waitVar('--link', '#112233');
  await button(panel(win), 'Fix').click();
  console.log('ok: low contrast is flagged, fixed and undone');

  // Typed codes: a valid one applies, anything else goes back
  const hex = panel(win).getByLabel('Warning code', { exact: true });
  await hex.fill('#abc');
  await hex.press('Tab');
  await waitVar('--warn', '#aabbcc');
  await hex.fill('not a color');
  await hex.press('Tab');
  assert.equal(await hex.inputValue(), '#aabbcc');
  // The connection wave follows the status color until it gets a color of its own
  const typeCode = async (name: string, value: string) => {
    const field = panel(win).getByLabel(`${name} code`, { exact: true });
    await field.fill(value);
    await field.press('Tab');
  };
  await typeCode('Connected and active', '#44dd88');
  await waitVar('--wave', '#44dd88');
  await typeCode('Connection wave', '#ff8800');
  await waitVar('--wave', '#ff8800');
  await typeCode('Connected and active', '#66ee99');
  await waitVar('--speaking', '#66ee99');
  assert.equal(await rootVar('--wave'), '#ff8800', 'a wave color of its own stays');
  await typeCode('Wave background', '#2a1040');
  await waitVar('--server-header', '#2a1040');
  assert.equal(await rootVar('--bg-0') === '#2a1040', false, 'the fields keep their color');
  await panel(win).getByLabel(/Wave brightness/).fill('200');
  await waitVar('--wave-strength', '2');
  console.log('ok: the connection wave and the server header have their own colors');

  await panel(win).getByLabel('Font', { exact: true }).selectOption('serif');
  await panel(win).getByLabel(/Chat text size/).fill('18');
  await waitVar('--fs-chat', '18px');
  assert.match(await page.evaluate(() => getComputedStyle(document.body).fontFamily), /Georgia/);
  await panel(win).getByLabel('Name', { exact: true }).fill('Harbor');

  // The speaking indicator has its own section, per state, and the palette leaves it alone
  await button(panel(win), 'Indicator').click();
  await panel(win).getByLabel('Idle shape', { exact: true }).selectOption('ring');
  await setColor(win, 'Idle color', '#445566');
  // The sphere's border, on by default only for idle, can stay on while talking
  const talkingRim = panel(win).locator('.sample .people > span:nth-child(2) circle[stroke]');
  assert.equal(await talkingRim.count(), 0);
  await panel(win).getByLabel('Talking border', { exact: true }).check();
  await talkingRim.waitFor();
  await panel(win).getByLabel('Talking shape', { exact: true }).selectOption('square');
  assert.equal(await panel(win).getByLabel('Talking border', { exact: true }).count(), 0, 'only a sphere has this border');
  await setColor(win, 'Talking color', '#ff00aa');
  await panel(win).getByLabel('Talking size', { exact: true }).fill('100');
  await panel(win).getByLabel('Talking glow', { exact: true }).fill('6');
  await panel(win).locator('.sample svg[data-shape="ring"] circle[stroke="#445566"]').waitFor();
  const talkingMark = panel(win).locator('.sample svg[data-shape="square"]');
  assert.equal(await talkingMark.locator('rect').getAttribute('fill'), '#ff00aa');
  assert.equal(await talkingMark.getAttribute('width'), '20');
  assert.match(await talkingMark.evaluate(el => getComputedStyle(el).filter), /drop-shadow/);
  assert.equal(await panel(win).getByLabel('Talking shape', { exact: true }).locator('option[value="none"]').count(), 0, 'a talking person always shows');
  // A talking name keeps its color unless this is chosen; the connected color has no say
  const nameColor = panel(win).getByLabel('Talking name color', { exact: true });
  assert.equal(await nameColor.count(), 0);
  assert.equal(await rootVar('--name-talking'), '');
  await panel(win).getByLabel('Color the name while talking').check();
  await setColor(win, 'Talking name color', '#00ddff');
  await waitVar('--name-talking', '#00ddff');
  await panel(win).getByLabel('Color the name while talking').uncheck();
  await waitVar('--name-talking', '');
  await shot(win, 'theme-creator-indicator');
  await button(panel(win), 'Quick').click();
  await setColor(win, 'Accent', '#00c2a8');
  await waitVar('--accent', '#00c2a8');
  await button(panel(win), 'Undo').click();
  await waitVar('--accent', '#ff7a18');
  await button(panel(win), 'Indicator').click();
  assert.equal(await panel(win).getByLabel('Talking color code', { exact: true }).inputValue(), '#ff00aa');
  await button(panel(win), 'Quick').click();
  console.log('ok: speaking indicator has its own settings per state');
  await shot(win, 'theme-creator-window');
  await shot(page, 'theme-creator-app');

  // Cancelling asks in the creator's window; saying no keeps editing
  await button(panel(win), 'Cancel').click();
  await button(win.getByRole('dialog', { name: 'Discard changes?' }), 'Cancel').click();
  await panel(win).waitFor();
  assert.equal(await rootVar('--accent'), '#ff7a18', 'keeps editing');

  await closing(win, button(panel(win), 'Save'));
  await page.getByRole('radio', { name: 'Harbor', exact: true }).waitFor();
  assert.equal((await themes()).length, 1);
  assert.equal((await saved()).theme, (await themes())[0].id);
  assert.deepEqual((await themes())[0].indicator.talking, { color: '#ff00aa', shape: 'square', size: 100, glow: 6, border: true });
  console.log('ok: theme saved and selected, its window closed');

  await page.reload();
  await waitVar('--accent', '#ff7a18');
  assert.equal(await rootVar('--fs-chat'), '18px');
  console.log('ok: theme survives a restart');

  // A built-in scheme takes every inline value off again
  await appearance();
  await page.getByRole('radio', { name: 'Light', exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue('--accent')), '');
  assert.equal(await rootVar('--accent'), '#5b4bdb');
  assert.doesNotMatch(await page.evaluate(() => getComputedStyle(document.body).fontFamily), /Georgia/);
  await page.getByRole('radio', { name: 'Harbor', exact: true }).click();
  await waitVar('--accent', '#ff7a18');

  // Editing and cancelling restores the saved theme
  win = await opening(button(page, 'Edit Harbor'));
  await setColor(win, 'Accent', '#00c2a8');
  await waitVar('--accent', '#00c2a8');
  await button(panel(win), 'Cancel').click();
  await closing(win, button(win.getByRole('dialog', { name: 'Discard changes?' }), 'Discard'));
  await waitVar('--accent', '#ff7a18');
  assert.equal((await themes())[0].colors.accent, '#ff7a18');
  console.log('ok: cancelled edits are dropped');

  // Closing the window with unsaved changes loses nothing, and leaves the saved look on the app
  win = await opening(button(page, 'Edit Harbor'));
  await setColor(win, 'Accent', '#00c2a8');
  await waitVar('--accent', '#00c2a8');
  await win.close();
  await waitVar('--accent', '#ff7a18');
  await page.getByText('Harbor has unsaved changes.').waitFor();
  win = await opening(button(page, 'Continue editing'));
  await waitVar('--accent', '#00c2a8');
  assert.equal(await panel(win).getByLabel('Accent code', { exact: true }).inputValue(), '#00c2a8');
  await win.close();
  await page.getByText('Harbor has unsaved changes.').waitFor();
  await button(page, 'Discard').click();
  await button(page, 'Create theme').waitFor();
  assert.equal((await themes())[0].colors.accent, '#ff7a18');
  console.log('ok: a closed window keeps unsaved changes until continued or discarded');

  // Export, then import the file as a second theme
  const downloading = page.waitForEvent('download');
  await button(page, 'Export Harbor').click();
  const download = await downloading;
  assert.equal(download.suggestedFilename(), 'harbor.mumh5-theme.json');
  const file = path.join(temp, 'harbor.json');
  await download.saveAs(file);
  const exported = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(exported.mumh5Theme, 1);
  assert.equal('id' in exported, false, 'a shared file has no local id');
  await page.getByLabel('Import theme file').setInputFiles(file);
  await page.getByRole('radio', { name: 'Harbor (2)', exact: true }).waitFor();
  assert.equal((await themes()).length, 2);
  console.log('ok: export and import');

  // A hostile file adds nothing to the page; a file that is no theme is refused
  const hostile = path.join(temp, 'hostile.json');
  const colors = { ...exported.colors, link: 'red;background:url(https://example.com/x)' };
  await writeFile(hostile, JSON.stringify({ ...exported, name: 'Hostile', colors, font: 'url(https://example.com/f)' }));
  await page.getByLabel('Import theme file').setInputFiles(hostile);
  await page.getByRole('radio', { name: 'Hostile', exact: true }).waitFor();
  assert.match(await rootVar('--link'), /^#[0-9a-f]{6}$/);
  const broken = path.join(temp, 'broken.json');
  await writeFile(broken, '{"hello":1}');
  await page.getByLabel('Import theme file').setInputFiles(broken);
  await button(page.getByRole('dialog', { name: 'Could not import' }), 'OK').click();
  assert.equal((await themes()).length, 3);
  console.log('ok: theme files are checked');

  // Deleting the theme in use goes back to the default
  await button(page, 'Delete Hostile').click();
  await button(page.getByRole('dialog', { name: 'Delete Hostile?' }), 'Delete').click();
  await page.getByRole('radio', { name: 'Hostile', exact: true }).waitFor({ state: 'detached' });
  await waitVar('--accent', originalAccent);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), undefined);
  assert.equal('theme' in await saved(), false, 'the default is not saved');

  // Resetting the color scheme keeps what people made
  await page.getByRole('radio', { name: 'Harbor', exact: true }).click();
  await button(page, 'Reset color scheme').click();
  await button(page, 'Reset').click();
  await waitVar('--accent', originalAccent);
  assert.equal((await themes()).length, 2);
  console.log('ok: delete and reset');

  // A built-in scheme changed in place: it keeps its name, its data-theme and its place
  const edits = () => page.evaluate(() => JSON.parse(localStorage.getItem('mumh5.schemeEdits') ?? '[]'));
  await page.getByRole('radio', { name: 'Light', exact: true }).click();
  await waitVar('--accent', '#5b4bdb');
  win = await opening(button(page, 'Edit Light'));
  assert.equal(await panel(win).getByLabel('Name', { exact: true }).count(), 0, 'a scheme keeps its name');
  await setColor(win, 'Accent', '#00c2a8');
  await waitVar('--accent', '#00c2a8');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'light');
  await closing(win, button(panel(win), 'Save'));
  assert.equal((await saved()).theme, 'light');
  assert.deepEqual((await edits()).map((e: { scheme: string; colors: { accent: string } }) => [e.scheme, e.colors.accent]), [['light', '#00c2a8']]);
  assert.equal((await themes()).length, 2, 'no theme of its own is made');
  await page.getByRole('radio', { name: 'Light', exact: true }).getByText('edited').waitFor();
  await button(page, 'Edit Light').scrollIntoViewIfNeeded();
  await shot(page, 'theme-scheme-edited');
  await page.reload();
  await waitVar('--accent', '#00c2a8');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'light');
  await appearance();
  await page.getByRole('radio', { name: 'Dark', exact: true }).click();
  await waitVar('--accent', originalAccent);
  assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue('--accent')), '');
  await page.getByRole('radio', { name: 'Light', exact: true }).click();
  await waitVar('--accent', '#00c2a8');
  // Opening it again starts from the saved changes
  win = await opening(button(page, 'Edit Light'));
  assert.equal(await panel(win).getByLabel('Accent code', { exact: true }).inputValue(), '#00c2a8');
  await button(panel(win), 'Original').click();
  await waitVar('--accent', '#5b4bdb');
  await button(panel(win), 'Undo').click();
  await waitVar('--accent', '#00c2a8');
  await closing(win, button(panel(win), 'Cancel'));
  await button(page, 'Reset Light').click();
  await button(page.getByRole('dialog', { name: 'Reset Light?' }), 'Reset').click();
  await waitVar('--accent', '#5b4bdb');
  assert.deepEqual(await edits(), []);
  await button(page, 'Reset Light').waitFor({ state: 'detached' });
  // Saving a scheme as it came keeps nothing
  win = await opening(button(page, 'Edit Light'));
  await setColor(win, 'Accent', '#00c2a8');
  await button(panel(win), 'Original').click();
  await closing(win, button(panel(win), 'Save'));
  assert.deepEqual(await edits(), []);
  await page.getByRole('radio', { name: 'Dark', exact: true }).click();
  await waitVar('--accent', originalAccent);
  console.log('ok: built-in schemes can be edited and reset');

  // A theme saved before hover labels existed: black accent, white hover, light label
  const amoled = path.join(temp, 'amoled.json');
  const { 'accent-hover-text': _unset, ...olderColors } = exported.colors;
  await writeFile(amoled, JSON.stringify({ ...exported, name: 'Amoled',
    colors: { ...olderColors, accent: '#000000', 'accent-hover': '#ffffff', 'accent-text': '#d4d4d4' } }));
  await page.getByLabel('Import theme file').setInputFiles(amoled);
  await page.getByRole('radio', { name: 'Amoled', exact: true }).waitFor();
  const mainButton = button(page, 'Create theme');
  await mainButton.hover();
  await page.waitForFunction(el => {
    const s = getComputedStyle(el as Element);
    return s.backgroundColor === 'rgb(255, 255, 255)' && s.color === 'rgb(11, 11, 11)';
  }, await mainButton.elementHandle());
  await page.mouse.move(2, 2);
  // Turning the hover white in the creator takes a white label along
  win = await opening(button(page, 'Edit Amoled'));
  await button(panel(win), 'All colors').click();
  await setColor(win, 'Accent hover', '#000000');
  await setColor(win, 'Text on accent hover', '#ffffff');
  await setColor(win, 'Accent hover', '#ffffff');
  await win.waitForFunction(() => (document.querySelector('[aria-label="Text on accent hover code"]') as HTMLInputElement).value === '#0b0b0b');
  await panel(win).getByText('Contrast is fine').waitFor();
  const saveButton = button(panel(win), 'Save');
  await saveButton.hover();
  await win.waitForFunction(el => {
    const s = getComputedStyle(el as Element);
    return s.backgroundColor === 'rgb(255, 255, 255)' && s.color === 'rgb(11, 11, 11)';
  }, await saveButton.elementHandle());
  // Back at the colors it opened with, so there is nothing to ask about
  await closing(win, button(panel(win), 'Cancel'));
  await button(page, 'Delete Amoled').click();
  await button(page.getByRole('dialog', { name: 'Delete Amoled?' }), 'Delete').click();
  await page.getByRole('radio', { name: 'Amoled', exact: true }).waitFor({ state: 'detached' });
  console.log('ok: a main button stays readable under the pointer');

  // A phone has no windows: the creator covers the app, whose layout stays as it is
  await page.setViewportSize({ width: 400, height: 800 });
  const pagesBefore = context.pages().length;
  await button(page, 'Create theme').click();
  await panel(page).waitFor();
  assert.equal(context.pages().length, pagesBefore, 'no window on a phone');
  const phone = (await panel(page).boundingBox())!;
  assert.deepEqual([phone.width, phone.height], [400, 800]);
  assert.equal((await page.locator('.frame').boundingBox())!.height, 800, 'the app is not squeezed');
  assert.equal(await panel(page).evaluate(el => el.querySelector('.body')!.scrollWidth <= el.querySelector('.body')!.clientWidth), true, 'no sideways scrolling');
  await shot(page, 'theme-creator-phone');
  await button(page, 'Close theme creator').click();
  await settings.waitFor();
  await page.setViewportSize({ width: 1400, height: 860 });

  // A blocked pop-up: it lies over the edge of the app instead
  await page.evaluate(() => { (window as unknown as { realOpen: typeof window.open }).realOpen = window.open; window.open = () => null; });
  await button(page, 'Create theme').click();
  await panel(page).waitFor();
  assert.equal((await panel(page).boundingBox())!.width, 420);
  assert.equal((await page.locator('.frame').boundingBox())!.width, 1400, 'the app is not resized');
  await button(page, 'Close theme creator').click();
  await settings.waitFor();
  await page.evaluate(() => { window.open = (window as unknown as { realOpen: typeof window.open }).realOpen; });
  console.log('ok: phone width and blocked pop-ups');

  // With Settings in its own window too, each keeps to its own (where Settings has that button)
  const popOut = page.getByRole('button', { name: 'Open in a new window' });
  if (await popOut.count()) {
    const [popup] = await Promise.all([context.waitForEvent('page'), popOut.click()]);
    await popup.getByRole('tab', { name: 'Appearance' }).waitFor();
    win = await opening(button(popup, 'Create theme'));
    await button(popup, 'Back to the creator').waitFor();
    await setColor(win, 'Accent', '#00c2a8');
    await waitVar('--accent', '#00c2a8', popup);
    await button(panel(win), 'Cancel').click();
    await button(win.getByRole('dialog', { name: 'Discard changes?' }), 'Cancel').click();
    assert.equal(await popup.getByRole('dialog', { name: 'Discard changes?' }).count(), 0, 'asked in the creator only');
    await closing(win, button(panel(win), 'Save'));
    await popup.getByRole('radio', { name: 'My theme', exact: true }).waitFor();
    const fromPopup = popup.waitForEvent('download');
    await button(popup, 'Export My theme').click();
    assert.equal((await fromPopup).suggestedFilename(), 'my-theme.mumh5-theme.json');
    await popup.close();
    await appearance();
    console.log('ok: works with Settings in its own window');
  }

  assert.deepEqual(failures, []);
  console.log('THEME CREATOR E2E PASSED');
} finally {
  await browser.close();
  await server.close();
  await rm(temp, { recursive: true, force: true });
}
