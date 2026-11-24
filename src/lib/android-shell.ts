// The Android app (a Capacitor shell around this site) injects window.Capacitor. While voice runs it
// starts a foreground service, so the microphone and network keep working with the screen off.
// Everywhere else these calls do nothing. Plugins are called through nativePromise, since
// Capacitor.Plugins.Voice only exists after registerPlugin, which this page never calls.
import { connLog } from './conn-log.svelte.ts';

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  nativePromise?: (plugin: string, method: string, options: object) => Promise<unknown>;
  nativeCallback?: (plugin: string, method: string, options: object, callback: (data: unknown) => void) => unknown;
}

function call(method: string, options: object): Promise<unknown> | null {
  const cap = (globalThis as { Capacitor?: CapacitorGlobal }).Capacitor;
  if (!cap?.isNativePlatform?.()) return null;
  if (!cap.nativePromise) {
    connLog.add('android shell has no native bridge');
    return null;
  }
  return cap.nativePromise('Voice', method, options);
}

// Called once the service runs, so a notification built with default buttons can be redrawn
let onStarted: (() => void) | null = null;
export function androidVoiceOnStarted(fn: () => void): void { onStarted = fn; }

// Whether this page runs inside the Android app
export function inAndroidShell(): boolean {
  return !!(globalThis as { Capacitor?: CapacitorGlobal }).Capacitor?.isNativePlatform?.();
}

export function androidVoiceStart(text = 'In voice'): void {
  call('start', { text })?.then(r => { onStarted?.(); connLog.add(`android voice service started, battery optimization ${(r as { batteryExempt?: boolean })?.batteryExempt ? 'off' : 'on'}`); },
    (e: unknown) => connLog.add(`android voice service failed: ${(e as Error)?.message ?? e}`));
}

export function androidVoiceStop(): void {
  call('stop', {})?.catch(() => {});
}

// The notification's buttons: "mute", "deafen" or "leave". Returns false outside the shell.
export function androidVoiceListen(fn: (action: string) => void): boolean {
  const cap = (globalThis as { Capacitor?: CapacitorGlobal }).Capacitor;
  if (!cap?.isNativePlatform?.() || !cap.nativeCallback) return false;
  cap.nativeCallback('Voice', 'addListener', { eventName: 'action' }, data => {
    const action = (data as { action?: unknown } | null)?.action;
    if (typeof action === 'string') fn(action);
  });
  return true;
}

// What the notification shows; ignored by the shell while voice is not running
export function androidVoiceUpdate(state: { text: string; muted: boolean; deafened: boolean }): void {
  call('update', state)?.catch(() => {});
}
