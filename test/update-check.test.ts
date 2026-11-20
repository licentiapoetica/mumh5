import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkForUpdate, releaseUrl } from '../src/core/update-check.ts';

const commit = 'f8904ba0c3d1e2f4a5b6c7d8e9f0a1b2c3d4e5f6';
function answer(status: number, body: unknown, seen: string[] = []) {
  return async (url: string) => { seen.push(url); return { ok: status >= 200 && status < 300, status, json: async () => body }; };
}

test('a release ahead of this build is an update', async () => {
  const seen: string[] = [];
  const info = await checkForUpdate('owner/repo', commit, answer(200, { status: 'ahead', ahead_by: 4, behind_by: 0 }, seen));
  assert.deepEqual(info, { newer: true, changes: 4, url: releaseUrl('owner/repo') });
  assert.equal(seen[0], `https://api.github.com/repos/owner/repo/compare/${commit}...snapshot?per_page=1`);
});

test('the same, an older or a branch build is not', async () => {
  for (const body of [{ status: 'identical', ahead_by: 0 }, { status: 'behind', ahead_by: 0, behind_by: 2 }, { status: 'diverged', ahead_by: 3, behind_by: 1 }]) {
    assert.equal((await checkForUpdate('owner/repo', commit, answer(200, body))).newer, false, body.status);
  }
});

test('errors and unusable input throw instead of claiming anything', async () => {
  await assert.rejects(checkForUpdate('owner/repo', commit, answer(404, { message: 'Not Found' })), /does not know/);
  await assert.rejects(checkForUpdate('owner/repo', commit, answer(403, {})), /403/);
  await assert.rejects(checkForUpdate('owner/repo', '', answer(200, {})), /No build commit/);
  await assert.rejects(checkForUpdate('owner/repo', 'main;x', answer(200, {})), /No build commit/);
  await assert.rejects(checkForUpdate('../evil', commit, answer(200, {})), /No build commit/);
});
