// The desktop's own color picker through the xdg desktop portal (KDE, GNOME and others on Wayland).
// Chromium's pipette cannot read the screen there, so it picks from the wrong place.
import { randomBytes } from 'node:crypto';
import { Bus, type Message, type Value } from './dbus.ts';

const PORTAL = { destination: 'org.freedesktop.portal.Desktop', path: '/org/freedesktop/portal/desktop' };

/** '#rrggbb' from the portal's color, three doubles from 0 to 1. */
export function portalHex(rgb: unknown): string | null {
  if (!Array.isArray(rgb) || rgb.length !== 3 || !rgb.every(c => typeof c === 'number' && Number.isFinite(c))) return null;
  return '#' + rgb.map(c => Math.round(Math.max(0, Math.min(1, c)) * 255).toString(16).padStart(2, '0')).join('');
}

/** The color from a Response signal: '#rrggbb', or null when the person cancelled. */
export function colorFromResponse(body: Value[]): string | null {
  const [code, results] = body as [number, [string, [string, Value]][]];
  if (code !== 0) return null;
  const color = results?.find(([k]) => k === 'color')?.[1];
  return color ? portalHex(color[1]) : null;
}

/** Opens the system color picker; '#rrggbb', or null when cancelled. Throws when there is no portal. */
export async function pickColor(timeoutMs = 5 * 60_000): Promise<string | null> {
  const bus = await Bus.session();
  try {
    const token = `mumh5_${randomBytes(6).toString('hex')}`;
    // The request object is named after the caller and the token, so the answer can be awaited before asking
    let handle = `${PORTAL.path}/request/${bus.name.slice(1).replace(/\./g, '_')}/${token}`;
    let stop = () => {};
    const answer = new Promise<Value[]>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('The color picker did not answer')), timeoutMs);
      const off = bus.onSignal((m: Message) => {
        if (m.interface !== 'org.freedesktop.portal.Request' || m.member !== 'Response' || m.path !== handle) return;
        clearTimeout(timer);
        resolve(m.body);
      });
      stop = () => { clearTimeout(timer); off(); };
    });
    await bus.call({
      destination: 'org.freedesktop.DBus', path: '/org/freedesktop/DBus', interface: 'org.freedesktop.DBus', member: 'AddMatch',
      signature: 's', body: ["type='signal',interface='org.freedesktop.portal.Request',member='Response'"]
    });
    try {
      // Portals older than handle_token name the request themselves
      [handle] = await bus.call({
        ...PORTAL, interface: 'org.freedesktop.portal.Screenshot', member: 'PickColor',
        signature: 'sa{sv}', body: ['', [['handle_token', ['s', token]]]]
      }) as [string];
      return colorFromResponse(await answer);
    } finally {
      stop();
    }
  } finally {
    bus.close();
  }
}
