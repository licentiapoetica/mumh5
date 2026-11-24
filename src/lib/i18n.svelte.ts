import { pickLanguage, translate, translatePlural, type Catalog, type LanguageId, type Params } from '../core/i18n.ts';
import { store } from './settings.svelte.ts';
import { en, type Key } from '../locales/en.ts';
import { de } from '../locales/de.ts';

const catalogs: Record<LanguageId, Catalog> = { en, de };

// Keys are checked by svelte-check; 'a.b#one' is a plural form and is reached through tn('a.b', n)
type PluralKey = Key extends infer K ? (K extends `${infer B}#${string}` ? B : never) : never;
type PlainKey = Exclude<Key, `${string}#${string}`>;

/** The language in use: the chosen one, or the browser's when set to automatic. */
export function currentLanguage(): LanguageId {
  const chosen = store.settings.language;
  if (chosen !== 'auto') return chosen;
  return pickLanguage(typeof navigator === 'undefined' ? [] : (navigator.languages?.length ? navigator.languages : [navigator.language]));
}

/** Translate by key. Reads the setting, so views update when the language changes. */
export function t(key: PlainKey, params?: Params): string {
  return translate(catalogs[currentLanguage()], en, key, params);
}

/** t() for counts: tn('home.retrying', seconds). {n} is filled in. */
export function tn(key: PluralKey, n: number, params?: Params): string {
  const lang = currentLanguage();
  return translatePlural(catalogs[lang], en, lang, key, n, params);
}

/** Keeps the page's lang attribute in step; call once from an effect root. */
export function applyLanguage(): void {
  document.documentElement.lang = currentLanguage();
}
