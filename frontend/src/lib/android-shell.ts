// The Tauri Android host keeps voice and its notification alive with the screen off.
import { connLog } from './conn-log.svelte.ts';
import { invoke } from '@tauri-apps/api/core';
import { addPluginListener } from '@tauri-apps/api/core';
export function inAndroidShell(): boolean { return '__TAURI_INTERNALS__' in globalThis && /Android/.test(navigator.userAgent); }
let onStarted: (() => void) | null = null;
export function androidVoiceOnStarted(fn: () => void): void { onStarted = fn; }
export function androidVoiceStart(text = 'In voice'): void {
 if (!inAndroidShell()) return;
 void invoke<{batteryExempt:boolean}>('plugin:voice|start', { text }).then(r => { onStarted?.(); connLog.add(`android voice service started, battery optimization ${r.batteryExempt ? 'off' : 'on'}`); }, e => connLog.add(`android voice service failed: ${String(e)}`));
}
export function androidVoiceStop(): void { if (inAndroidShell()) void invoke('plugin:voice|stop').catch(() => {}); }
export function androidVoiceListen(fn: (action: string) => void): boolean {
 if (!inAndroidShell()) return false;
 void addPluginListener<{ action: string }>('voice', 'action', e => fn(e.action)); return true;
}
export function androidVoiceUpdate(state: { text: string; muted: boolean; deafened: boolean }): void { if (inAndroidShell()) void invoke('plugin:voice|update', state).catch(() => {}); }
