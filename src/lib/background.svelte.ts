import { getBlob, putBlob, deleteBlob } from './blobstore.ts';
import { store, type BackgroundStyle } from './settings.svelte.ts';

export const BACKGROUND_TYPES = 'image/png,image/jpeg,image/webp,image/gif,image/avif';
const MAX_BYTES = 20 * 1024 * 1024;

// Keep the file out of localStorage, and only expose an object URL after storage succeeds.
export class BackgroundImage {
  url = $state<string | null>(null);
  name = $state('');
  busy = $state(true);
  error = $state('');
  readonly ready: Promise<void>;
  readonly key: string;

  constructor(key: string) {
    this.key = key;
    this.ready = getBlob(key).then(blob => {
      if (blob) this.apply(blob);
    }).catch(() => {
      this.error = 'Could not load the saved background image.';
    }).finally(() => { this.busy = false; });
  }

  async import(file: File): Promise<boolean> {
    if (this.busy) return false;
    this.error = '';
    if (!BACKGROUND_TYPES.split(',').includes(file.type)) {
      this.error = 'Choose a PNG, JPEG, WebP, GIF or AVIF image.';
      return false;
    }
    if (file.size > MAX_BYTES) {
      this.error = 'Choose an image smaller than 20 MB.';
      return false;
    }
    this.busy = true;
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      await putBlob(this.key, file);
      this.apply(file);
      return true;
    } catch {
      this.error = 'Could not read or save this image. Try another image or free some device storage.';
      return false;
    } finally {
      URL.revokeObjectURL(url);
      this.busy = false;
    }
  }

  async remove(): Promise<boolean> {
    if (this.busy) return false;
    this.error = '';
    this.busy = true;
    try {
      await deleteBlob(this.key);
      this.apply(null);
      return true;
    } catch {
      this.error = 'Could not remove the saved background image.';
      return false;
    } finally {
      this.busy = false;
    }
  }

  private apply(blob: Blob | null) {
    const previous = this.url;
    this.url = blob ? URL.createObjectURL(blob) : null;
    this.name = blob instanceof File ? blob.name : blob ? 'Saved image' : '';
    if (previous) URL.revokeObjectURL(previous);
  }
}

export type BackgroundArea = 'main' | 'tree';
export const backgroundImage = new BackgroundImage('appearance.background');
export const treeBackgroundImage = new BackgroundImage('appearance.background.tree');

const clamp = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
};

// The main style keeps the flat settings it had before the channel list got its own.
export function mainBackgroundStyle(): BackgroundStyle {
  const s = store.settings;
  return { design: s.backgroundDesign, fit: s.backgroundFit, strength: s.backgroundStrength, color: s.backgroundColor, mark: s.backgroundMark, spacing: s.backgroundSpacing };
}

export function setBackgroundStyle(area: BackgroundArea, patch: Partial<BackgroundStyle>) {
  const s = store.settings;
  if (area === 'tree') s.treeBackgroundStyle = { ...s.treeBackgroundStyle, ...patch };
  else {
    if (patch.design !== undefined) s.backgroundDesign = patch.design;
    if (patch.fit !== undefined) s.backgroundFit = patch.fit;
    if (patch.strength !== undefined) s.backgroundStrength = patch.strength;
    if (patch.color !== undefined) s.backgroundColor = patch.color;
    if (patch.mark !== undefined) s.backgroundMark = patch.mark;
    if (patch.spacing !== undefined) s.backgroundSpacing = patch.spacing;
  }
  store.saveSettings();
}

export interface AreaBackground { style: BackgroundStyle; image: BackgroundImage }

/** The style an area is edited with: the channel list's own one even while it is not shown. */
export function editedBackground(area: BackgroundArea): AreaBackground {
  return area === 'tree'
    ? { style: store.settings.treeBackgroundStyle, image: treeBackgroundImage }
    : { style: mainBackgroundStyle(), image: backgroundImage };
}

/** What an area shows, or null for nothing. */
export function areaBackground(area: BackgroundArea): AreaBackground | null {
  if (area === 'tree' && store.settings.treeBackground === 'none') return null;
  return editedBackground(area === 'tree' && store.settings.treeBackground === 'own' ? 'tree' : 'main');
}

// null means the design's own size, so a switch between grid and dots looks right
export const PATTERN_DEFAULTS = { grid: { mark: 1, spacing: 32 }, dots: { mark: 1.5, spacing: 20 } };
export const MARK_RANGE = [0.5, 8] as const, SPACING_RANGE = [8, 96] as const;

export function patternSize(style: BackgroundStyle) {
  const d = style.design === 'grid' ? PATTERN_DEFAULTS.grid : PATTERN_DEFAULTS.dots;
  return {
    mark: style.mark == null ? d.mark : clamp(style.mark, ...MARK_RANGE, d.mark),
    spacing: style.spacing == null ? d.spacing : clamp(style.spacing, ...SPACING_RANGE, d.spacing)
  };
}

/** CSS for a style; persisted values are validated before they are interpolated. */
// strip: a thin bar, where a gradient fades sideways instead of repeating the full composition
export function backgroundCss(style: BackgroundStyle, imageUrl: string | null, strip = false) {
  const design = style.design;
  const image = design === 'image' ? imageUrl : null;
  const color = /^#[\da-f]{6}$/i.test(style.color) ? style.color : '#5865f2';
  const pattern = design === 'grid' || design === 'dots';
  const { mark, spacing } = patternSize(style);
  const paint = image ? `url("${image}")` : design === 'gradient' && strip
    ? `linear-gradient(90deg, ${color}, var(--accent))`
    : design === 'gradient'
    ? `radial-gradient(ellipse at top left, ${color}, transparent 75%), radial-gradient(ellipse at bottom right, var(--accent), transparent 75%)`
    : design === 'grid' ? `linear-gradient(${color} ${mark}px, transparent ${mark}px), linear-gradient(90deg, ${color} ${mark}px, transparent ${mark}px)`
    : design === 'dots' ? `radial-gradient(${color} ${mark}px, transparent ${mark}px)` : null;
  if (!paint) return null;
  return {
    design,
    paint,
    opacity: clamp(style.strength, 0, 60, 20) / 100,
    size: image ? style.fit === 'tile' ? 'auto' : style.fit === 'contain' ? 'contain' : 'cover' : pattern ? `${spacing}px ${spacing}px` : 'cover',
    repeat: (image && style.fit === 'tile') || pattern ? 'repeat' : 'no-repeat'
  };
}
