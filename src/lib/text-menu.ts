import { desktop } from './native.ts';
import { menu, type MenuItem } from './menu.svelte.ts';

// Right-click menu for text fields, messages, links and images. Elements with their own menu
// (users, channels, servers) call preventDefault, so Electron does not report those.
/** The items for the message an element is in: its text, and a reaction. Also used by menus of
 *  their own inside messages (the media player), which would otherwise hide these. */
export function messageItems(el: Element | null): MenuItem[] {
  const msg = el?.closest('.msg, .system');
  const text = msg?.querySelector('.html')?.textContent?.trim();
  return [
    ...(text ? [{ label: 'Copy message text', action: () => navigator.clipboard.writeText(text) }] : []),
    // Message.svelte opens the emoji picker at the message
    ...(msg?.matches('[data-reactable]') ? [{ label: 'Add reaction', action: () => msg.dispatchEvent(new Event('mumh5:react')) }] : [])
  ];
}

export function startTextMenu(): void {
  if (!desktop) return;
  const api = desktop;
  // Electron's x and y ignore the page zoom, so the menu goes where the page saw the click.
  // Capture, since this event always comes before Electron's report
  let at = { x: 0, y: 0 };
  addEventListener('contextmenu', e => { at = { x: e.clientX, y: e.clientY }; }, true);

  api.onContextMenu(p => {
    // Edit commands act on the focused element; keep it focused through the menu
    const field = p.isEditable ? (document.activeElement as HTMLElement | null) : null;
    const edit = (action: string, arg?: unknown) => { field?.focus(); api.editAction(action, arg); };
    const items: MenuItem[] = [];
    const add = (group: MenuItem[]) => {
      if (!group.length) return;
      if (items.length) items.push({ separator: true, label: '' });
      items.push(...group);
    };

    if (p.misspelledWord) {
      add([
        ...p.suggestions.map(s => ({ label: s, action: () => edit('replaceMisspelling', s) })),
        ...(p.suggestions.length ? [] : [{ label: 'No suggestions', disabled: true }]),
        { label: 'Add to dictionary', action: () => api.editAction('addWord', p.misspelledWord) }
      ]);
    }

    if (p.isEditable) {
      const f = p.editFlags;
      add([
        { label: 'Undo', disabled: !f.canUndo, action: () => edit('undo') },
        { label: 'Redo', disabled: !f.canRedo, action: () => edit('redo') }
      ]);
      add([
        { label: 'Cut', disabled: !f.canCut, action: () => edit('cut') },
        { label: 'Copy', disabled: !f.canCopy, action: () => edit('copy') },
        { label: 'Paste', disabled: !f.canPaste, action: () => edit('paste') }
      ]);
      add([{ label: 'Select all', disabled: !f.canSelectAll, action: () => edit('selectAll') }]);
    } else {
      if (p.selectionText.trim()) add([{ label: 'Copy', action: () => api.editAction('copy') }]);
      if (p.linkURL && /^https?:/i.test(p.linkURL)) {
        add([
          { label: 'Open link', action: () => window.open(p.linkURL, '_blank', 'noopener') },
          { label: 'Copy link address', action: () => navigator.clipboard.writeText(p.linkURL) }
        ]);
      }
      if (p.mediaType === 'image' && p.srcURL) {
        add([
          { label: 'Copy image', action: () => api.editAction('copyImageAt', { x: p.x, y: p.y }) },
          { label: 'Save image...', action: () => api.editAction('saveImage', p.srcURL) }
        ]);
      }
      add(messageItems(document.elementFromPoint(at.x, at.y)));
    }

    if (items.length) menu.showAt(at.x, at.y, items, true);
  });
}
