<script lang="ts">
  import { session } from '../lib/session.svelte.ts';
  import { userLists } from '../lib/user-selection.svelte.ts';
  let { list }: { list: string } = $props();
</script>

<button class="select-people" data-selection-start={list} disabled={session.movingUsers}
  aria-pressed={session.selectingUsers} onclick={() => {
    userLists.last = list;
    if (session.selectingUsers) session.clearUserSelection();
    else session.beginUserSelection();
  }}>{session.selectingUsers ? 'Cancel selection' : 'Select people'}</button>

<style>
  .select-people { min-height: var(--control-h); padding: 6px 8px; margin: 4px 0; color: var(--text-dim); border: 1px solid var(--line); }
  .select-people:hover { color: var(--text); background: var(--bg-hover); }
</style>
