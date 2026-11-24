// The order of the toolbar's buttons and spacers, and which buttons are hidden.
// Hidden buttons keep their place, so showing one again puts it back where it was.

export type ToolId = 'info' | 'mic' | 'deafen' | 'camera' | 'screen' | 'profile' | 'settings' | 'tree' | 'you';
export type ToolbarItem = ToolId | 'sep';
export interface ToolbarLayout { items: ToolbarItem[]; hidden: ToolId[] }

export const TOOLS: { id: ToolId; label: string; icon: string }[] = [
  { id: 'info', label: 'Server information', icon: 'info' },
  { id: 'mic', label: 'Mute', icon: 'mic' },
  { id: 'deafen', label: 'Deafen', icon: 'headphones' },
  { id: 'camera', label: 'Camera', icon: 'camera' },
  { id: 'screen', label: 'Share screen', icon: 'screen' },
  { id: 'profile', label: 'Edit profile', icon: 'message' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
  { id: 'tree', label: 'Expand or collapse all', icon: 'filter' },
  { id: 'you', label: 'Name and picture', icon: 'user' }
];

// The first spacer sets the server button apart
export const DEFAULT_TOOLBAR: ToolbarLayout = {
  items: ['sep', 'info', 'mic', 'deafen', 'camera', 'screen', 'sep', 'profile', 'sep', 'settings', 'sep', 'tree', 'you'],
  hidden: []
};

const isTool = (v: unknown): v is ToolId => TOOLS.some(t => t.id === v);

/** A usable layout from whatever was saved. Buttons added in a later version appear at the end. */
export function normalizeToolbar(raw: unknown): ToolbarLayout {
  const saved = (raw ?? {}) as Partial<ToolbarLayout>;
  const items: ToolbarItem[] = [];
  for (const v of Array.isArray(saved.items) ? saved.items : DEFAULT_TOOLBAR.items) {
    if (v === 'sep' || (isTool(v) && !items.includes(v))) items.push(v);
  }
  for (const t of TOOLS) if (!items.includes(t.id)) items.push(t.id);
  const hidden = TOOLS.map(t => t.id).filter(id => id !== 'settings' && Array.isArray(saved.hidden) && saved.hidden.includes(id));
  return { items, hidden };
}

export function moveToolbarItem(layout: ToolbarLayout, from: number, to: number): ToolbarLayout {
  const items = [...layout.items];
  if (from < 0 || from >= items.length) return { items, hidden: [...layout.hidden] };
  const [item] = items.splice(from, 1);
  items.splice(Math.max(0, Math.min(items.length, to)), 0, item);
  return { items, hidden: [...layout.hidden] };
}

export function setToolHidden(layout: ToolbarLayout, id: ToolId, hidden: boolean): ToolbarLayout {
  const rest = layout.hidden.filter(h => h !== id);
  if (id === 'settings') return { items: [...layout.items], hidden: rest };
  return { items: [...layout.items], hidden: hidden ? [...rest, id] : rest };
}

/** A spacer after the item at `after`, or at the end without one. */
export function addToolbarSpacer(layout: ToolbarLayout, after: number | null): ToolbarLayout {
  const items = [...layout.items];
  items.splice(after === null ? items.length : after + 1, 0, 'sep');
  return { items, hidden: [...layout.hidden] };
}

export function removeToolbarSpacer(layout: ToolbarLayout, index: number): ToolbarLayout {
  if (layout.items[index] !== 'sep') return { items: [...layout.items], hidden: [...layout.hidden] };
  return { items: layout.items.filter((_, i) => i !== index), hidden: [...layout.hidden] };
}

/**
 * What to draw, with each item's place in the layout. A spacer at the start needs something before it.
 * hasYou: whether this bar can show your name, so a spacer never leans on a name that is not drawn.
 */
export function visibleToolbarItems(layout: ToolbarLayout, hasLead: boolean, hasYou = true): { item: ToolbarItem; index: number }[] {
  const shown = layout.items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item === 'sep' || (!layout.hidden.includes(item) && (hasYou || item !== 'you')));
  if (hasLead) return shown;
  const first = shown.findIndex(s => s.item !== 'sep');
  return first < 0 ? [] : shown.slice(first);
}
