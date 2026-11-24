# Translating mumh5

The English text in the code is the key; there is no separate id.

- In a component or `src/lib/` file: `import { t, tn } from '../lib/i18n.svelte.ts'` and write `t('Send a file')`,
  `t('Edit {name}', { name })`, `tn('{n} files', '{n} file', count)` (other form first, then the form for 1).
  Use the literal string, not a variable or a template, so the test can see it.
- `src/core/` stays free of the settings store: return data or codes there and translate in the caller.
- Add a language: create `src/locales/<code>.ts` (copy `de.ts`), add it to `LANGUAGES` in `src/core/i18n.ts` and
  to `catalogs` in `src/lib/i18n.svelte.ts`. A text without an entry shows in English.
- Plural forms for a language: `'{n} files#one'`, `#few`, `#many` (Intl.PluralRules categories) beside the plain entry.
- Keep `{placeholders}` exactly as in English; `npm test` checks this and flags entries the code no longer uses.
- Not converted yet: most dialogs, menus built in `src/lib/actions.ts`, error text from `session.svelte.ts`, the
  Electron main process (tray, native dialogs).
