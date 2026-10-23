export interface MenuItem {
  label: string;
  action?: () => void;
  danger?: boolean;
  checked?: boolean;
  disabled?: boolean;
  separator?: boolean;
  // Non-interactive title at the top (e.g. the server's name)
  header?: boolean;
  // Inline slider instead of a clickable item; the menu stays open while dragging
  slider?: { value: number; min: number; max: number; step: number; format: (v: number) => string; oninput: (v: number) => void };
}

// One context menu for the whole app, opened at the pointer position
class MenuStore {
  // keepFocus: leave focus (and the text selection) where it is, for text editing menus
  open = $state<{ x: number; y: number; items: MenuItem[]; keepFocus?: boolean } | null>(null);
  // Where the last menu opened; items that open something next to it read this after the menu closed
  last = { x: 0, y: 0 };

  show(e: MouseEvent, items: MenuItem[]): void {
    e.preventDefault();
    e.stopPropagation();
    this.showAt(e.clientX, e.clientY, items);
  }

  showAt(x: number, y: number, items: MenuItem[], keepFocus = false): void {
    this.last = { x, y };
    this.open = { x, y, items, keepFocus };
  }

  close(): void {
    this.open = null;
  }
}

export const menu = new MenuStore();
