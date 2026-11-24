# Translating mumh5

Texts are looked up by key. `src/locales/en.ts` is the source of truth and the fallback for every language.

- In a component or `src/lib/` file: `import { t, tn } from '../lib/i18n.svelte.ts'` and write `t('composer.sendFile')`,
  `t('home.editServer', { name })`, `tn('home.retrying', seconds)`. Keys are checked by `npm run check`.
  Use the literal key, not a variable or a template, so the test can see it.
- Keys are `area.thing` in camelCase (`userBar.mute`, `settings.tab.voice`). Name the place the text is used, not
  the words, so a reworded text keeps its key. Two uses that need different words get two keys, even when the
  English is the same.
- Add the English text to `en.ts` first, then translations to the other catalogs. A text without a translation
  shows in English. Do not reuse a key for a different meaning; add a new one.
- Counts: write `'a.b'` (every count but the special ones) and `'a.b#one'` in the catalog, with `{n}` in the text.
  Other languages can add `#few`, `#many`, `#zero`, `#two` (Intl.PluralRules categories).
- `{placeholders}` must match English in plain entries. `npm test` checks this, rejects unknown or unused keys and
  prints each language's coverage.
- `src/core/` stays free of the settings store: return data or codes there and translate in the caller.
- Add a language: create `src/locales/<code>.ts` like `de.ts`, add it to `LANGUAGES` in `src/core/i18n.ts`, to
  `catalogs` in `src/lib/i18n.svelte.ts` and to `test/i18n-catalogs.test.ts`.
- Not converted yet: most dialogs, menus built in `src/lib/actions.ts`, error text from `session.svelte.ts`, the
  Electron main process (tray, native dialogs).
