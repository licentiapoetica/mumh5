import { session } from './session.svelte.ts';
import { drag } from './drag.svelte.ts';
import { ui } from './ui.svelte.ts';

// Capture selection gestures before the row's profile or message handlers run.
export function selectUser(node: HTMLButtonElement, options: { id: number; onselect?: () => void }) {
  const order = () => [...(node.closest('[data-user-list]')?.querySelectorAll<HTMLElement>('[data-select-user]') ?? [])]
    .map(el => Number(el.dataset.selectUser));
  node.dataset.selectUser = String(options.id);
  const click = (e: MouseEvent) => {
    if ((e.target as Element).closest('[role="button"]')) return;
    options.onselect?.();
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
  const start = (e: DragEvent) => {
    options.onselect?.();
    ui.profile = null;
    if (!session.selectedUsers.includes(options.id)) session.selectUser(options.id, order(), { shiftKey: false, ctrlKey: false, metaKey: false });
    drag.item = { kind: 'user', ids: [...session.selectedUsers], serverId: session.server?.id };
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', session.selectedUsers.map(id => session.user(id)?.name).join(', '));
    }
  };
  const end = () => { drag.item = null; };
  node.addEventListener('click', click, true);
  node.addEventListener('dblclick', double, true);
  node.addEventListener('dragstart', start);
  node.addEventListener('dragend', end);
  return {
    update(next: typeof options) { options = next; node.dataset.selectUser = String(options.id); },
    destroy() {
      node.removeEventListener('click', click, true);
      node.removeEventListener('dblclick', double, true);
      node.removeEventListener('dragstart', start);
      node.removeEventListener('dragend', end);
    }
  };
}
