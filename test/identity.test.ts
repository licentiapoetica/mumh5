import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { generateIdentity, identityFromP12, identityToP12 } from '../electron/identity.ts';
import { IdentityStore } from '../electron/identity-store.ts';

const tmp = () => mkdtempSync(path.join(tmpdir(), 'mumh5-id-'));

test('PKCS#12 export and import round trip', () => {
  const id = generateIdentity('roundtrip', 'rt@example.com');
  const p12 = identityToP12(id, 'hunter22', 'roundtrip');
  const back = identityFromP12(p12, 'hunter22');
  assert.equal(back.fingerprint, id.fingerprint);
  assert.throws(() => identityFromP12(p12, 'wrong'), /Wrong password/);
});

test('store migrates the legacy identity and still asks for setup', async () => {
  const dir = tmp();
  const legacy = generateIdentity('legacy user');
  writeFileSync(path.join(dir, 'identity.json'), JSON.stringify(legacy));
  const store = new IdentityStore(dir);
  const { identities, setupDone } = await store.list();
  assert.equal(setupDone, false);
  assert.equal(identities.length, 1);
  assert.equal(identities[0].fingerprint, legacy.fingerprint);
  assert.equal(identities[0].name, 'legacy user');
  assert.ok(identities[0].isDefault);
  assert.equal(statSync(path.join(dir, 'identities.json')).mode & 0o077, 0, 'identities file is owner-only');
  await store.finishSetup();
  assert.equal((await new IdentityStore(dir).list()).setupDone, true);
});

test('store create, import, duplicates, default and remove', async () => {
  const store = new IdentityStore(tmp());
  const a = await store.create('alice', '');
  const other = generateIdentity('bob');
  const b = await store.importP12(identityToP12(other, 'pw', 'bob'), 'pw', '');
  assert.equal(b.name, 'bob');
  await assert.rejects(store.importP12(identityToP12(other, 'x', 'bob'), 'x', ''), /already stored/);
  assert.equal((await store.get()).id, a.id, 'first identity is the default');
  assert.equal((await store.get(b.id)).fingerprint, other.fingerprint);
  await store.setDefault(b.id);
  await store.remove(b.id);
  const { identities } = await store.list();
  assert.deepEqual(identities.map(i => [i.name, i.isDefault]), [['alice', true]]);
});

test('imports the desktop Mumble client certificate', async () => {
  const cfg = tmp();
  const mumble = generateIdentity('Mumble User');
  mkdirSync(path.join(cfg, 'Mumble', 'Mumble'), { recursive: true });
  const b64 = Buffer.from(identityToP12(mumble, '', 'Mumble User')).toString('base64');
  writeFileSync(path.join(cfg, 'Mumble', 'Mumble', 'mumble_settings.json'), JSON.stringify({ certificate: b64 }));
  const prev = { xdg: process.env.XDG_CONFIG_HOME, appdata: process.env.APPDATA, home: process.env.HOME };
  process.env.XDG_CONFIG_HOME = cfg;
  process.env.APPDATA = path.join(cfg, 'none');
  process.env.HOME = path.join(cfg, 'none');
  try {
    const store = new IdentityStore(tmp());
    assert.deepEqual(await store.findMumbleCertificate().then(f => f?.name), 'Mumble User');
    const imported = await store.importFromMumble('');
    assert.equal(imported.fingerprint, mumble.fingerprint);
  } finally {
    for (const [k, v] of Object.entries({ XDG_CONFIG_HOME: prev.xdg, APPDATA: prev.appdata, HOME: prev.home })) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});
