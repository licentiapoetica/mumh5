export interface MenuItem {
  label: string;
  action?: () => void;
  danger?: boolean;
  checked?: boolean;
  disabled?: boolean;
  separator?: boolean;
  // Inline slider instead of a clickable item; the menu stays open while dragging
  slider?: { value: number; min: number; max: number; step: number; format: (v: number) => string; oninput: (v: number) => void };
}

// One context menu for the whole app, opened at the pointer position
class MenuStore {
  open = $state<{ x: number; y: number; items: MenuItem[] } | null>(null);

  show(e: MouseEvent, items: MenuItem[]): void {
    e.preventDefault();
    e.stopPropagation();
    this.open = { x: e.clientX, y: e.clientY, items };
  }

  close(): void {
    this.open = null;
  }
}

export const menu = new MenuStore();
