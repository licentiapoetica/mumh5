import { session } from './session.svelte.ts';
import { drag } from './drag.svelte.ts';
import { ui } from './ui.svelte.ts';

export const SELECT_HINT = /Mac/.test(navigator.userAgent) ? 'Shift- or Cmd-click to select' : 'Shift- or Ctrl-click to select';

// Lists of people that are on screen, by their data-user-list name, and the one used last.
// Only one of them shows the selection bar.
export const userLists = $state<{ mounted: string[]; last: string }>({ mounted: [], last: '' });

const listOf = (node: Element) => node.closest<HTMLElement>('[data-user-list]');

// Capture selection gestures before the row's profile or message handlers run.
export function selectUser(node: HTMLButtonElement, options: { id: number; onselect?: () => void }) {
  const used = () => { userLists.last = listOf(node)?.dataset.userList ?? ''; };
  node.dataset.selectUser = String(options.id);
  const click = (e: MouseEvent) => {
    if ((e.target as Element).closest('[role="button"]')) return;
    options.onselect?.();
    used();
    if (session.selectingUsers || e.shiftKey || e.ctrlKey || e.metaKey) {
      session.toggleUser(options.id);
      ui.profile = null;
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  };
  const double = (e: MouseEvent) => {
    if (session.selectingUsers || e.shiftKey || e.ctrlKey || e.metaKey) e.stopImmediatePropagation();
  };
  const key = (e: KeyboardEvent) => {
    // An open profile takes this Escape for itself
    if (e.key === 'Escape' && !ui.profile && (session.selectedUsers.length || session.selectingUsers)) session.clearUserSelection();
  };
  const start = (e: DragEvent) => {
    options.onselect?.();
    used();
    ui.profile = null;
    // A person outside the selection moves alone and leaves the selection as it is
    const ids = session.selectedUsers.includes(options.id) ? [...session.selectedUsers] : [options.id];
    drag.item = { kind: 'user', ids, serverId: session.server?.id };
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', ids.map(id => session.user(id)?.name).join(', '));
    }
  };
  const end = () => { drag.item = null; };
  node.addEventListener('click', click, true);
  node.addEventListener('dblclick', double, true);
  node.addEventListener('keydown', key);
  node.addEventListener('dragstart', start);
  node.addEventListener('dragend', end);
  node.addEventListener('contextmenu', used, true);
  return {
    update(next: typeof options) { options = next; node.dataset.selectUser = String(options.id); },
    destroy() {
      node.removeEventListener('click', click, true);
      node.removeEventListener('dblclick', double, true);
      node.removeEventListener('keydown', key);
      node.removeEventListener('dragstart', start);
      node.removeEventListener('dragend', end);
      node.removeEventListener('contextmenu', used, true);
    }
  };
}
