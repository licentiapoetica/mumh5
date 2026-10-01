<script lang="ts">
  import Modal from './Modal.svelte';
  import { share } from '../lib/share.svelte.ts';

  // Desktop app only: choose the screen or window to share
  const picker = $derived(share.picker);
</script>

{#if picker}
  <Modal title="Share your screen" onclose={() => picker.choose(null)} width={720}>
    <p class="help">Pick a screen or a window. mumh5 users in your channel can then watch it.</p>
    <ul class="sources">
      {#each picker.sources as s (s.id)}
        <li>
          <button onclick={() => picker.choose(s.id)}>
            {#if s.thumbnail}<img src={s.thumbnail} alt="" />{:else}<span class="blank"></span>{/if}
            <span class="name">{s.name}</span>
          </button>
        </li>
      {/each}
    </ul>
    {#snippet footer()}
      <button class="btn" onclick={() => picker.choose(null)}>Cancel</button>
    {/snippet}
  </Modal>
{/if}

<style>
  .help { margin: 8px 0 0; font-size: 13px; color: var(--text-dim); }
  .sources { list-style: none; margin: 12px 0 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 10px; }
  .sources button { width: 100%; display: flex; flex-direction: column; gap: 6px; padding: 8px; text-align: left; border: 1px solid var(--line); background: var(--bg-0); }
  .sources button:hover { border-color: var(--accent); }
  img, .blank { width: 100%; aspect-ratio: 16 / 9; object-fit: contain; background: #000; display: block; }
  .name { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
