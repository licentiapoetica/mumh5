import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';
// After the components' styles, so themes override them
import './themes.css';
import { startTray } from './lib/tray.svelte.ts';
import { startTextMenu } from './lib/text-menu.ts';
import { startHints } from './lib/hints.ts';
import { isWeb } from './lib/native.ts';
import { proxyInfo } from './lib/web.svelte.ts';

if (isWeb) proxyInfo.load();

mount(App, { target: document.getElementById('app')! });
startTray();
startTextMenu();
startHints();
