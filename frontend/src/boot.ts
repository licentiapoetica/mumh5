import { debugLog } from './core/debug-log.ts';
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
import { startMediaControls } from './lib/media-controls.svelte.ts';

debugLog.record('info', 'app', 'Dream Cord started', { platform: isWeb ? 'web' : 'desktop', version: __DREAM_CORD_BUILD__.version });
if (isWeb) void proxyInfo.load();
useWorkerTimers();
window.addEventListener('online', () => debugLog.record('info', 'network', 'Network reported online'));
window.addEventListener('offline', () => debugLog.record('warn', 'network', 'Network reported offline'));
document.addEventListener('visibilitychange', () => debugLog.record('info', 'app', 'Visibility changed', { state: document.visibilityState }));
window.addEventListener('error', e => debugLog.record('error', 'app', e.message || 'Uncaught script error'));
window.addEventListener('unhandledrejection', e => debugLog.record('error', 'app', e.reason instanceof Error ? e.reason.message : 'Unhandled asynchronous error'));

mount(App, { target: document.getElementById('app')! });
startTray();
startTextMenu();
startHints();
serverStatus.start();
updates.start();
startMediaControls();
