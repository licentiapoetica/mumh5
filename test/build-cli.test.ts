import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { buildCli } from '../scripts/build-cli.mjs';

const run = promisify(execFile);

test('standalone CLI and audio SDK run outside the repository without installed dependencies', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'mumh5-cli-build-'));
  try {
    await buildCli(directory);
    const help = await run(process.execPath, [path.join(directory, 'main.mjs'), '--help'], { cwd: directory });
    assert.match(help.stdout, /headless client/);
    const sdk = pathToFileURL(path.join(directory, 'index.mjs')).href;
    const probe = await run(process.execPath, ['--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      import { DuplexAudio, AUDIO_BYTES } from ${JSON.stringify(sdk)};
      const audio = await DuplexAudio.create({ sendVoice() {}, protobufVoice: true });
      assert.notEqual(audio.input, audio.output);
      assert.equal(AUDIO_BYTES, 960);
      audio.close();
      console.log('standalone audio works');
    `], { cwd: directory });
    assert.match(probe.stdout, /standalone audio works/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
