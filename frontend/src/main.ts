import { initializePlatform } from './lib/tauri.ts';
await initializePlatform();
await import('./boot.ts');
