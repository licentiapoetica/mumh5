// The shell loads the hosted proxy (which serves the web build), so the relative api/ base in
// web.svelte.ts keeps working. Set MUMH5_APP_URL to its https address before `npx cap sync`.
// The bundled page in www/ only says that no address was given.
const url = process.env.MUMH5_APP_URL;

/** @type {import('@capacitor/cli').CapacitorConfig} */
const config = {
  appId: 'org.mumh5.app',
  appName: 'mumh5',
  webDir: 'www',
  // This folder is both the Capacitor project and its Android project
  android: { path: '.' },
  server: url ? { url, androidScheme: 'https' } : undefined,
};

module.exports = config;
