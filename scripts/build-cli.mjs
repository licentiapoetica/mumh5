import * as esbuild from 'esbuild';
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

export async function buildCli(directory = path.join(root, 'dist-cli')) {
  await mkdir(directory, { recursive: true });
  await esbuild.build({
    absWorkingDir: root, entryPoints: { main: 'cli/main.ts', index: 'cli/index.ts', 'video-worker': 'cli/video-worker.ts',
      'examples/chat-bot': 'cli/examples/chat-bot.mjs' },
    outdir: directory, outExtension: { '.js': '.mjs' }, bundle: true, splitting: true,
    platform: 'node', format: 'esm', target: 'node22',
    banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
    logLevel: 'info'
  });
  await copyFile(path.join(root, 'node_modules/@evan/opus/wasm/opus.wasm'), path.join(directory, 'opus.wasm'));
  const runtime = JSON.parse(await readFile(path.join(root, 'cli/package.json'), 'utf8'));
  await writeFile(path.join(directory, 'package.json'), JSON.stringify({ name: 'mumh5-headless', private: true, type: 'module',
    main: 'index.mjs', exports: './index.mjs', optionalDependencies: runtime.dependencies }, null, 2) + '\n');
  for (const [source, name] of [['cli/README.md', 'README.md'], ['cli/BOTS.md', 'BOTS.md'], ['LICENSE', 'LICENSE'], ['THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES.md']]) {
    await copyFile(path.join(root, source), path.join(directory, name));
  }
  await mkdir(path.join(directory, 'licenses'), { recursive: true });
  for (const name of ['node-webrtc.md', 'node-webrtc-third-party.md']) {
    await copyFile(path.join(root, 'cli/licenses', name), path.join(directory, 'licenses', name));
  }
  for (const [pkg, license] of [['node-forge', 'LICENSE'], ['protobufjs', 'LICENSE'], ['long', 'LICENSE'], ['@evan/opus', 'LICENSE']]) {
    await copyFile(path.join(root, 'node_modules', pkg, license), path.join(directory, 'licenses', pkg.replaceAll('/', '-') + '.txt'));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await buildCli();
