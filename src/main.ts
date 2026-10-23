import { mount } from 'svelte';
// Inter, bundled: the font files are served by the app itself
import '@fontsource-variable/inter/wght.css';
import '@fontsource-variable/inter/wght-italic.css';
import './app.css';
import App from './App.svelte';
// After the components' styles, so themes override them
import './themes.css';
import './themes-generated.css';
import { startTray } from './lib/tray.svelte.ts';
import { startTextMenu } from './lib/text-menu.ts';
import { startHints } from './lib/hints.ts';
import { isWeb } from './lib/native.ts';
import { proxyInfo } from './lib/web.svelte.ts';
import { serverStatus } from './lib/server-status.svelte.ts';

if (isWeb) proxyInfo.load();

mount(App, { target: document.getElementById('app')! });
startTray();
startTextMenu();
startHints();
serverStatus.start();
