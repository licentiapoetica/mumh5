import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [svelte()],
  build: { target: 'chrome120', outDir: 'dist', emptyOutDir: true },
  // npm run dev:web: the page comes from Vite, the API from the proxy that script starts next to it
  server: mode === 'web' ? { proxy: { '/api': { target: 'http://127.0.0.1:8080', ws: true } } } : undefined
}));
