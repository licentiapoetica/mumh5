// Rounded corners are opt-in per group of elements. The rules are in src/corners.css.
export const CORNER_PARTS = [
  { id: 'icons', name: 'Icon buttons', note: 'Toolbar, chat and emoji buttons', max: 24, unit: 'px' },
  { id: 'buttons', name: 'Buttons', note: 'Text buttons and switches', max: 24, unit: 'px' },
  { id: 'fields', name: 'Fields', note: 'Text boxes, dropdowns, message box', max: 24, unit: 'px' },
  { id: 'rows', name: 'List rows', note: 'Channels, people, menu items', max: 24, unit: 'px' },
  { id: 'messages', name: 'Messages', note: 'Hover highlight and message tools', max: 24, unit: 'px' },
  { id: 'media', name: 'Chat media', note: 'Pictures, files, previews, code', max: 24, unit: 'px' },
  { id: 'badges', name: 'Reactions and badges', note: 'Reactions, unread and people counts', max: 24, unit: 'px' },
  { id: 'avatars', name: 'Profile pictures', note: 'Half is a full circle', max: 50, unit: '%' },
  { id: 'servers', name: 'Server icons', note: 'Server list and start screen', max: 24, unit: 'px' },
  { id: 'tiles', name: 'Voice tiles', note: 'People and video in a call', max: 24, unit: 'px' },
  { id: 'tabs', name: 'Chat tabs', note: 'Top corners of the tabs', max: 24, unit: 'px' },
  { id: 'popups', name: 'Menus and popups', note: 'Menus, profile cards, emoji picker', max: 24, unit: 'px' },
  { id: 'dialogs', name: 'Dialogs', note: 'Settings and other windows', max: 24, unit: 'px' },
  { id: 'scrollbars', name: 'Scrollbars', note: 'The scrollbar handle', max: 24, unit: 'px' }
] as const;

export type CornerPart = typeof CORNER_PARTS[number]['id'];
export type Corners = Partial<Record<CornerPart, number>>;

// One choice for every group; the value is in px, and scaled for groups with another range
export const CORNER_PRESETS = [
  { name: 'Square', px: 0 }, { name: 'Slight', px: 4 }, { name: 'Medium', px: 8 }, { name: 'Large', px: 14 }, { name: 'Round', px: 24 }
] as const;

/** A saved value made safe: settings can be edited by hand or come from an older version. */
export function cornerValue(saved: Corners | undefined, part: typeof CORNER_PARTS[number]): number {
  const v = Number(saved?.[part.id] ?? 0);
  return Number.isFinite(v) ? Math.min(part.max, Math.max(0, Math.round(v))) : 0;
}

/** Every group at one preset. Zero is left out, so an all-square choice equals the default. */
export function cornerPreset(px: number): Corners {
  if (px <= 0) return {};
  return Object.fromEntries(CORNER_PARTS.map(p => [p.id, Math.round(px / 24 * p.max)]));
}

/** One group changed; zero removes it. */
export function withCorner(saved: Corners | undefined, part: CornerPart, value: number): Corners {
  const next = { ...saved };
  if (value > 0) next[part] = value;
  else delete next[part];
  return next;
}

export function applyCorners(style: Pick<CSSStyleDeclaration, 'setProperty' | 'removeProperty'>, saved: Corners | undefined): void {
  for (const p of CORNER_PARTS) {
    const v = cornerValue(saved, p);
    if (v) style.setProperty(`--r-${p.id}`, `${v}${p.unit}`);
    else style.removeProperty(`--r-${p.id}`);
  }
}
