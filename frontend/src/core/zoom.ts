// Page zoom steps as browsers use them, from 50 % to 300 %.
export const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];

/** The next step in or out from any factor (a factor between steps goes to the nearest one that way). */
export function nextZoom(factor: number, direction: 1 | -1): number {
  if (direction > 0) return ZOOM_STEPS.find(s => s > factor + 0.001) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1];
  return [...ZOOM_STEPS].reverse().find(s => s < factor - 0.001) ?? ZOOM_STEPS[0];
}

interface KeyLike { key: string; code: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean }
/** What a key press asks of the zoom: in, out, back to 100 %, or nothing. Ctrl (Cmd on macOS) with +, - or 0. */
export function zoomKey(e: KeyLike): 'in' | 'out' | 'reset' | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
  if (e.code === 'Equal' || e.code === 'NumpadAdd' || e.key === '+') return 'in';
  if (e.code === 'Minus' || e.code === 'NumpadSubtract' || e.key === '-') return 'out';
  if (e.code === 'Digit0' || e.code === 'Numpad0') return 'reset';
  return null;
}
