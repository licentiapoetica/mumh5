// Runtime Docker settings against the built browser client; no Mumble server needed.
// npm run build:web && node test/e2e/sound-pack-limits.e2e.ts
import './english.ts';
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import path from 'node:path';
import { zipSync } from 'fflate';
import { startProxy, configFromEnv } from '../../server/proxy.ts';
import { MIB } from '../../src/core/audio-pack-limits.ts';

function wav(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode('RIFF'), 0);
  view.setUint32(4, size - 8, true);
  bytes.set(new TextEncoder().encode('WAVEfmt '), 8);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 24000, true);
  view.setUint32(28, 48000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  bytes.set(new TextEncoder().encode('data'), 36);
  view.setUint32(40, size - 44, true);
  return bytes;
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined,
  headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--disable-audio-output'] });
try {
  for (const configured of [false, true]) {
    const proxy = await startProxy({ ...configFromEnv({ MUMH5_SERVERS: 'voice.example.org', MUMH5_STUN_PORT: '0',
      ...(configured ? { MUMH5_MAX_AUDIO_PACK_MB: '128', MUMH5_MAX_AUDIO_FILE_MB: '16', MUMH5_MAX_AUDIO_UNPACKED_MB: '256' } : {}) }),
      port: 0, staticDir: path.resolve('dist-web') });
    const context = await browser.newContext();
    try {
      await context.addInitScript(() => localStorage.setItem('mumh5.identities', JSON.stringify({ identities: [], defaultId: null, setupDone: true })));
      // Settings in the page, where the steps look for it, not in a window of its own
      await context.addInitScript(() => localStorage.setItem('mumh5.settingsInline', '1'));
      const page = await context.newPage();
      const errors: string[] = [];
      const uploads: string[] = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('request', req => { if (req.method() === 'POST') uploads.push(req.url()); });
      const open = async () => {
        await page.getByRole('button', { name: 'Configure', exact: true }).click();
        await page.getByRole('tab', { name: 'Sounds' }).click();
        await page.waitForFunction(() => !!document.querySelector('fieldset:not([disabled])'));
      };
      const importZip = async (name: string, bytes: Uint8Array) => {
        await page.locator('input[accept=".zip,application/zip"]').setInputFiles({ name, mimeType: 'application/zip', buffer: Buffer.from(bytes) });
      };
      await page.goto(`http://127.0.0.1:${proxy.port}/`);
      await open();
      const clip = 'AudioNotification/SelfMute.wav';
      await importZip('large-clip.zip', zipSync({ [clip]: wav(5 * MIB) }));
      if (!configured) {
        await page.getByText(`${clip} is larger than 4 MiB.`, { exact: true }).waitFor();
        await page.locator('.help strong').getByText('Chatterbox female (standard)', { exact: true }).waitFor();
      } else {
        await page.locator('.help strong').getByText('large-clip.zip', { exact: true }).waitFor();
        // A stored archive above the old ZIP cap, with clips above the old per-file cap.
        const files = Object.fromEntries(Array.from({ length: 4 }, (_, i) => [`AudioNotification/Clip${i}.wav`, wav(9 * MIB)]));
        await importZip('large-pack.zip', zipSync(files, { level: 0 }));
        await page.locator('.help strong').getByText('large-pack.zip', { exact: true }).waitFor();
        await page.reload();
        await open();
        await page.locator('.help strong').getByText('large-pack.zip', { exact: true }).waitFor();
        await page.getByLabel('Audio pack', { exact: true }).selectOption({ label: 'large-clip.zip' });
        await page.locator('.help strong').getByText('large-clip.zip', { exact: true }).waitFor();
        await page.getByRole('button', { name: 'Play You muted', exact: true }).click();
        await page.waitForFunction(() => (window as any).__mumh5Sounds?.includes('mute'));
        // Expanded audio above 64 MiB, compressed well below the ZIP limit.
        const expanded = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`AudioNotification/Expanded${i}.wav`, wav(12 * MIB)]));
        await importZip('expanded-pack.zip', zipSync(expanded));
        await page.locator('.help strong').getByText('expanded-pack.zip', { exact: true }).waitFor();
        // Rejections still describe the configured cap and preserve the active pack.
        await importZip('too-large.zip', zipSync({ [clip]: wav(17 * MIB) }));
        await page.getByText(`${clip} is larger than 16 MiB.`, { exact: true }).waitFor();
        await page.locator('.help strong').getByText('expanded-pack.zip', { exact: true }).waitFor();
      }
      assert.deepEqual(errors, []);
      assert.deepEqual(uploads, [], 'sound packs never leave the browser');
      console.log(`ok: ${configured ? 'configured' : 'default'} sound-pack limits in the browser`);
    } finally {
      await context.close();
      await proxy.close();
    }
  }
} finally {
  await browser.close();
}
