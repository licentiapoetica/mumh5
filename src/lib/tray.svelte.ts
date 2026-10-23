import { desktop } from './native.ts';
import { ICON_PATHS } from './icons.ts';
import { session, sessions } from './session.svelte.ts';
import { voice, type TransmitMode } from './audio/voice.svelte.ts';
import { ui } from './ui.svelte.ts';

type TrayLook = 'offline' | 'idle' | 'talking' | 'muted' | 'deafened';

const LOOK: Record<TrayLook, { bg: string; glyph: string }> = {
  offline: { bg: '#4a4c54', glyph: 'mic' },
  idle: { bg: '#141518', glyph: 'mic' }, // the app icon's black
  talking: { bg: '#2fb863', glyph: 'mic' },
  muted: { bg: '#e0443e', glyph: 'mic-off' },
  deafened: { bg: '#e0443e', glyph: 'headphones-off' }
};

const cache = new Map<TrayLook, string>();

// Square tile with a white glyph, like the rail tiles; 64 px so the OS can scale it down sharply
function drawIcon(look: TrayLook): string {
  const hit = cache.get(look);
  if (hit) return hit;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = LOOK[look].bg;
  ctx.fillRect(0, 0, size, size);
  ctx.translate(8, 8);
  ctx.scale(2, 2); // 24 unit glyph into 48 px
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2.6;
  ctx.lineCap = 'square';
  ctx.lineJoin = 'miter';
  ctx.stroke(new Path2D(ICON_PATHS[LOOK[look].glyph]));
  const url = canvas.toDataURL('image/png');
  cache.set(look, url);
  return url;
}

// Mirrors voice state into the system tray and handles its menu
export function startTray(): void {
  if (!desktop) return;
  const api = desktop;

  $effect.root(() => {
    $effect(() => {
      const self = session.self;
      const voiceSession = sessions.voiceSession;
      const connected = session.status === 'connected';
      const vSelf = voiceSession?.self;
      const muted = !!(vSelf ? vSelf.selfMute || vSelf.mute : self?.selfMute);
      const deafened = !!(vSelf ? vSelf.selfDeaf || vSelf.deaf : self?.selfDeaf);
      const look: TrayLook = !connected && !voiceSession ? 'offline'
        : deafened ? 'deafened' : muted ? 'muted' : voice.transmitting ? 'talking' : 'idle';
      const server = voiceSession?.server?.label ?? session.server?.label ?? '';
      const state = { offline: 'not connected', idle: 'connected', talking: 'talking', muted: 'muted', deafened: 'deafened' }[look];
      api.updateTray({
        icon: drawIcon(look),
        tooltip: server ? `mumh5: ${state} on ${server}` : 'mumh5: not connected',
        connected: !!(voiceSession?.status === 'connected' || connected),
        server,
        muted,
        deafened,
        mode: voice.settings.mode
      });
    });
  });

  api.onTrayAction(action => {
    // Tray actions apply where voice runs
    const target = sessions.voiceSession ?? sessions.active;
    const self = target.self;
    if (action === 'toggle-mute' && self) target.setSelfMute(!self.selfMute);
    else if (action === 'toggle-deafen' && self) target.setSelfDeaf(!self.selfDeaf);
    else if (action.startsWith('mode:')) voice.update({ mode: action.slice(5) as TransmitMode });
    else if (action === 'settings') { ui.settingsTab = 'voice'; ui.settingsOpen = true; }
    else if (action === 'disconnect' && target.server) sessions.close(target.server.id);
  });
}
