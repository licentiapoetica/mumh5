import { desktop } from './native.ts';
import { ICON_PATHS } from './icons.ts';
import { session, sessions } from './session.svelte.ts';
import { voice, type TransmitMode } from './audio/voice.svelte.ts';
import { ui } from './ui.svelte.ts';
import { store } from './settings.svelte.ts';
import { INK, LAMP, lampStops } from './lamp.ts';

type TrayLook = 'offline' | 'idle' | 'talking' | 'muted' | 'deafened';

const GREY = '#7a7d87';
const AMBER = '#f0b232';
const DEFAULT_ACCENT = '#7c6cff';

// Muted and deafened keep the square tile with a white glyph, like the rail tiles
const TILES: Partial<Record<TrayLook, { bg: string; glyph: string }>> = {
  muted: { bg: '#e0443e', glyph: 'mic-off' },
  deafened: { bg: '#e0443e', glyph: 'headphones-off' }
};

const cache = new Map<string, string>();

const rgb = (h: string) => { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
const mix = (a: string, b: string, t: number) => {
  const x = rgb(a), y = rgb(b);
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('');
};

// The theme's accent, read from a probe so it does not depend on when the root's data-theme changes
let probe: HTMLElement | null = null;
function accentOf(theme: string): string {
  if (!probe) {
    probe = document.createElement('div');
    probe.hidden = true;
    document.body.append(probe);
  }
  probe.dataset.themePreview = theme || 'dark';
  const v = getComputedStyle(probe).getPropertyValue('--accent').trim();
  return /^#[0-9a-f]{6}$/i.test(v) ? v : DEFAULT_ACCENT;
}

// A sphere like a lamp: dark glass with a rim in the color when off, lighter when on
function drawLamp(ctx: CanvasRenderingContext2D, color: string, lit: boolean): void {
  const g = ctx.createRadialGradient(LAMP.fx, LAMP.fy, LAMP.fr, LAMP.cx, LAMP.cy, LAMP.r);
  lampStops(lit).forEach(([other, amount], i) => g.addColorStop(i, mix(color, other, amount)));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(LAMP.cx, LAMP.cy, LAMP.radius, 0, Math.PI * 2);
  ctx.fill();
  if (!lit) {
    ctx.lineWidth = LAMP.rimWidth;
    ctx.globalAlpha = LAMP.rimOpacity;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.arc(LAMP.cx, LAMP.cy, LAMP.rimRadius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

function drawTile(ctx: CanvasRenderingContext2D, bg: string, glyph: string): void {
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 64, 64);
  ctx.translate(8, 8);
  ctx.scale(2, 2); // 24 unit glyph into 48 px
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2.6;
  ctx.lineCap = 'square';
  ctx.lineJoin = 'miter';
  ctx.stroke(new Path2D(ICON_PATHS[glyph]));
}

// A poke waits: a small "!" square in the top corner, clear of the mute and deafen marks
function drawPokeBadge(ctx: CanvasRenderingContext2D): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = INK; // a dark edge keeps it apart from any look below
  ctx.fillRect(32, 0, 32, 32);
  ctx.fillStyle = AMBER;
  ctx.fillRect(35, 0, 29, 29);
  ctx.fillStyle = INK;
  ctx.fillRect(46, 4, 7, 13);
  ctx.fillRect(46, 20, 7, 5);
}

// 64 px so the OS can scale it down sharply. poke: with the badge; alternates with the plain
// icon while a poke waits for you
function drawIcon(look: TrayLook, accent: string, poke = false): string {
  const key = `${look}/${accent}/${poke}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const tile = TILES[look];
  if (tile) drawTile(ctx, tile.bg, tile.glyph);
  else if (look === 'offline') drawLamp(ctx, GREY, false);
  else drawLamp(ctx, accent, look === 'talking');
  if (poke) drawPokeBadge(ctx);
  const url = canvas.toDataURL('image/png');
  cache.set(key, url);
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
      const accent = accentOf(store.settings.theme);
      const state = { offline: 'not connected', idle: 'connected', talking: 'talking', muted: 'muted', deafened: 'deafened' }[look];
      api.updateTray({
        icon: drawIcon(look, accent),
        alertIcon: drawIcon(look, accent, true),
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
