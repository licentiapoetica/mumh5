<script lang="ts">
  import BackgroundEditor from './BackgroundEditor.svelte';
  import { store } from '../lib/settings.svelte.ts';

  const treeModes: { id: 'none' | 'same' | 'own'; name: string }[] = [
    { id: 'none', name: 'None' }, { id: 'same', name: 'Same as chat' }, { id: 'own', name: 'Own design' }
  ];
</script>

<h3>Background</h3>
<p class="help">For chat and the start screen. Images stay on this device.</p>
<BackgroundEditor area="main" />

<h3>Channel list background</h3>
<p class="help">Also the room list in Rooms.</p>
<div class="designs" role="group" aria-label="Channel list background">
  {#each treeModes as mode (mode.id)}
    <button class="btn" class:primary={store.settings.treeBackground === mode.id} aria-pressed={store.settings.treeBackground === mode.id}
      onclick={() => { store.settings.treeBackground = mode.id; store.saveSettings(); }}>{mode.name}</button>
  {/each}
</div>
{#if store.settings.treeBackground === 'own'}
  <BackgroundEditor area="tree" name="Channel list" />
{/if}

<style>
  h3 { margin: 22px 0 0; font-size: 15px; font-weight: 650; }
  .help { margin: 6px 0 0; font-size: 13px; color: var(--text-dim); }
  .designs { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; align-items: center; }
</style>
