import { store } from './settings.svelte.ts';

// Hints are the browser tooltips from title attributes. With the setting off, the title of
// whatever is under the pointer is set aside while it is hovered and put back afterwards, so
// the attributes stay in place for screen readers and everything else that reads them.
export function startHints(): void {
  let held: { el: Element; title: string; labelled: boolean }[] = [];

  const restore = () => {
    for (const h of held) {
      // Leave it alone if the app set a new title in the meantime
      if (!h.el.hasAttribute('title')) h.el.setAttribute('title', h.title);
      if (h.labelled) h.el.removeAttribute('aria-label');
    }
    held = [];
  };

  document.addEventListener('mouseover', e => {
    restore();
    if (store.settings.hints) return;
    // A title on any ancestor would show too
    for (let el = e.target as Element | null; el; el = el.parentElement) {
      const title = el.getAttribute('title');
      if (!title) continue;
      // Keep the accessible name of icon buttons that are only named by their title
      const labelled = !el.hasAttribute('aria-label') && !el.textContent?.trim();
      if (labelled) el.setAttribute('aria-label', title);
      el.removeAttribute('title');
      held.push({ el, title, labelled });
    }
  }, true);
  document.addEventListener('mouseleave', restore);
}
