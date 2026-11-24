import type { CapacitorConfig } from '@capacitor/cli';

// The shell loads the hosted proxy (which serves the web build), so the relative api/ base in
// web.svelte.ts keeps working. Set MUMH5_APP_URL to its https address before `npx cap sync`.
const url = process.env.MUMH5_APP_URL;

const config: CapacitorConfig = {
  appId: 'org.mumh5.app',
  appName: 'mumh5',
  webDir: 'dist-web',
  server: url ? { url, androidScheme: 'https' } : undefined,
};

export default config;
