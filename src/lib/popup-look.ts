// The look of the app in an empty window of its own (Settings, the theme creator): its stylesheets
// and the attributes of its root element (color scheme, rounded corners). Both keep following the
// app, so a hot reload during development, or a stylesheet added later, reaches the window too.
export function followLook(doc: Document): () => void {
  const copies = new Map<Element, HTMLElement>();
  const sheets = () => [...document.querySelectorAll<HTMLLinkElement | HTMLStyleElement>('link[rel="stylesheet"], style')];

  const syncSheets = () => {
    const now = sheets();
    const kept = new Set<Element>(now);
    for (const [from, copy] of copies) if (!kept.has(from)) { copy.remove(); copies.delete(from); }
    let after: HTMLElement | null = null;
    for (const el of now) {
      let copy = copies.get(el);
      if (!copy) {
        copy = el.cloneNode(true) as HTMLElement;
        // The empty page has no address of its own to resolve a relative one against
        if (el instanceof HTMLLinkElement) copy.setAttribute('href', el.href);
        if (after) after.after(copy);
        else doc.head.append(copy);
        copies.set(el, copy);
      } else if (el instanceof HTMLStyleElement && copy.textContent !== el.textContent) {
        copy.textContent = el.textContent;
      } else if (el instanceof HTMLLinkElement && copy.getAttribute('href') !== el.href) {
        copy.setAttribute('href', el.href);
      }
      after = copy;
    }
  };

  const syncRoot = () => {
    for (const a of [...doc.documentElement.attributes]) doc.documentElement.removeAttribute(a.name);
    for (const a of document.documentElement.attributes) doc.documentElement.setAttribute(a.name, a.value);
  };

  syncSheets();
  syncRoot();
  const root = new MutationObserver(syncRoot);
  root.observe(document.documentElement, { attributes: true });
  const head = new MutationObserver(syncSheets);
  head.observe(document.head, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['href'] });
  return () => { root.disconnect(); head.disconnect(); };
}
