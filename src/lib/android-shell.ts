// The Android app (a Capacitor shell around this site) injects window.Capacitor. While voice runs it
// starts a foreground service, so the microphone and network keep working with the screen off.
// Everywhere else these calls do nothing.
import { connLog } from './conn-log.svelte.ts';

interface VoiceBridge { start(o: { text: string }): Promise<unknown>; stop(): Promise<unknown> }
interface CapacitorGlobal { isNativePlatform?: () => boolean; Plugins?: { Voice?: VoiceBridge } }

function bridge(): VoiceBridge | null {
  const cap = (globalThis as { Capacitor?: CapacitorGlobal }).Capacitor;
  return cap?.isNativePlatform?.() ? cap.Plugins?.Voice ?? null : null;
}

export function androidVoiceStart(text = 'In voice'): void {
  bridge()?.start({ text }).then(() => connLog.add('android voice service started'),
    (e: unknown) => connLog.add(`android voice service failed: ${(e as Error)?.message ?? e}`));
}

export function androidVoiceStop(): void {
  bridge()?.stop().catch(() => {});
}
