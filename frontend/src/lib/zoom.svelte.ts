import { nextZoom, zoomKey } from '../core/zoom.ts';
import { store } from './settings.svelte.ts';
import { desktop } from './native.ts';

// Page zoom in the desktop app, as a browser has it: Ctrl and +, - or 0, and Ctrl with the mouse
// wheel, in every window of the app. Browsers zoom on their own, so the web build leaves it to them.

class Zoom {
  readonly available = !!desktop?.setZoom;
  get factor(): number { return store.settings.zoom ?? 1; }

  set(factor: number): void {
    if (!desktop?.setZoom) return;
    const f = Math.round(Math.min(3, Math.max(0.5, factor)) * 100) / 100;
    store.settings.zoom = f;
    store.saveSettings();
    void desktop.setZoom(f).catch(() => {});
  }
  step(direction: 1 | -1): void { this.set(nextZoom(this.factor, direction)); }

  private wheelRest = 0;
  /** Listens in a window of the app (the main one, and Settings in a window of its own). */
  attach(view: Window): void {
    if (!this.available) return;
    view.addEventListener('keydown', e => {
      const ask = zoomKey(e);
      if (!ask) return;
      e.preventDefault();
      if (ask === 'reset') this.set(1); else this.step(ask === 'in' ? 1 : -1);
    }, true);
    view.addEventListener('wheel', e => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      // Touchpads send many small steps; one zoom step per notch of a mouse wheel
      this.wheelRest += e.deltaY;
      if (Math.abs(this.wheelRest) < 50) return;
      this.step(this.wheelRest < 0 ? 1 : -1);
      this.wheelRest = 0;
    }, { passive: false });
  }

  start(): void {
    this.attach(window);
    if (this.available && this.factor !== 1) void desktop!.setZoom!(this.factor).catch(() => {});
  }
}

export const zoom = new Zoom();
