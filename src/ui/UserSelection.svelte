<script lang="ts">
  import { session } from '../lib/session.svelte.ts';

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

<svelte:window onkeydown={e => { if (e.key === 'Escape') session.clearUserSelection(); }} />

{#if session.selectedUsers.length}
  <div class="selection" role="group" aria-label="Selected clients">
    <span aria-live="polite">{session.selectedUsers.length} selected</span>
    <select aria-label="Move selected clients to" onchange={move} value="" title="Move selected clients to a channel. Server permissions apply.">
      <option value="" disabled>Move to...</option>
      {#each channels as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
    </select>
    <button onclick={() => session.clearUserSelection()} title="Clear selection (Escape)">Clear</button>
  </div>
{:else}
  <p class="hint">Shift-click a range. Ctrl/Cmd-click to select.</p>
{/if}

<style>
  .selection { flex: none; height: calc(var(--control-h) + 13px); display: flex; align-items: center; gap: 6px; padding: 6px 8px; background: var(--bg-2); border-bottom: 1px solid var(--line); font-size: 12px; }
  .selection span { white-space: nowrap; }
  select { flex: 1; min-width: 64px; width: 0; height: var(--control-h); padding: 0 6px; font-size: 12px; }
  button { padding: 4px; color: var(--text-dim); }
  button:hover { color: var(--text); background: var(--bg-hover); }
  .hint { flex: none; height: calc(var(--control-h) + 13px); display: flex; align-items: center; margin: 0; padding: 6px 8px; font-size: 11px; color: var(--text-faint); }
</style>
