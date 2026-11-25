import { desktop } from './native.ts';

// Asked once: only the desktop app on Wayland offers its own pipette (the desktop's color picker)
let available: Promise<boolean> | null = null;
export function canPickColor(): Promise<boolean> {
  return (available ??= desktop?.canPickColor ? desktop.canPickColor().catch(() => false) : Promise.resolve(false));
}
