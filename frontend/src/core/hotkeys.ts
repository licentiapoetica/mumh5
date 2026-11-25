// Hotkeys: a key combination is written as modifiers and a KeyboardEvent.code, joined by "+",
// e.g. "Ctrl+Shift+KeyM". Codes name physical keys, so a combination survives keyboard layouts.

export type HotkeyAction = 'mute' | 'deafen';
export const MODIFIERS = ['Ctrl', 'Alt', 'Shift', 'Meta'] as const;

interface KeyLike { code: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }

const MODIFIER_CODES = /^(Control|Alt|Shift|Meta|OS)(Left|Right)?$/;

/** The combination an event stands for; null for a modifier pressed on its own. */
export function comboFromEvent(e: KeyLike): string | null {
  if (!e.code || MODIFIER_CODES.test(e.code)) return null;
  const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Meta'].filter(Boolean);
  return [...mods, e.code].join('+');
}

export function parseCombo(combo: string): { mods: string[]; code: string } | null {
  const parts = combo.split('+').filter(Boolean);
  const code = parts.pop();
  const isModifier = (p: string) => (MODIFIERS as readonly string[]).includes(p);
  if (!code || MODIFIER_CODES.test(code) || isModifier(code) || !parts.every(isModifier)) return null;
  return { mods: parts, code };
}

/** Whether a combination has a modifier, so it may fire while someone types in a text field. */
export const hasModifier = (combo: string) => (parseCombo(combo)?.mods.length ?? 0) > 0;

/** A readable name: "Ctrl + Shift + M", "Backtick (`)", "Num 5". */
export function keyName(code: string): string {
  const named: Record<string, string> = { Backquote: 'Backtick (`)', Space: 'Space', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', CapsLock: 'Caps Lock' };
  if (named[code]) return named[code];
  return code.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad/, 'Num ').replace(/^Arrow/, '').replace(/([a-z])([A-Z0-9])/g, '$1 $2');
}
export function comboLabel(combo: string): string {
  const p = parseCombo(combo);
  return p ? [...p.mods.map(m => (m === 'Meta' ? 'Super' : m)), keyName(p.code)].join(' + ') : '';
}

// XKB key names for the trigger the desktop portal is offered (xdg shortcuts format)
const KEYSYMS: Record<string, string> = {
  Backquote: 'grave', Space: 'space', Minus: 'minus', Equal: 'equal', BracketLeft: 'bracketleft', BracketRight: 'bracketright',
  Backslash: 'backslash', Semicolon: 'semicolon', Quote: 'apostrophe', Comma: 'comma', Period: 'period', Slash: 'slash',
  Enter: 'Return', Tab: 'Tab', Escape: 'Escape', Backspace: 'BackSpace', Insert: 'Insert', Delete: 'Delete', Home: 'Home', End: 'End',
  PageUp: 'Page_Up', PageDown: 'Page_Down', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Pause: 'Pause', ScrollLock: 'Scroll_Lock', CapsLock: 'Caps_Lock', NumpadAdd: 'KP_Add', NumpadSubtract: 'KP_Subtract',
  NumpadMultiply: 'KP_Multiply', NumpadDivide: 'KP_Divide', NumpadEnter: 'KP_Enter', NumpadDecimal: 'KP_Decimal'
};
/** The combination as the GlobalShortcuts portal's preferred trigger ("CTRL+SHIFT+m"); null if unknown. */
export function portalTrigger(combo: string): string | null {
  const p = parseCombo(combo);
  if (!p) return null;
  const c = p.code;
  const key = KEYSYMS[c] ?? (/^Key[A-Z]$/.test(c) ? c.slice(3).toLowerCase()
    : /^Digit\d$/.test(c) ? c.slice(5)
    : /^F([1-9]|1\d|2[0-4])$/.test(c) ? c
    : /^Numpad\d$/.test(c) ? `KP_${c.slice(6)}` : null);
  if (!key) return null;
  const mods = p.mods.map(m => ({ Ctrl: 'CTRL', Alt: 'ALT', Shift: 'SHIFT', Meta: 'LOGO' })[m]!);
  return [...mods, key].join('+');
}
