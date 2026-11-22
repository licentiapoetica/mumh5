// The sphere of the tray icon, also drawn for people in the lists. Units of a 64 px square
export const INK = '#141518'; // the app icon's black

export const LAMP = {
  fx: 24, fy: 20, fr: 1, cx: 32, cy: 32, r: 30,
  radius: 29,
  rimRadius: 27.5, rimWidth: 3, rimOpacity: 0xd9 / 255
};

// Same soft gradient both ways, only lighter when on. Each stop is the color mixed with [other, amount]
export const lampStops = (lit: boolean): [string, number][] =>
  lit ? [['#ffffff', 0.3], ['#000000', 0.15]] : [[INK, 0.45], [INK, 0.85]];
