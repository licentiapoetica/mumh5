<script lang="ts">
  import { session } from '../lib/session.svelte.ts';
  let { id }: { id: number } = $props();
</script>

{#if session.selectingUsers}
  <span class="user-check" class:checked={session.selectedUsers.includes(id)} aria-hidden="true"></span>
{/if}

<style>
  .user-check { flex: none; display: inline-block; width: 16px; height: 16px; border: 1px solid var(--line-strong); background: var(--bg-1); }
  .user-check.checked { background: var(--accent); border-color: var(--accent); }
  .user-check.checked::after { content: ''; display: block; width: 5px; height: 9px; margin: 1px 4px; border: solid var(--bg-1); border-width: 0 2px 2px 0; transform: rotate(45deg); }
</style>
