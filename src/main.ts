import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';
import { startTray } from './lib/tray.svelte.ts';

mount(App, { target: document.getElementById('app')! });
startTray();
