<script lang="ts">
  import { onMount } from 'svelte';
  import { session } from '../lib/session.svelte.ts';
  import { userLists } from '../lib/user-selection.svelte.ts';

  let { list, visibleIds }: { list: string; visibleIds?: number[] } = $props();
  let destination = $state('');
  let panel = $state<HTMLDivElement>();

  onMount(() => {
    userLists.mounted.push(list);
    return () => {
      const i = userLists.mounted.indexOf(list);
      if (i >= 0) userLists.mounted.splice(i, 1);
    };
  });

  const shown = $derived((session.selectedUsers.length > 0 || session.selectingUsers || session.userMove)
    && (userLists.mounted.includes(userLists.last) ? userLists.last === list : userLists.mounted[0] === list));
  const selected = $derived(session.selectedUsers.flatMap(id => { const u = session.user(id); return u ? [u] : []; }));
  const includesSelf = $derived(selected.some(u => u.session === session.self?.session));
  const hidden = $derived(visibleIds ? selected.filter(u => !visibleIds.includes(u.session)).length : 0);
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
  const target = $derived(channels.find(c => String(c.id) === destination));
  const movable = $derived(!!target && selected.some(u => u.channelId !== target.id));
  const result = $derived(session.userMove);
  const moved = $derived(result?.people.filter(p => p.status === 'moved').length ?? 0);
  const already = $derived(result?.people.filter(p => p.status === 'already').length ?? 0);
  const failed = $derived(result?.people.filter(p => p.status === 'failed') ?? []);

  function clear() {
    session.clearUserSelection();
    document.querySelector<HTMLButtonElement>(`[data-selection-start="${list}"]`)?.focus();
  }
  function move() {
    if (!movable || !target) return;
    session.moveUsers([...session.selectedUsers], target.id);
    panel?.focus();
  }
</script>

<svelte:window onkeydown={e => {
  if (e.key === 'Escape' && panel?.contains(e.target as Node) && !session.movingUsers) {
    e.stopPropagation();
    clear();
  }
}} />

{#if shown}
  <div class="selection" role="region" aria-label="Selected people" tabindex="-1" bind:this={panel}>
    <div class="summary">
      <span aria-live="polite">{selected.length} selected{includesSelf ? ', including you' : ''}</span>
      <button disabled={session.movingUsers} onclick={clear} title="Clear selection (Escape)">{result && !selected.length ? 'Done' : 'Clear'}</button>
    </div>
    {#if selected.length}
      <div class="move">
        <select aria-label="Move selected people to" bind:value={destination} disabled={session.movingUsers}>
          <option value="" disabled>Move to...</option>
          {#each channels as c (c.id)}
            {@const same = selected.every(u => u.channelId === c.id)}
            <option value={String(c.id)} disabled={same}>{c.name}{same ? ' (already here)' : ''}</option>
          {/each}
        </select>
        <button class="btn primary" disabled={!movable || session.movingUsers} onclick={move}>Move {selected.length} {selected.length === 1 ? 'person' : 'people'}</button>
      </div>
      {#if includesSelf}<p>You will join the destination too. Locked channels may ask you for a password.</p>{/if}
      {#if hidden}<p>{hidden} selected {hidden === 1 ? 'person is' : 'people are'} outside this view.</p>{/if}
    {:else if session.selectingUsers}
      <p>Tap people to select them.</p>
    {/if}
    {#if result}
      <p role="status">{#if session.movingUsers}Moving to {result.channelName}: {moved} of {result.people.length} confirmed.
        {:else}Moved {moved} of {result.people.length} to {result.channelName}.{#if already} {already} already there.{/if}{#if failed.length} {failed.length} not moved or unconfirmed.{/if}{/if}</p>
      {#if result.people.some(p => p.status === 'password')}<p>Waiting for your channel password.</p>{/if}
      {#if failed.length}
        <details open><summary>Move details</summary><ul class="review">
          {#each failed as person (person.id)}<li><span>{person.name}<small>{person.reason}</small></span></li>{/each}
        </ul></details>
      {/if}
    {/if}
  </div>
{/if}

<style>
  /* It sticks over the list, so it takes at most half of the scroll area (the % is of that),
     but never less than the count and the move row; the rest scrolls inside it */
  .selection { position: sticky; bottom: 0; z-index: 1; display: flex; flex-direction: column; gap: 8px; margin: 8px 0 0; padding: 8px; background: var(--bg-2); border: 1px solid var(--line); font-size: 12px;
    max-height: max(50%, calc(2 * var(--control-h) + 26px)); overflow-y: auto; }
  .selection > * { flex: none; } /* scroll instead of squashing the fields */
  .summary { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .move { display: flex; flex-wrap: wrap; gap: 6px; }
  .move select { flex: 1 1 100px; }
  .move .btn { flex: none; min-height: var(--control-h); padding: 4px 10px; }
  p { margin: 0; color: var(--text-dim); overflow-wrap: anywhere; }
  select { width: 100%; min-width: 0; height: var(--control-h); padding: 0 6px; font-size: 12px; }
  button:not(.btn) { min-height: var(--control-h); padding: 4px; color: var(--text-dim); }
  button:not(.btn):hover { color: var(--text); background: var(--bg-hover); }
  summary { cursor: pointer; }
  .review { list-style: none; padding: 0; margin: 6px 0 0; max-height: 160px; overflow-y: auto; }
  .review li { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 4px 0; border-top: 1px solid var(--line); }
  .review span { min-width: 0; overflow-wrap: anywhere; }
  small { display: block; color: var(--text-dim); }
</style>
