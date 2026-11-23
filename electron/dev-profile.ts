import fs from 'node:fs';
import path from 'node:path';

// What a dev run needs to look like the user's app; Chromium's caches rebuild themselves
const COPIED = ['identities.json', 'saved-state.json', 'saved-state.json.bak', 'sounds', 'sounds.json', 'tray.json', 'Preferences', 'Local Storage', 'IndexedDB'];

// Lock files belong to the running copy, and file__ databases to the installed app's page
const wanted = (source: string) => {
  const name = path.basename(source);
  return name !== 'LOCK' && !name.startsWith('file__');
};

// Fills a new dev profile once. False means it could not be made (the source can change while it
// is copied), so this run stays on the shared profile and the next one tries again.
export function seedDevProfile(from: string, to: string): boolean {
  if (fs.existsSync(to) || !fs.existsSync(from)) return true;
  const partial = `${to}.partial`;
  try {
    fs.rmSync(partial, { recursive: true, force: true });
    fs.mkdirSync(partial, { recursive: true, mode: 0o700 });
    for (const name of COPIED) {
      const source = path.join(from, name);
      if (fs.existsSync(source)) fs.cpSync(source, path.join(partial, name), { recursive: true, filter: wanted });
    }
    fs.renameSync(partial, to);
    return true;
  } catch (e) {
    console.warn('Could not create the dev profile:', e);
    fs.rmSync(partial, { recursive: true, force: true });
    return false;
  }
}
