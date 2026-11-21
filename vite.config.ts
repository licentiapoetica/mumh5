import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import zlib, { brotliCompressSync } from 'node:zlib';

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
      // offline cache, and the proxy sends the engine compressed (the model already is)
      const deepFilter = /^assets\/(df-[^/]+\.wasm(\.br)?|DeepFilterNet3_onnx[^/]*\.bin)$/;
      // The 8 MB voice pack likewise: it is fetched when the first sound plays
      const voicePack = /^assets\/default-audio-pack-[^/]+\.zip$/;
      for (const [fileName, file] of Object.entries(bundle)) {
        if (file.type !== 'asset' || !/^assets\/df-[^/]+\.wasm$/.test(fileName)) continue;
        const params = { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 };
        this.emitFile({ type: 'asset', fileName: `${fileName}.br`, source: brotliCompressSync(file.source as Uint8Array, { params }) });
      }
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

export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [svelte(), mode === 'web' && pwa()],
  define: { __MUMH5_BUILD__: JSON.stringify(buildInfo()) },
  build: { target: 'chrome120', outDir: 'dist', emptyOutDir: true },
  // npm run dev:web: the page comes from Vite, the API from the proxy that script starts next to it
  server: mode === 'web' ? { proxy: { '/api': { target: 'http://127.0.0.1:8080', ws: true } } } : undefined
}));
