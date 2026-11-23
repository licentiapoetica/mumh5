// Drive two built Electron apps against stock Mumble, mumbot peer and mumpeer.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { _electron as electron, type Page } from 'playwright-core';
import electronPath from 'electron';
import { openTls } from '../../electron/tls-transport.ts';
import { generateIdentity } from '../../electron/identity.ts';
import { MumbleClient } from '../../src/core/client.ts';
import { createCodec } from '../../src/core/proto.ts';
import type { Transport } from '../../src/core/transport.ts';

const target = process.env.MUMBLE_TEST_HOST;
const password = process.env.MUMBLE_SUPERUSER_PASSWORD;
const api = process.env.MUMPEER_TEST_API;
const secret = process.env.MUMPEER_API_SECRET;
if (!target || !password || !api || !secret) {
  console.log('Set MUMBLE_TEST_HOST, MUMBLE_SUPERUSER_PASSWORD, MUMPEER_TEST_API and MUMPEER_API_SECRET to run the mumpeer E2E test.');
  process.exit(0);
}
const { hostname: host, port } = new URL(`mumble://${target}`);
const root = path.resolve(import.meta.dirname, '../..');
const { ELECTRON_RUN_AS_NODE, WAYLAND_DISPLAY, ...env } = process.env;
const tag = Date.now() % 10000000;

async function waitFor(fn: () => unknown | Promise<unknown>, label: string, timeout = 12000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await fn()) return;
    await delay(100);
  }
  assert.fail(`Timed out waiting for ${label}`);
}

async function sessionCount(): Promise<number> {
  const response = await fetch(new URL('/v1/status', api), {
    headers: { Authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(2000)
  });
  assert.equal(response.status, 200);
  return (await response.json()).sessions;
}

async function adminClient() {
  const identity = generateIdentity('SuperUser');
  const client = new MumbleClient(createCodec());
  const transport: Transport = { onData: null, onClose: null, send: bytes => conn.send(bytes), close: () => conn.close() };
  const conn = openTls(host, Number(port) || 64738, identity.certPem, identity.keyPem, {
    onSecure: () => {}, onData: bytes => transport.onData?.(bytes), onClose: reason => transport.onClose?.(reason)
  });
  client.connect(transport, { username: 'SuperUser', password, os: 'test' });
  try {
    await waitFor(() => client.synced, 'SuperUser login');
    return client;
  } catch (error) {
    client.disconnect();
    throw error;
  }
}

const profiles: string[] = [];
const apps: Awaited<ReturnType<typeof electron.launch>>[] = [];
async function launch(name: string, admin: MumbleClient): Promise<Page> {
  const profile = mkdtempSync(path.join(tmpdir(), 'mumh5-mumpeer-e2e-'));
  profiles.push(profile);
  const app = await electron.launch({
    executablePath: electronPath as unknown as string,
    args: [root, `--user-data-dir=${profile}`, '--ozone-platform=x11', '--disable-audio-output'],
    env: { ...env, XDG_SESSION_TYPE: 'x11' } as Record<string, string>
  });
  apps.push(app);
  const page = await app.firstWindow();
  await page.route('https://api.github.com/**', route => route.abort());
  page.on('pageerror', error => console.error('Renderer:', error.message));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(() => {
    // Synthetic video exercises the normal capture dialog without sharing the test machine's display.
    navigator.mediaDevices.getDisplayMedia = async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 240;
      const context = canvas.getContext('2d')!;
      let frame = 0;
      const draw = () => {
        context.fillStyle = frame++ % 2 ? 'blue' : 'red';
        context.fillRect(0, 0, canvas.width, canvas.height);
      };
      draw();
      setInterval(draw, 100);
      return canvas.captureStream(10);
    };
    const pcs: RTCPeerConnection[] = [];
    Object.assign(window, { testPeerConnections: pcs });
    window.RTCPeerConnection = new Proxy(window.RTCPeerConnection, {
      construct(target, args) {
        const pc = new target(args[0]);
        pcs.push(pc);
        return pc;
      }
    });
  });
  await page.getByRole('dialog', { name: 'Set up your identity' }).waitFor();
  await page.getByRole('button', { name: /Create a new identity/ }).click();
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Show servers' }).click();
  await page.getByTitle('Settings').click();
  await page.getByRole('tab', { name: 'Appearance' }).click();
  await page.getByRole('radio', { name: 'Modern' }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByTitle('Add a server').click();
  await page.getByLabel('Address').fill(host);
  await page.getByLabel('Port').fill(port || '64738');
  await page.getByRole('button', { name: 'Save and connect' }).click();
  await page.getByText(/Connected/).first().waitFor();
  const find = () => [...admin.users.values()].find(u => u.name === name);
  await waitFor(() => find()?.hash, name + ' on the Mumble server');
  admin.register(find()!.session);
  await waitFor(() => find()?.userId != null, name + ' registered');
  return page;
}

async function route(page: Page, mode: string, debug?: string) {
  await page.evaluate(debug => {
    if (debug) localStorage.setItem('mumh5.iceDebug', debug);
    else localStorage.removeItem('mumh5.iceDebug');
  }, debug);
  await page.getByTitle('Settings').click();
  await page.getByRole('tab', { name: 'Screen sharing' }).click();
  await page.getByLabel('Screen sharing connection').selectOption(mode);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
}

async function available(page: Page, checkTrust = false) {
  await page.getByRole('button', { name: 'Server information', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Server information' });
  await dialog.getByText(/Available ·/).waitFor({ timeout: 12000 });
  if (checkTrust) {
    await dialog.getByRole('button', { name: 'Forget relay' }).click();
    await dialog.getByText('Relay trust required').waitFor();
    await dialog.getByRole('button', { name: 'Trust relay' }).click();
    await dialog.getByText(/Available ·/).waitFor();
  }
  await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
}

async function startShare(page: Page) {
  await page.getByRole('button', { name: 'Share your screen or camera', exact: true }).click();
  const consent = page.getByRole('button', { name: 'Continue', exact: true });
  if (await consent.isVisible()) await consent.click();
  const dialog = page.getByRole('dialog', { name: 'Share your screen' });
  await dialog.getByLabel('Quality').selectOption('low');
  const source = dialog.locator('.sources button').first();
  await source.click({ timeout: 20000 });
  await dialog.getByRole('button', { name: 'Start sharing', exact: true }).click();
}

async function watch(page: Page, name: string) {
  await page.locator('.sidebar').getByRole('button', { name: `Watch the screen of ${name}`, exact: true }).click();
  const consent = page.getByRole('button', { name: 'Continue', exact: true });
  if (await consent.isVisible()) await consent.click();
}

async function checkPicture(page: Page, route: 'relay-only' | 'fallback' | 'direct') {
  await waitFor(() => page.evaluate(async (route) => {
    const pcs = (window as Window & { testPeerConnections?: RTCPeerConnection[] }).testPeerConnections!;
    for (const pc of pcs.filter(pc => pc.connectionState === 'connected')) {
      const stats = await pc.getStats();
      const reports = [...stats.values()];
      const hasVideo = reports.some(stat => stat.type === 'inbound-rtp' && stat.framesDecoded > 1);
      const transport = reports.find(stat => stat.type === 'transport' && stat.selectedCandidatePairId);
      const pair = transport && stats.get(transport.selectedCandidatePairId);
      const local = pair && stats.get(pair.localCandidateId);
      const remote = pair && stats.get(pair.remoteCandidateId);
      if (!hasVideo || !local || !remote) continue;
      if (route === 'direct') return local.candidateType !== 'relay' && remote.candidateType !== 'relay';
      if (local.candidateType !== 'relay' || remote.candidateType !== 'relay') continue;
      if (!['192.0.2.1', '192.0.2.2'].includes(local.address) || !['192.0.2.1', '192.0.2.2'].includes(remote.address)) continue;
      if (route === 'relay-only' && pcs.some(pc => pc.getConfiguration().iceTransportPolicy !== 'relay'
        || pc.localDescription?.sdp.split('\r\n').some(line => line.startsWith('a=candidate:') && !/ typ relay raddr 0\.0\.0\.0 rport 0(?: |$)/.test(line)))) return false;
      return true;
    }
    return false;
  }, route), `decoded video on the ${route} route`, 48000);
}

const admin = await adminClient();
try {
  assert.equal(await sessionCount(), 0, 'run against an idle test relay');
  const aliceName = `mumpeer-a-${tag}`, bobName = `mumpeer-b-${tag}`;
  const alice = await launch(aliceName, admin);
  const bob = await launch(bobName, admin);
  await route(alice, 'relay-only');
  await route(bob, 'relay-only');
  await Promise.all([available(alice, true), available(bob)]);
  await Promise.all([startShare(alice), startShare(bob)]);
  await Promise.all([watch(alice, bobName), watch(bob, aliceName)]);
  await Promise.all([checkPicture(alice, 'relay-only'), checkPicture(bob, 'relay-only')]);
  assert.equal(await sessionCount(), 1, 'reciprocal shares reused one certificate pair');
  console.log('ok: relay-only screen sharing in both directions, via one mumpeer session');
  await alice.getByRole('button', { name: 'Stop sharing your screen', exact: true }).click();
  await bob.locator('.sidebar').getByRole('button', { name: `Watch the screen of ${aliceName}`, exact: true }).waitFor({ state: 'detached' });
  await checkPicture(alice, 'relay-only');
  assert.equal(await sessionCount(), 1, 'ending one share kept the other direction alive');

  await route(alice, 'fallback', 'relay');
  await route(bob, 'fallback', 'relay');
  await waitFor(async () => await sessionCount() === 0, 'the previous pair to close');
  await startShare(alice);
  await watch(bob, aliceName);
  try { await checkPicture(bob, 'fallback'); } catch (error) {
    for (const page of [alice, bob]) {
      const state = await page.evaluate(() => ({
        connections: (window as Window & { testPeerConnections?: RTCPeerConnection[] }).testPeerConnections!.map(pc => ({
          connection: pc.connectionState, ice: pc.iceConnectionState, gathering: pc.iceGatheringState,
          signaling: pc.signalingState, iceServers: pc.getConfiguration().iceServers?.length,
          local: pc.localDescription?.type, remote: pc.remoteDescription?.type
        })),
        stage: document.querySelector('.stage')?.textContent?.trim()
      }));
      console.error('Fallback diagnostics:', JSON.stringify(state));
    }
    throw error;
  }
  assert.equal(await sessionCount(), 1, 'fallback was carried by mumpeer');
  console.log('ok: ordinary ICE failed and mumpeer carried the fallback');

  await route(bob, 'standard');
  await waitFor(async () => await sessionCount() === 0, 'the fallback pair to close');
  await route(alice, 'relay-only');
  const connections = () => alice.evaluate(() => (window as Window & { testPeerConnections?: RTCPeerConnection[] }).testPeerConnections!.length);
  const before = await connections();
  await startShare(alice);
  await watch(bob, aliceName);
  await bob.getByText('Both users need to allow the same mumpeer relay.', { exact: true }).first().waitFor();
  assert.equal(await sessionCount(), 0, 'a client with mumpeer off cannot trigger a pair');
  assert.equal(await connections(), before, 'relay-only never created a direct peer connection');
  console.log('ok: relay-only fails closed with a client that has mumpeer off');

  await route(alice, 'fallback');
  await route(bob, 'fallback');
  await Promise.all([available(alice), available(bob)]);
  await startShare(alice);
  await watch(bob, aliceName);
  await checkPicture(bob, 'direct');
  assert.equal(await sessionCount(), 0, 'automatic mode kept a working direct route');
  await route(bob, 'off');
  assert.equal(await bob.getByRole('button', { name: 'Share your screen or camera', exact: true }).isDisabled(), true);
  console.log('ok: discovery can be re-enabled, working direct ICE avoids the relay, and sharing can be turned off');
} finally {
  admin.disconnect();
  await Promise.allSettled(apps.map(app => app.close()));
  for (const profile of profiles) rmSync(profile, { recursive: true, force: true });
}
