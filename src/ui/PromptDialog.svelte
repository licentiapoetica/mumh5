<script lang="ts">
  import Modal from './Modal.svelte';

  let { title, label, confirm, danger = false, input = 'text', initial = '', text = '', onsubmit, onclose }:
    { title: string; label: string; confirm: string; danger?: boolean; input?: 'text' | 'password' | 'none'; initial?: string;
      text?: string; onsubmit: (value: string) => void; onclose: () => void } = $props();

  // svelte-ignore state_referenced_locally
  let value = $state(initial);
</script>

<Modal {title} {onclose}>
  <form id="prompt" onsubmit={e => { e.preventDefault(); onsubmit(value); onclose(); }}>
    {#if text}<p>{text}</p>{/if}
    {#if input !== 'none'}
      <label for="p-val">{label}</label>
      <!-- svelte-ignore a11y_autofocus -->
      <input id="p-val" type={input} bind:value autofocus autocomplete="off" />
    {/if}
  </form>
  {#snippet footer()}
    <button class="btn" onclick={onclose}>Cancel</button>
    <button class="btn" class:primary={!danger} class:danger type="submit" form="prompt">{confirm}</button>
  {/snippet}
</Modal>

<style>
  p { color: var(--text-dim); }
</style>
