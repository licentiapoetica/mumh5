import { mount } from 'svelte';
// Inter, bundled: the font files are served by the app itself
import '@fontsource-variable/inter/wght.css';
import '@fontsource-variable/inter/wght-italic.css';
import './app.css';
import App from './App.svelte';
// After the components' styles, so themes override them
import './themes.css';
import './themes-generated.css';
import './corners.css';
import { startTray } from './lib/tray.svelte.ts';
import { startTextMenu } from './lib/text-menu.ts';
import { startHints } from './lib/hints.ts';
import { isWeb } from './lib/native.ts';
import { proxyInfo } from './lib/web.svelte.ts';
import { serverStatus } from './lib/server-status.svelte.ts';
import { updates } from './lib/updates.svelte.ts';
import { useWorkerTimers } from './lib/worker-timer.ts';
import { startAndroidControls } from './lib/android-controls.svelte.ts';
import { connLog } from './lib/conn-log.svelte.ts';
import { startMediaControls } from './lib/media-controls.svelte.ts';

if (isWeb) { proxyInfo.load(); useWorkerTimers(); }
// Web build: the service worker makes the page installable and lets it open offline
if (isWeb && import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(e => console.warn('Service worker not registered:', e));
}

mount(App, { target: document.getElementById('app')! });
startTray();
startTextMenu();
startHints();
serverStatus.start();
updates.start();
startMediaControls();
startAndroidControls();
connLog.start();
