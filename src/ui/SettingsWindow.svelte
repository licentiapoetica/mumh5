<script lang="ts">
  import PromptDialog from './PromptDialog.svelte';
  import SettingsDialog from './SettingsDialog.svelte';
  import { ui } from '../lib/ui.svelte.ts';

  type Tab = typeof ui.settingsTab;
  // asking: a question from Settings (a reset, an identity) belongs in this window
  let { tab, jump, onclose, asking }:
    { tab: Tab; jump: { tab: Tab } | null; onclose: () => void; asking: () => boolean } = $props();
</script>

<SettingsDialog {tab} {jump} {onclose} windowed />
{#if ui.prompt && asking()}
  <PromptDialog {...ui.prompt} onclose={() => { const p = ui.prompt; ui.prompt = null; p?.oncancel?.(); }} />
{/if}
