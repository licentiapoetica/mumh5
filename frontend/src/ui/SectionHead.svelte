<script lang="ts">
  import ResetButton from './ResetButton.svelte';
  import { store, type SettingsPart } from '../lib/settings.svelte.ts';

  // A settings heading with a reset for the settings below it
  let { title, part, first = false, onreset }:
    { title: string; part: SettingsPart; first?: boolean; onreset?: () => void } = $props();
</script>

<div class="head" class:first>
  <h3>{title}</h3>
  <ResetButton small what={title.toLowerCase()} changed={!store.isDefault(part)}
    onreset={() => { store.resetSettings(part); onreset?.(); }} />
</div>

<style>
  .head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-top: 22px; }
  .head.first { margin-top: 8px; }
  h3 { margin: 0; font-size: 15px; font-weight: 650; }
</style>
