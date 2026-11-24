import { compile, compileModule } from 'svelte/compiler';
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
 workers.set(source, `./assets/${name}`);
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
      const source = Bun.resolveSync(path, args.importer.substring(0, args.importer.lastIndexOf('/')));
      return { path: source, namespace: args.path.includes('worker&') ? 'worker-url' : 'asset-url' };
    });
    build.onLoad({ filter: /.*/, namespace: 'asset-url' }, async args => {
      const name = `${Bun.hash(args.path).toString(16)}-${args.path.split('/').pop()}`;
      await Bun.write(`${out}/assets/${name}`, Bun.file(args.path));
      return { contents: `export default ${JSON.stringify(`./assets/${name}`)}`, loader: 'js' };
    });
    build.onLoad({ filter: /.*/, namespace: 'worker-url' }, async args => {
      const url = workers.get(args.path);
      if (!url) throw new Error(`Worker was not built: ${args.path}`);
      return { contents: `export default ${JSON.stringify(url)}`, loader: 'js' };
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
await Bun.write(`${out}/${componentName}`, componentCss);
const entry = result.outputs.find(o => o.kind === 'entry-point' && o.path.endsWith('.js'));
if (!entry) throw new Error('Missing browser entry point');
const styles = [componentName, ...result.outputs.filter(o => o.path.endsWith('.css')).map(o => o.path.slice(out.length + 1))];
for await (const path of new Bun.Glob('**/*').scan({ cwd: `${root}public`, onlyFiles: true })) await Bun.write(`${out}/${path}`, Bun.file(`${root}public/${path}`));
for (const notice of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) await Bun.write(`${out}/${notice}`, Bun.file(`${root}../${notice}`));
const hash = new Bun.CryptoHasher('sha256');
const hashedFiles = Array.from(new Bun.Glob('**/*').scanSync({ cwd: out, onlyFiles: true })).sort();
for (const path of hashedFiles) { hash.update(path); hash.update(await Bun.file(`${out}/${path}`).arrayBuffer()); }
const buildId = hash.digest('hex');
await Bun.write(`${out}/version.json`, JSON.stringify({ build: buildId, ...info }));
for (const icon of ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png']) await Bun.write(`${out}/${icon}`, Bun.file(`${root}../build/web/${icon}`));
await Bun.write(`${out}/manifest.webmanifest`, JSON.stringify({ name: 'mumh5', short_name: 'mumh5', start_url: './', scope: './', display: 'standalone', background_color: '#171821', theme_color: '#171821', icons: [{ src: './icon-192.png', sizes: '192x192', type: 'image/png' }, { src: './icon-512.png', sizes: '512x512', type: 'image/png' }, { src: './icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }] }));
await Bun.write(`${out}/index.html`, `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#171821"><meta name="mumh5-build" content="${buildId}"><link rel="manifest" href="./manifest.webmanifest"><link rel="apple-touch-icon" href="./icon-192.png"><title>mumh5</title><link rel="icon" href="./favicon.svg">${styles.map(path => `<link rel="stylesheet" href="./${path}">`).join('')}</head><body><div id="app"></div><script type="module" src="./${entry.path.slice(out.length + 1)}"></script></body></html>`);
console.log(`Built mumh5 (${result.outputs.length} bundles) with Bun.`);

const files: string[] = [];
for await (const path of new Bun.Glob('**/*').scan({ cwd: out, onlyFiles: true })) if (path !== 'version.json' && path !== 'sw.js' && path !== 'index.html') files.push(`./${path}`);
const sw = (await Bun.file(`${root}../build/web/sw.js`).text()).replace('__VERSION__', buildId).replace('__FILES__', JSON.stringify(files.sort()));
await Bun.write(`${out}/sw.js`, sw);
