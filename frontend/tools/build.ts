import { compile, compileModule } from 'svelte/compiler';
const root = new URL('../', import.meta.url).pathname;
const out = `${root}dist`;
await Bun.$`rm -rf ${out}`;
await Bun.$`mkdir -p ${out}/assets`;
const workers = new Map<string, string>();
for (const file of ['capture', 'playback', 'denoise']) {
 const source = `${root}src/lib/audio/${file}.worklet.ts`;
 const name = `${file}.worklet.js`;
 const worker = await Bun.build({ entrypoints: [source], target: 'browser', minify: true });
 if (!worker.success) throw new AggregateError(worker.logs);
 await Bun.write(`${out}/assets/${name}`, worker.outputs[0]);
 workers.set(source, `./assets/${name}`);
}
const css = new Map<string, string>();
const transpile = new Bun.Transpiler({ loader: 'ts', target: 'browser' });
const result = await Bun.build({
  entrypoints: [`${root}src/main.ts`], outdir: out, target: 'browser', format: 'esm', splitting: true,
  minify: true, naming: { entry: '[name].[ext]', chunk: 'assets/[name]-[hash].[ext]', asset: 'assets/[name]-[hash].[ext]' },
  define: { 'import.meta.env': JSON.stringify({ MODE: 'web', PROD: true }), __DREAM_CORD_BUILD__: JSON.stringify({ version: '0.1.0', commit: '', repo: 'lokoamigo/dream-cord' }) },
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
      return { contents: `export default ${JSON.stringify(workers.get(args.path))}`, loader: 'js' };
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
await Bun.write(`${out}/components.css`, [...css.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, code]) => code).join('\n'));
for await (const path of new Bun.Glob('**/*').scan({ cwd: `${root}public`, onlyFiles: true })) await Bun.write(`${out}/${path}`, Bun.file(`${root}public/${path}`));
for (const notice of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) await Bun.write(`${out}/${notice}`, Bun.file(`${root}../${notice}`));
await Bun.write(`${out}/index.html`, `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#171821"><title>Dream Cord</title><link rel="icon" href="./favicon.svg"><link rel="stylesheet" href="./components.css"><link rel="stylesheet" href="./main.css"></head><body><div id="app"></div><script type="module" src="./main.js"></script></body></html>`);
console.log(`Built Dream Cord (${result.outputs.length} bundles) with Bun.`);
