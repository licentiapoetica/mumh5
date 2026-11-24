// The Android app (a Capacitor shell around this site) injects window.Capacitor. While voice runs it
// starts a foreground service, so the microphone and network keep working with the screen off.
// Everywhere else these calls do nothing. Plugins are called through nativePromise, since
// Capacitor.Plugins.Voice only exists after registerPlugin, which this page never calls.
import { connLog } from './conn-log.svelte.ts';

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  nativePromise?: (plugin: string, method: string, options: object) => Promise<unknown>;
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

export function androidVoiceStart(text = 'In voice'): void {
  call('start', { text })?.then(r => connLog.add(`android voice service started, battery optimization ${(r as { batteryExempt?: boolean })?.batteryExempt ? 'off' : 'on'}`),
    (e: unknown) => connLog.add(`android voice service failed: ${(e as Error)?.message ?? e}`));
}

export function androidVoiceStop(): void {
  call('stop', {})?.catch(() => {});
}
