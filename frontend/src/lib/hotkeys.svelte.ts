import { comboFromEvent, hasModifier, portalTrigger, type HotkeyAction } from '../core/hotkeys.ts';
import { store } from './settings.svelte.ts';
import { desktop } from './native.ts';
import { session, sessions } from './session.svelte.ts';
import { voice } from './audio/voice.svelte.ts';

// Mute and deafen hotkeys while mumh5 has focus, and, on desktop if turned on, push to talk, mute
// and deafen system-wide through the desktop portal (Wayland lets no program grab keys itself).

const DESCRIPTIONS: Record<'ptt' | HotkeyAction, string> = { ptt: 'Push to talk (hold)', mute: 'Mute or unmute', deafen: 'Deafen or undeafen' };

function target() { return sessions.voiceSession ?? session; }
export function toggleMute(): void { const s = target(); s.setSelfMute(!(s.self?.selfMute ?? sessions.mute)); }
export function toggleDeaf(): void { const s = target(); s.setSelfDeaf(!(s.self?.selfDeaf ?? sessions.deaf)); }

class Hotkeys {
  // A key is being recorded in Settings: nothing fires meanwhile
  capturing = $state(false);
  // System-wide state: off, being set up (the desktop may ask), on with the desktop's triggers, or why not
  global = $state<{ state: 'off' | 'binding' | 'on' | 'failed'; triggers: Record<string, string>; error: string }>({ state: 'off', triggers: {}, error: '' });
  readonly available = !!desktop?.hotkeysBind;

  combo(action: HotkeyAction): string { return store.settings.hotkeys?.[action] ?? ''; }

  set(action: HotkeyAction, combo: string): void {
    store.settings.hotkeys = { mute: this.combo('mute'), deafen: this.combo('deafen'), [action]: combo };
    store.saveSettings();
  }

  // Taken over by the desktop: the window's own handling stays out, so nothing fires twice
  private systemWide(id: string): boolean { return this.global.state === 'on' && !!this.global.triggers[id]; }

  private onKey = (e: KeyboardEvent) => {
    if (this.capturing || e.repeat) return;
    const combo = comboFromEvent(e);
    if (!combo) return;
    const t = e.target as HTMLElement | null;
    const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
    for (const action of ['mute', 'deafen'] as const) {
      if (this.combo(action) !== combo || this.systemWide(action)) continue;
      // A plain key belongs to the text being typed; one with Ctrl, Alt or Super may act anyway
      if (typing && !hasModifier(combo)) return;
      e.preventDefault();
      if (action === 'mute') toggleMute(); else toggleDeaf();
      return;
    }
  };

  private onSystemKey = (id: string, pressed: boolean) => {
    if (this.capturing) return;
    if (id === 'ptt') voice.setPtt(pressed);
    else if (pressed && id === 'mute') toggleMute();
    else if (pressed && id === 'deafen') toggleDeaf();
  };

  private bindRun = 0;
  private async bind(wanted: { id: string; description: string; trigger: string | null }[] | null) {
    const run = ++this.bindRun;
    if (!wanted || !desktop?.hotkeysBind) {
      voice.pttGlobal = false;
      if (this.global.state !== 'off') await desktop?.hotkeysUnbind?.().catch(() => {});
      if (run === this.bindRun) this.global = { state: 'off', triggers: {}, error: '' };
      return;
    }
    this.global = { state: 'binding', triggers: {}, error: '' };
    try {
      const bound = await desktop.hotkeysBind(wanted);
      if (run !== this.bindRun) return;
      const triggers = Object.fromEntries(bound.map(b => [b.id, b.trigger]));
      this.global = { state: 'on', triggers, error: '' };
      voice.pttGlobal = !!triggers.ptt;
    } catch (e) {
      if (run !== this.bindRun) return;
      voice.pttGlobal = false;
      this.global = { state: 'failed', triggers: {}, error: (e as Error).message };
    }
  }

  start(): void {
    window.addEventListener('keydown', this.onKey);
    desktop?.onHotkey?.(this.onSystemKey);
    $effect.root(() => {
      $effect(() => {
        const on = this.available && store.settings.globalHotkeys;
        const wanted = [
          { id: 'ptt', combo: voice.settings.pttKey ?? '' },
          { id: 'mute', combo: this.combo('mute') },
          { id: 'deafen', combo: this.combo('deafen') }
        ].filter(h => h.combo).map(h => ({ id: h.id, description: DESCRIPTIONS[h.id as 'ptt'], trigger: portalTrigger(h.combo) }));
        // A short pause, so recording a key does not ask the desktop at every step
        const timer = setTimeout(() => void this.bind(on && wanted.length ? wanted : null), 600);
        return () => clearTimeout(timer);
      });
    });
  }
}

export const hotkeys = new Hotkeys();
