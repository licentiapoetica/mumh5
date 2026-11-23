import { loadList, save } from './storage.ts';
import { store } from './settings.svelte.ts';
import { ui, type PromptRequest } from './ui.svelte.ts';
import {
  CHAT_SIZE, COLOR_KEYS, THEME_FILE_MAX, defaultIndicator, deriveColors, fixColors, isCustomTheme, normalizeHex, parseThemeFile,
  sanitizeTheme, themeFile, themeFileName, uniqueThemeName, type ColorKey, type CustomTheme, type CustomThemeId, type OrbLook,
  type ThemeColors, type ThemeIndicator
} from './custom-themes.ts';

const KEY = 'mumh5.customThemes';
export type MainColor = 'bg-2' | 'text' | 'accent';

// getRandomValues also works on a web build served over plain http, randomUUID does not
function newId(): CustomThemeId {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return `custom:${[...bytes].map(b => b.toString(16).padStart(2, '0')).join('')}`;
}

function stored(): CustomTheme[] {
  return loadList<{ id?: unknown }>(KEY).flatMap(raw => {
    const theme = isCustomTheme(raw?.id) ? sanitizeTheme(raw, raw.id) : null;
    return theme ? [theme] : [];
  });
}

// A built-in scheme's colors, read from the stylesheet so there is one source for them
function builtInColors(id: string): ThemeColors {
  const probe = document.createElement('div');
  probe.hidden = true;
  probe.dataset.themePreview = id || 'dark';
  document.body.append(probe);
  const css = getComputedStyle(probe);
  const read = (k: ColorKey) => normalizeHex(css.getPropertyValue(`--${k}`));
  const filled = deriveColors(read('bg-2') ?? '#1a1b1f', read('text') ?? '#e6e7ea', read('accent') ?? '#7c6cff');
  const colors = Object.fromEntries(COLOR_KEYS.map(k => [k, read(k) ?? filled[k]])) as ThemeColors;
  probe.remove();
  return colors;
}

class ThemeStudio {
  list = $state<CustomTheme[]>(stored());
  // The theme in the creator; it shows on the whole app while the creator is open
  draft = $state<CustomTheme | null>(null);
  // window: its own. inline: over the app (phones, or a blocked pop-up). closed with a draft:
  // its window was closed with unsaved changes, which wait in Appearance
  place = $state<'closed' | 'window' | 'inline'>('closed');
  // Asked inside the creator, whichever window Settings is in
  question = $state<PromptRequest | null>(null);
  onfinish: (() => void) | null = null;
  private history = $state<{ colors: ThemeColors; indicator: ThemeIndicator }[]>([]);
  private lastEdit: string | null = null;
  private opened = '';

  get active(): CustomTheme | null {
    const id = store.settings.theme;
    return isCustomTheme(id) ? this.list.find(t => t.id === id) ?? null : null;
  }
  get shown(): CustomTheme | null { return this.place !== 'closed' && this.draft ? this.draft : this.active; }
  get waiting(): boolean { return !!this.draft && this.place === 'closed'; }
  get canUndo(): boolean { return this.history.length > 0; }
  get dirty(): boolean { return !!this.draft && JSON.stringify($state.snapshot(this.draft)) !== this.opened; }

  private colorsOf(id: string): ThemeColors {
    const own = this.list.find(t => t.id === id);
    return own ? { ...$state.snapshot(own.colors) } : builtInColors(id);
  }

  private names(except?: string) { return this.list.filter(t => t.id !== except).map(t => t.name); }

  private persist() { save(KEY, $state.snapshot(this.list)); }

  private open(theme: CustomTheme) {
    this.draft = theme;
    this.opened = JSON.stringify(theme);
    this.history = [];
    this.lastEdit = null;
    this.stepAside();
  }

  private backToSettings() {
    ui.settingsTab = 'appearance';
    ui.settingsOpen = true;
  }

  private close() {
    this.draft = null;
    this.history = [];
    this.question = null;
    this.place = 'closed';
    this.onfinish?.();
    this.backToSettings();
  }

  /** Its window was closed by the window manager: nothing is lost, and nothing is applied. */
  windowClosed() {
    this.question = null;
    if (!this.dirty) this.draft = null;
    this.place = 'closed';
    this.backToSettings();
  }

  /** Drops the unsaved changes left by a closed window. */
  dropWaiting() {
    this.draft = null;
    this.history = [];
  }

  /** A new theme, starting from what is on screen. */
  create() {
    const active = this.active && $state.snapshot(this.active);
    const colors = this.colorsOf(store.settings.theme);
    this.open({
      id: newId(),
      name: uniqueThemeName('My theme', this.names()),
      colors,
      font: active?.font ?? 'inter',
      chatSize: active?.chatSize ?? CHAT_SIZE.normal,
      indicator: active?.indicator ?? defaultIndicator(colors.accent)
    });
  }

  edit(id: string) {
    const theme = this.list.find(t => t.id === id);
    if (theme) this.open(structuredClone($state.snapshot(theme)));
  }

  // The real app is the preview, so a Settings dialog over it makes way
  stepAside() {
    ui.settingsOpen = false;
    ui.settingsTab = 'voice';
  }

  // Dragging in a color picker is one step to undo, not hundreds
  private remember(edit: string | null) {
    if (!this.draft || (edit && edit === this.lastEdit)) return;
    this.lastEdit = edit;
    this.history = [...this.history.slice(-49), { colors: $state.snapshot(this.draft.colors), indicator: $state.snapshot(this.draft.indicator) }];
  }

  /** One setting of the speaking indicator, for one state. */
  setOrb<K extends keyof OrbLook>(state: keyof ThemeIndicator, key: K, value: OrbLook[K]) {
    if (!this.draft || this.draft.indicator[state][key] === value) return;
    this.remember(`orb:${state}:${key}`);
    this.draft.indicator[state][key] = value;
  }

  setColor(key: ColorKey, value: string) {
    if (!this.draft || this.draft.colors[key] === value) return;
    this.remember(key);
    this.draft.colors[key] = value;
  }

  /** One of the three main colors; the shades follow it. */
  setMain(key: MainColor, value: string) {
    if (!this.draft) return;
    this.remember(`main:${key}`);
    const main: ThemeColors = { ...$state.snapshot(this.draft.colors), [key]: value };
    this.draft.colors = deriveColors(main['bg-2'], main.text, main.accent);
  }

  copyColors(id: string) {
    if (!this.draft) return;
    this.remember(null);
    this.draft.colors = this.colorsOf(id);
  }

  fix() {
    if (!this.draft) return;
    this.remember(null);
    this.draft.colors = fixColors($state.snapshot(this.draft.colors));
  }

  undo() {
    const last = this.history.at(-1);
    if (!this.draft || !last) return;
    const { colors, indicator } = $state.snapshot(last);
    this.draft.colors = colors;
    this.draft.indicator = indicator;
    this.history = this.history.slice(0, -1);
    this.lastEdit = null;
  }

  save() {
    if (!this.draft || !this.draft.name.trim()) return;
    const theme = sanitizeTheme($state.snapshot(this.draft), this.draft.id);
    if (!theme) return;
    theme.name = uniqueThemeName(theme.name, this.names(theme.id));
    const i = this.list.findIndex(t => t.id === theme.id);
    if (i === -1) this.list = [...this.list, theme];
    else this.list[i] = theme;
    this.persist();
    store.settings.theme = theme.id;
    store.saveSettings();
    this.close();
  }

  discard() {
    if (!this.dirty) { this.close(); return; }
    this.question = {
      title: 'Discard changes?', label: '', confirm: 'Discard', danger: true, input: 'none',
      text: 'Your changes to this theme are not saved.',
      onsubmit: () => this.close()
    };
  }

  remove(id: string) {
    this.list = this.list.filter(t => t.id !== id);
    this.persist();
    if (store.settings.theme === id) {
      store.settings.theme = 'dark';
      store.saveSettings();
    }
  }

  /** Adds a shared theme and shows it; false when the file is not a theme. */
  async importFile(file: File): Promise<boolean> {
    if (file.size > THEME_FILE_MAX) return false;
    const theme = parseThemeFile(await file.text(), newId());
    if (!theme) return false;
    theme.name = uniqueThemeName(theme.name, this.names());
    this.list = [...this.list, theme];
    this.persist();
    store.settings.theme = theme.id;
    store.saveSettings();
    return true;
  }

  /** doc: the document of the button, which may be in the Settings window. */
  exportFile(id: string, doc: Document) {
    const theme = this.list.find(t => t.id === id);
    if (!theme) return;
    const url = URL.createObjectURL(new Blob([themeFile($state.snapshot(theme))], { type: 'application/json' }));
    const a = doc.createElement('a');
    a.href = url;
    a.download = themeFileName(theme.name);
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}

export const studio = new ThemeStudio();
