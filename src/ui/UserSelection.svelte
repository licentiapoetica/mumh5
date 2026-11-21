<script lang="ts">
  import { onMount } from 'svelte';
  import { session } from '../lib/session.svelte.ts';
  import { userLists } from '../lib/user-selection.svelte.ts';

  // Goes last inside the list it belongs to and sticks to its bottom, so rows never shift
  let { list }: { list: string } = $props();

  onMount(() => {
    userLists.mounted.push(list);
    return () => {
      const i = userLists.mounted.indexOf(list);
      if (i >= 0) userLists.mounted.splice(i, 1);
    };
  });

  // Shown in the list used last while it is on screen, else in the first one
  const shown = $derived(session.selectedUsers.length > 0
    && (userLists.mounted.includes(userLists.last) ? userLists.last === list : userLists.mounted[0] === list));

  const channels = $derived.by(() => {
    const out: { id: number; name: string }[] = [];
    const walk = (parent: number | null, path: string) => {
      for (const c of session.childrenOf(parent)) {
        const name = path ? `${path} / ${c.name}` : c.name || 'Root';
        if (!session.isText(c.id)) out.push({ id: c.id, name });
        walk(c.id, c.id === 0 ? '' : name);
      }
    };
    walk(null, '');
    return out;
  });

  function move(e: Event) {
    const input = e.currentTarget as HTMLSelectElement;
    if (!input.value) return;
    session.moveUsers([...session.selectedUsers], Number(input.value));
    input.value = '';
  }
</script>

{#if shown}
  <div class="selection" role="toolbar" aria-label="Selected clients" tabindex="-1"
    onkeydown={e => { if (e.key === 'Escape') session.clearUserSelection(); }}>
    <span aria-live="polite">{session.selectedUsers.length} selected</span>
    <select aria-label="Move selected clients to" onchange={move} value="" title="Move the selected people to a channel. Server permissions apply.">
      <option value="" disabled>Move to...</option>
      {#each channels as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
    </select>
    <button onclick={() => session.clearUserSelection()} title="Clear selection (Escape)">Clear</button>
  </div>
{/if}

<style>
  .selection { position: sticky; bottom: 0; z-index: 1; display: flex; align-items: center; gap: 6px; margin: 8px 0 0; padding: 6px 8px; background: var(--bg-2); border: 1px solid var(--line); font-size: 12px; }
  .selection span { white-space: nowrap; }
  select { flex: 1; min-width: 64px; width: 0; height: var(--control-h); padding: 0 6px; font-size: 12px; }
  button { padding: 4px; color: var(--text-dim); }
  button:hover { color: var(--text); background: var(--bg-hover); }
</style>
