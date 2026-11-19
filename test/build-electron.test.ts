import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

test('Electron build runs from paths with URL characters and stays idle when imported', t => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const dir = mkdtempSync(join(tmpdir(), 'mumh5 build # '));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const script = join(dir, 'build-electron.mjs');
  copyFileSync(join(root, 'scripts/build-electron.mjs'), script);
  symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'), 'junction');
  mkdirSync(join(dir, 'electron'));
  for (const name of ['main', 'preload']) {
    writeFileSync(join(dir, 'electron', `${name}.ts`), `export const value: string = '${name}';`);
  }

  const imported = spawnSync(process.execPath, [
    '--input-type=module', '--eval', `await import(${JSON.stringify(pathToFileURL(script).href)})`
  ], { cwd: dir, encoding: 'utf8', timeout: 30_000 });
  assert.equal(imported.status, 0, imported.stderr);
  assert.equal(existsSync(join(dir, 'dist-electron')), false);

  const built = spawnSync(process.execPath, [script], { cwd: dir, encoding: 'utf8', timeout: 30_000 });
  assert.equal(built.status, 0, built.stderr);
  const require = createRequire(import.meta.url);
  for (const name of ['main', 'preload']) {
    assert.equal(require(join(dir, 'dist-electron', `${name}.cjs`)).value, name);
  }
});
