import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

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

export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [svelte()],
  define: { __MUMH5_BUILD__: JSON.stringify(buildInfo()) },
  build: { target: 'chrome120', outDir: 'dist', emptyOutDir: true },
  // npm run dev:web: the page comes from Vite, the API from the proxy that script starts next to it
  server: mode === 'web' ? { proxy: { '/api': { target: 'http://127.0.0.1:8080', ws: true } } } : undefined
}));
