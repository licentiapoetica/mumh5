// Firefox does not open the list of a select made by one window's document and shown in another,
// and Settings and Roles are the app's elements in a window of their own. Neither moving the
// element nor showPicker helps, and Svelte keeps hold of it. So a copy made by that window's
// document is laid unseen over the select, opens instead, and hands the choice back.
export function fixSelects(doc: Document, signal?: AbortSignal): void {
  // Chromium opens them as they are
  if (!/Firefox/.test(navigator.userAgent)) return;

  const open = (e: Event, select: HTMLSelectElement) => {
    const copy = doc.importNode(select, true);
    // By position: an option's value can be more than its text (bind:value with numbers)
    copy.selectedIndex = select.selectedIndex;
    const box = select.getBoundingClientRect();
    const { font } = doc.defaultView!.getComputedStyle(select);
    copy.removeAttribute('id');
    copy.dataset.standIn = '';
    copy.style.cssText = `position:fixed;z-index:1000;opacity:0;margin:0;font:${font};`
      + `left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px`;

    let gone = false;
    const remove = () => {
      if (gone) return;
      gone = true;
      copy.remove();
    };
    copy.addEventListener('change', () => {
      select.selectedIndex = copy.selectedIndex;
      remove();
      select.focus();
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    copy.addEventListener('blur', remove);
    // Escape or Tab with the list shut leaves the copy focused
    copy.addEventListener('keydown', k => {
      if (k.key !== 'Escape' && k.key !== 'Tab') return;
      select.focus();
      remove();
    });

    e.preventDefault();
    // Where focus handlers expect it (the app list of the share dialog loads on focus)
    select.focus();
    doc.body.append(copy);
    copy.focus();
    try { copy.showPicker(); } catch { /* the next click lands on the copy and opens it */ }
  };

  const target = (e: Event): HTMLSelectElement | null => {
    const el = e.target as HTMLSelectElement;
    if (el.localName !== 'select' || el.disabled || el.multiple || el.size > 1) return null;
    return el.dataset.standIn === undefined ? el : null;
  };
  doc.addEventListener('mousedown', e => {
    const select = e.button === 0 ? target(e) : null;
    if (select) open(e, select);
  }, { capture: true, signal });
  doc.addEventListener('keydown', e => {
    const opens = e.key === ' ' || e.key === 'Enter' || e.key === 'F4' || (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp'));
    const select = opens ? target(e) : null;
    if (select) open(e, select);
  }, { capture: true, signal });
}
