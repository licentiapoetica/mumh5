import { session } from './session.svelte.ts';
import { drag } from './drag.svelte.ts';
import { ui } from './ui.svelte.ts';

export const SELECT_HINT = /Mac/.test(navigator.userAgent) ? 'Cmd- or Shift-click to select' : 'Ctrl- or Shift-click to select';

// Lists of people that are on screen, by their data-user-list name, and the one used last.
// Only one of them shows the selection bar.
export const userLists = $state<{ mounted: string[]; last: string }>({ mounted: [], last: '' });

const listOf = (node: Element) => node.closest<HTMLElement>('[data-user-list]');

// Capture selection gestures before the row's profile or message handlers run.
export function selectUser(node: HTMLButtonElement, options: { id: number; onselect?: () => void }) {
  const order = () => [...(listOf(node)?.querySelectorAll<HTMLElement>('[data-select-user]') ?? [])]
    .map(el => Number(el.dataset.selectUser));
  const used = () => { userLists.last = listOf(node)?.dataset.userList ?? ''; };
  node.dataset.selectUser = String(options.id);
  const click = (e: MouseEvent) => {
    if ((e.target as Element).closest('[role="button"]')) return;
    options.onselect?.();
    used();
    session.selectUser(options.id, order(), e);
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      ui.profile = null;
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  };
  const double = (e: MouseEvent) => {
    if (e.shiftKey || e.ctrlKey || e.metaKey) e.stopImmediatePropagation();
  };
  const key = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && session.selectedUsers.length) session.clearUserSelection();
  };
  const start = (e: DragEvent) => {
    options.onselect?.();
    used();
    ui.profile = null;
    if (!session.selectedUsers.includes(options.id)) session.selectOnlyUser(options.id);
    drag.item = { kind: 'user', ids: [...session.selectedUsers], serverId: session.server?.id };
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', session.selectedUsers.map(id => session.user(id)?.name).join(', '));
    }
  };
  const end = () => { drag.item = null; };
  node.addEventListener('click', click, true);
  node.addEventListener('dblclick', double, true);
  node.addEventListener('keydown', key);
  node.addEventListener('dragstart', start);
  node.addEventListener('dragend', end);
  return {
    update(next: typeof options) { options = next; node.dataset.selectUser = String(options.id); },
    destroy() {
      node.removeEventListener('click', click, true);
      node.removeEventListener('dblclick', double, true);
      node.removeEventListener('keydown', key);
      node.removeEventListener('dragstart', start);
      node.removeEventListener('dragend', end);
    }
  };
}
