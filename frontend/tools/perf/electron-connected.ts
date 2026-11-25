// Drives main's Electron app to the same state as the Tauri smoke: identity set up, connected to the
// test server in Root, a silent microphone. Prints "READY <pid>" and holds the connection.
//   bun tools/perf/electron-connected.ts --app /path/to/main-checkout --profile /tmp/dir [--hold 60]
import { _electron as electron } from 'playwright-core';

const arg = (name: string, fallback: string) => { const i = Bun.argv.indexOf(`--${name}`); return i > 0 ? Bun.argv[i + 1] : fallback; };
const appDir = arg('app', '');
const hold = Number(arg('hold', '60'));
const app = await electron.launch({
  executablePath: `${appDir}/node_modules/electron/dist/electron`,
  args: [appDir, `--user-data-dir=${arg('profile', '/tmp/mumh5-electron-perf')}`, '--ozone-platform=x11'],
  env: { ...process.env, DISPLAY: ':193', WAYLAND_DISPLAY: '', XDG_SESSION_TYPE: 'x11', LANG: 'en_US.UTF-8' }
});
try {
  const page = await app.firstWindow();
  // The same silent microphone the Tauri smoke uses: no hardware, nothing transmitted
  await page.evaluate(() => { navigator.mediaDevices.getUserMedia = async () => new AudioContext().createMediaStreamDestination().stream; });
  await page.getByRole('button', { name: /Create a new identity/ }).click();
  await page.getByLabel('Name', { exact: true }).fill('electron-perf');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'Add a server', exact: true }).first().click();
  await page.locator('#c-host').fill('127.0.0.1');
  await page.getByLabel('Port', { exact: true }).fill('64750');
  await page.locator('#c-user').fill('electron-perf');
  await page.getByRole('button', { name: 'Save and connect' }).click();
  await page.getByText('Root', { exact: true }).first().waitFor({ timeout: 20000 });
  console.log(`READY ${app.process().pid}`);
  await Bun.sleep(hold * 1000);
} finally {
  await app.close();
}
