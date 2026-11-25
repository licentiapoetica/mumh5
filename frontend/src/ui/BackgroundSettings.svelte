<script lang="ts">
  import BackgroundEditor from './BackgroundEditor.svelte';
  import SectionHead from './SectionHead.svelte';
  import { store } from '../lib/settings.svelte.ts';

  const treeModes: { id: 'none' | 'same' | 'own'; name: string }[] = [
    { id: 'none', name: 'None' }, { id: 'same', name: 'Same as chat' }, { id: 'own', name: 'Own design' }
  ];
</script>

<SectionHead title="Background" part="appearance.background" />
<p class="help">For chat and the start screen. Images stay on this device.</p>
<BackgroundEditor area="main" />

<SectionHead title="Channel list background" part="appearance.tree" />
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
  .help { margin: 6px 0 0; font-size: 13px; color: var(--text-dim); }
  .designs { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; align-items: center; }
</style>
