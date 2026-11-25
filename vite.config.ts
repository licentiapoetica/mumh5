import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import zlib from 'node:zlib';

// What this build is, for Settings > About and the update check: CI provides the commit and
// repository, local builds ask git; no commit means no update check
function buildInfo() {
  const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
  let commit = process.env.GITHUB_SHA ?? '';
  if (!commit) {
    try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* not a checkout */ }
  }
  return { version: String(version), commit, repo: process.env.GITHUB_REPOSITORY || 'licentiapoetica/mumh5' };
}

// Web build only: the manifest, the install icons and the service worker (build/web/), which
// lists every file of the build so the page also opens offline. The desktop build has none of it.
// The build id (a hash of the files) also goes into index.html, as the build the page runs, and
// into version.json, as the build the site serves now; the update check compares the two.
function pwa(): Plugin {
  const icons = [
    { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
  ];
  const manifest = {
    name: 'mumh5',
    short_name: 'mumh5',
    description: 'Mumble client',
    id: './',
    start_url: './',
    scope: './',
    display: 'standalone',
    background_color: '#141518',
    theme_color: '#141518',
    icons
  };
  return {
    name: 'mumh5-pwa',
    apply: 'build',
    transformIndexHtml: () => [
      { tag: 'link', attrs: { rel: 'manifest', href: './manifest.webmanifest' }, injectTo: 'head' },
      { tag: 'meta', attrs: { name: 'mumh5-build', content: '__MUMH5_WEB_BUILD__' }, injectTo: 'head' }
    ],
    // After the other plugins, so every asset and index.html are in the bundle
    generateBundle: { order: 'post', handler(_, bundle) {
      const emitted = new Map<string, string | Uint8Array>([
        ...icons.map(i => [i.src, readFileSync(`build/web/${i.src}`)] as const),
        ['manifest.webmanifest', JSON.stringify(manifest, null, 2)]
      ]);
      for (const [fileName, source] of emitted) this.emitFile({ type: 'asset', fileName, source });
      // Files whose names stay the same across builds, so their contents go into the version
      const fixed = new Map([...emitted, ...['favicon.svg', 'icon.png'].map(f => [f, readFileSync(`public/${f}`)] as const)]);
      // The noise filter is 17 MB: only people who choose it load it, so it stays out of the
      // offline cache (the gateway sends the engine compressed, see precompress())
      const deepFilter = /^assets\/(df-[^/]+\.wasm|DeepFilterNet3_onnx[^/]*\.bin)$/;
      // The 8 MB voice pack likewise: it is fetched when the first sound plays
      const voicePack = /^assets\/default-audio-pack-[^/]+\.zip$/;
      // Names under assets/ carry a content hash; index.html is cached as ./
      const files = [...Object.keys(bundle).filter(f => f.startsWith('assets/') && !f.endsWith('.map') && !deepFilter.test(f) && !voicePack.test(f)), ...fixed.keys()].sort();
      const hash = createHash('sha256').update(files.join('\n'));
      for (const source of fixed.values()) hash.update(source);
      const version = hash.digest('hex').slice(0, 12);
      const sw = readFileSync('build/web/sw.js', 'utf8')
        .replace('__VERSION__', version)
        .replace('__FILES__', JSON.stringify(files.map(f => `./${f}`)));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: sw });
      const { version: release, commit } = buildInfo();
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: version, version: release, commit }) + '\n' });
      const html = bundle['index.html'];
      if (html?.type !== 'asset' || !String(html.source).includes('__MUMH5_WEB_BUILD__')) throw new Error('index.html has no build id placeholder');
      html.source = String(html.source).replace('__MUMH5_WEB_BUILD__', version);
    } }
  };
}

// Web build only: .br and .gz copies beside the files a browser loads compressed well, which the
// gateway (crates/web) sends to browsers that accept them. Written after the bundle, so they are
// neither in the service worker's list nor in the build id. The desktop app reads its files from
// disk and needs none of them.
const brotli = promisify(zlib.brotliCompress), gzip = promisify(zlib.gzip);
const COMPRESSIBLE = /\.(html|js|mjs|css|json|svg|wasm|webmanifest|txt)$/;
function precompress(): Plugin {
  let outDir = '';
  return {
    name: 'mumh5-precompress',
    apply: 'build',
    configResolved(config) { outDir = path.resolve(config.root, config.build.outDir); },
    async closeBundle() {
      const started = Date.now();
      const files = (readdirSync(outDir, { recursive: true }) as string[])
        .map(f => path.join(outDir, f))
        .filter(f => COMPRESSIBLE.test(f) && statSync(f).isFile() && statSync(f).size >= 512);
      let before = 0, after = 0;
      await Promise.all(files.map(async file => {
        const data = await readFile(file);
        // Highest quality, except for the multi-MB WebAssembly files, where it costs seconds
        const quality = data.length > 2_000_000 ? 9 : 11;
        const [br, gz] = await Promise.all([
          brotli(data, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: quality, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: data.length } }),
          gzip(data, { level: 9 })
        ]);
        // A copy that saves little is not worth a second file
        if (br.length < data.length * 0.9) await writeFile(`${file}.br`, br);
        if (gz.length < data.length * 0.9) await writeFile(`${file}.gz`, gz);
        before += data.length;
        after += Math.min(br.length, data.length);
      }));
      console.log(`Precompressed ${files.length} files, ${(before / 1048576).toFixed(1)} MiB to ${(after / 1048576).toFixed(1)} MiB (brotli) in ${((Date.now() - started) / 1000).toFixed(1)} s`);
    }
  };
}

export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [svelte(), mode === 'web' && pwa(), mode === 'web' && precompress()],
  define: { __MUMH5_BUILD__: JSON.stringify(buildInfo()) },
  build: { target: 'chrome120', outDir: 'dist', emptyOutDir: true },
  // npm run dev:web: the page comes from Vite, the API from the proxy that script starts next to it
  server: mode === 'web' ? { proxy: { '/api': { target: 'http://127.0.0.1:8080', ws: true } } } : undefined
}));
