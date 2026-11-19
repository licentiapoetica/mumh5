import * as esbuild from 'esbuild';
import { pathToFileURL } from 'node:url';

// Bundles the Electron main and preload scripts to CommonJS in dist-electron/.
export const options = {
  entryPoints: { main: 'electron/main.ts', preload: 'electron/preload.ts' },
  outdir: 'dist-electron',
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
  sourcemap: true,
  logLevel: 'info'
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await esbuild.build(options);
