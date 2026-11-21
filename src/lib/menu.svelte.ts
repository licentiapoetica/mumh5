import type { RoleInfo } from '../core/roles.ts';

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
  // Opens a side menu. Its items are read live, so it can fill in while open
  submenu?: { onopen?: () => void; items: () => MenuItem[] };
  // For switches often used several in a row
  keepOpen?: boolean;
  title?: string;
  role?: Pick<RoleInfo, 'i' | 'c'>;
}

// One context menu for the whole app, opened at the pointer position
class MenuStore {
  // keepFocus: leave focus (and the text selection) where it is, for text editing menus
  open = $state<{ x: number; y: number; items: MenuItem[]; keepFocus?: boolean } | null>(null);
  // Where the last menu opened; items that open something next to it read this after the menu closed
  last = { x: 0, y: 0 };
  // The row the menu belongs to, marked by an attribute so no list has to track it
  private row: Element | null = null;

  show(e: MouseEvent, items: MenuItem[]): void {
    e.preventDefault();
    e.stopPropagation();
    this.showAt(e.clientX, e.clientY, items);
    this.mark(e.target instanceof Element ? e.target.closest('[data-menu-row]') : null);
  }

  showAt(x: number, y: number, items: MenuItem[], keepFocus = false): void {
    this.mark(null);
    this.last = { x, y };
    this.open = { x, y, items, keepFocus };
  }

  close(): void {
    this.mark(null);
    this.open = null;
  }

  private mark(row: Element | null): void {
    this.row?.removeAttribute('data-menu-on');
    this.row = row;
    row?.setAttribute('data-menu-on', '');
  }
}

export const menu = new MenuStore();
