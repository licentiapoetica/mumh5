// Import first. The app follows the system language when set to automatic, and the tests look for
// English text. Chromium on Linux takes its language from LANGUAGE. Windows and macOS take it from
// the system instead, so there the tests still need an English system.
process.env.LANGUAGE = 'en_US';
