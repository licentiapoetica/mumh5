import { pickLanguage, translate, type Catalog, type LanguageId, type Params } from '../core/i18n.ts';
import { store } from './settings.svelte.ts';
import { de } from '../locales/de.ts';

const catalogs: Partial<Record<LanguageId, Catalog>> = { de };

/** The language in use: the chosen one, or the browser's when set to automatic. */
export function currentLanguage(): LanguageId {
  const chosen = store.settings.language;
  if (chosen !== 'auto') return chosen;
  return pickLanguage(typeof navigator === 'undefined' ? [] : (navigator.languages?.length ? navigator.languages : [navigator.language]));
}

/** Translate an English text. Reads the setting, so views update when the language changes. */
export function t(key: string, params?: Params): string {
  return translate(catalogs[currentLanguage()], key, params);
}

/** Keeps the page's lang attribute in step; call once from an effect root. */
export function applyLanguage(): void {
  document.documentElement.lang = currentLanguage();
}
