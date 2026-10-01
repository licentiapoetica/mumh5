import * as esbuild from 'esbuild';

// Bundles the web proxy to one file, dist-proxy/proxy.mjs, that runs with plain Node.
await esbuild.build({
  entryPoints: { proxy: 'server/main.ts' },
  outdir: 'dist-proxy',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // Bundled CommonJS dependencies still call require()
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  logLevel: 'info'
});
