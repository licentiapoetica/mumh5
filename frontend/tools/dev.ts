// Bun serves browser assets; all desktop networking and storage stay in Rust.
const build = Bun.spawn(['bun', 'run', 'build'], { cwd: Bun.fileURLToPath(new URL('../', import.meta.url)), stdout: 'inherit', stderr: 'inherit' });
if (await build.exited) { throw new Error("Frontend build failed"); };
const root = Bun.fileURLToPath(new URL('../dist/', import.meta.url));
Bun.serve({ hostname: '127.0.0.1', port: 1420, async fetch(request) {
 const path = decodeURIComponent(new URL(request.url).pathname);
 if (path.includes('..')) return new Response('Invalid path', { status: 400 });
 const file = Bun.file(`${root}${path === '/' ? 'index.html' : path.slice(1)}`);
 return await file.exists() ? new Response(file) : new Response('Not found', { status: 404 });
}});
console.log('mumh5 assets: http://127.0.0.1:1420 (run bun run build after edits).');
