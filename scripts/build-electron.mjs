import * as esbuild from 'esbuild';

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

if (import.meta.url === `file://${process.argv[1]}`) await esbuild.build(options);
