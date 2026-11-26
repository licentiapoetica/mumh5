// Import first. The app follows the system language when set to automatic, and the tests look for
// English text. Chromium on Linux reads LANGUAGE before --lang, so the flag alone does nothing.
process.env.LANGUAGE = 'en_US';
