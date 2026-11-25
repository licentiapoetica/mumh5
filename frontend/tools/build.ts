import { compile, compileModule } from 'svelte/compiler';
import { basename, dirname, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { brotliCompress, constants, gzip } from 'node:zlib';
// Output paths become URLs: always forward slashes, also on Windows
const url = (p: string) => p.split(sep).join('/');
const root = Bun.fileURLToPath(new URL('../', import.meta.url));
const pkg = await Bun.file(`${root}package.json`).json();
let commit = Bun.env.GITHUB_SHA || '';
if (!commit) { try { const git = Bun.spawnSync(['git', 'rev-parse', 'HEAD'], { cwd: root }); if (git.exitCode === 0) commit = git.stdout.toString().trim(); } catch { /* Source archives have no Git metadata. */ } }
const info = { version: pkg.version, commit, repo: Bun.env.GITHUB_REPOSITORY || 'licentiapoetica/mumh5' };
const out = `${root}dist`;
await Bun.$`rm -rf ${out}`;
await Bun.$`mkdir -p ${out}/assets`;
const workers = new Map<string, string>();
for (const file of ['lib/audio/capture.worklet', 'lib/audio/playback.worklet', 'lib/audio/denoise.worklet', 'lib/tick.worker']) {
 const source = `${root}src/${file}.ts`;
 const worker = await Bun.build({ entrypoints: [source], target: 'browser', minify: true });
 if (!worker.success) throw new AggregateError(worker.logs);
 const name = `${file.split('/').pop()}-${new Bun.CryptoHasher('sha256').update(await worker.outputs[0].arrayBuffer()).digest('hex').slice(0, 16)}.js`;
 await Bun.write(`${out}/assets/${name}`, worker.outputs[0]);
 workers.set(resolve(source), `./assets/${name}`);
}
const css = new Map<string, string>();
const transpile = new Bun.Transpiler({ loader: 'ts', target: 'browser' });
const result = await Bun.build({
  entrypoints: [`${root}src/main.ts`], outdir: out, target: 'browser', format: 'esm', splitting: true,
  minify: true, naming: { entry: 'assets/[name]-[hash].[ext]', chunk: 'assets/[name]-[hash].[ext]', asset: 'assets/[name]-[hash].[ext]' },
  define: { 'import.meta.env': JSON.stringify({ MODE: 'web', PROD: true }), __MUMH5_BUILD__: JSON.stringify(info) },
  plugins: [{ name: 'svelte-and-assets', setup(build) {
    build.onResolve({ filter: /\?(worker&)?url$/ }, async args => {
      const path = args.path.split('?')[0];
      const source = Bun.resolveSync(path, dirname(args.importer));
      return { path: source, namespace: args.path.includes('worker&') ? 'worker-url' : 'asset-url' };
    });
    // Fonts as files beside the CSS, not inlined as base64 (Bun's default), so the browser
    // fetches only the subsets that unicode-range selects for the text on screen
    build.onResolve({ filter: /\.woff2?$/ }, async args => {
      const source = resolve(dirname(args.importer), args.path);
      const data = await Bun.file(source).arrayBuffer();
      const name = `${basename(source).replace(/\.woff2?$/, '')}-${new Bun.CryptoHasher('sha256').update(data).digest('hex').slice(0, 16)}${source.slice(source.lastIndexOf('.'))}`;
      await Bun.write(`${out}/assets/${name}`, data);
      return { path: `./${name}`, external: true };
    });
    build.onLoad({ filter: /.*/, namespace: 'asset-url' }, async args => {
      const name = `${Bun.hash(url(args.path)).toString(16)}-${basename(args.path)}`;
      await Bun.write(`${out}/assets/${name}`, Bun.file(args.path));
      return { contents: `export default ${JSON.stringify(`./assets/${name}`)}`, loader: 'js' };
    });
    build.onLoad({ filter: /.*/, namespace: 'worker-url' }, async args => {
      const worker = workers.get(resolve(args.path));
      if (!worker) throw new Error(`Worker was not built: ${args.path}`);
      return { contents: `export default ${JSON.stringify(worker)}`, loader: 'js' };
    });
    build.onLoad({ filter: /\.svelte$/ }, async args => {
      const compiled = compile(await Bun.file(args.path).text(), { filename: args.path, generate: 'client', css: 'external', dev: false });
      css.set(args.path, compiled.css?.code ?? '');
      return { contents: compiled.js.code, loader: 'js' };
    });
    build.onLoad({ filter: /\.svelte\.ts$/ }, async args => ({ contents: compileModule(transpile.transformSync(await Bun.file(args.path).text()), { filename: args.path, generate: 'client', dev: false }).js.code, loader: 'js' }));
  }}]
});
if (!result.success) throw new AggregateError(result.logs, 'Frontend build failed');
const componentCss = [...css.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, code]) => code).join('\n');
const componentName = `components-${new Bun.CryptoHasher('sha256').update(componentCss).digest('hex').slice(0, 16)}.css`;
await Bun.write(`${out}/assets/${componentName}`, componentCss);
const entry = result.outputs.find(o => o.kind === 'entry-point' && o.path.endsWith('.js'));
if (!entry) throw new Error('Missing browser entry point');
const styles = [`assets/${componentName}`, ...result.outputs.filter(o => o.path.endsWith('.css')).map(o => url(relative(out, o.path)))];
// main.ts imports boot.ts only after the platform starts; preload it and the chunks both import
// statically, so they load in parallel with the entry instead of one after another
const chunkImports = async (path: string) => Array.from((await Bun.file(path).text()).matchAll(/(?:from|import)\s*"\.\/([^"]+\.js)"/g), m => `${dirname(path)}/${m[1]}`);
const boot = result.outputs.find(o => o.kind === 'chunk' && basename(o.path).startsWith('boot-'));
if (!boot) throw new Error('Missing boot chunk');
const preload = new Set<string>();
for (const queue = [...await chunkImports(entry.path), boot.path]; queue.length;) {
 const path = queue.pop()!;
 if (!preload.has(path)) { preload.add(path); queue.push(...await chunkImports(path)); }
}
const preloads = [...preload].map(path => url(relative(out, path))).sort();
for await (const path of new Bun.Glob('**/*').scan({ cwd: `${root}public`, onlyFiles: true })) await Bun.write(`${out}/${path}`, Bun.file(`${root}public/${path}`));
for (const notice of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) await Bun.write(`${out}/${notice}`, Bun.file(`${root}../${notice}`));
const hash = new Bun.CryptoHasher('sha256');
const hashedFiles = Array.from(new Bun.Glob('**/*').scanSync({ cwd: out, onlyFiles: true })).map(url).sort();
for (const path of hashedFiles) { hash.update(path); hash.update(await Bun.file(`${out}/${path}`).arrayBuffer()); }
const buildId = hash.digest('hex');
await Bun.write(`${out}/version.json`, JSON.stringify({ build: buildId, ...info }));
for (const icon of ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png']) await Bun.write(`${out}/${icon}`, Bun.file(`${root}../build/web/${icon}`));
await Bun.write(`${out}/manifest.webmanifest`, JSON.stringify({ name: 'mumh5', short_name: 'mumh5', start_url: './', scope: './', display: 'standalone', background_color: '#171821', theme_color: '#171821', icons: [{ src: './icon-192.png', sizes: '192x192', type: 'image/png' }, { src: './icon-512.png', sizes: '512x512', type: 'image/png' }, { src: './icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }] }));
await Bun.write(`${out}/index.html`, `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#171821"><meta name="mumh5-build" content="${buildId}"><link rel="manifest" href="./manifest.webmanifest"><link rel="apple-touch-icon" href="./icon-192.png"><title>mumh5</title><link rel="icon" href="./favicon.svg">${styles.map(path => `<link rel="stylesheet" href="./${path}">`).join('')}${preloads.map(path => `<link rel="modulepreload" href="./${path}">`).join('')}</head><body><div id="app"></div><script type="module" src="./${url(relative(out, entry.path))}"></script></body></html>`);
console.log(`Built mumh5 (${result.outputs.length} bundles) with Bun.`);

const files: string[] = [];
for await (const found of new Bun.Glob('**/*').scan({ cwd: out, onlyFiles: true })) { const path = url(found); if (path !== 'version.json' && path !== 'sw.js' && path !== 'index.html') files.push(`./${path}`); }
const sw = (await Bun.file(`${root}../build/web/sw.js`).text()).replace('__VERSION__', buildId).replace('__FILES__', JSON.stringify(files.sort()));
await Bun.write(`${out}/sw.js`, sw);

// Web build only (`bun run build:web`): `.br` and `.gz` beside each compressible file for the
// gateway. Written last, so the build id and the service worker's file list stay the same.
// Tauri embeds every file in dist and compresses it itself, so desktop builds leave them out.
if (process.argv.includes('--precompress')) {
 const started = performance.now();
 const br = promisify(brotliCompress), gz = promisify(gzip);
 // Fonts, pictures, the zip and the model (already gzip inside) do not get smaller
 const compressible = /\.(js|mjs|css|html|json|svg|wasm|webmanifest|txt|md|map)$/;
 let before = 0, after = 0;
 await Promise.all(Array.from(new Bun.Glob('**/*').scanSync({ cwd: out, onlyFiles: true })).filter(path => compressible.test(path)).map(async path => {
  const data = new Uint8Array(await Bun.file(`${out}/${path}`).arrayBuffer());
  if (data.length < 512) return;
  // Quality 11 costs about 1.5 s per MB; the multi-MB wasm gets 9, a few percent larger
  const quality = data.length > 2_000_000 ? 9 : 11;
  const [b, g] = await Promise.all([
   br(data, { params: { [constants.BROTLI_PARAM_QUALITY]: quality, [constants.BROTLI_PARAM_LGWIN]: 24, [constants.BROTLI_PARAM_SIZE_HINT]: data.length } }),
   gz(data, { level: 9 })
  ]);
  before += data.length; after += b.length;
  // A variant that saves little is not worth the extra file
  if (b.length < data.length * 0.9) await Bun.write(`${out}/${path}.br`, b);
  if (g.length < data.length * 0.9) await Bun.write(`${out}/${path}.gz`, g);
 }));
 console.log(`Precompressed ${(before / 1048576).toFixed(1)} MiB to ${(after / 1048576).toFixed(1)} MiB (brotli) in ${((performance.now() - started) / 1000).toFixed(1)} s.`);
}
