<script lang="ts">
  import Icon from './Icon.svelte';
  import { sessions } from '../lib/session.svelte.ts';
  import { ui } from '../lib/ui.svelte.ts';
  import { t } from '../lib/i18n.svelte.ts';
  let { vertical = false }: { vertical?: boolean } = $props();
  const idle = $derived(sessions.active.status === 'idle');
  const home = $derived(idle || sessions.homeShown);
  const label = $derived(idle ? 'Home' : sessions.homeShown ? 'Back to server' : 'Go to home screen');
</script>

<div class="app-navigation" class:vertical role="group" aria-label="App navigation">
  <button class:active={home} title={label} aria-label={label} aria-pressed={home} disabled={idle}
    onclick={() => (sessions.homeShown = !sessions.homeShown)}><Icon name="home" size={18} /></button>
  <button title={t('nav.settings')} aria-label={t('nav.settings')} onclick={() => (ui.settingsOpen = true)}><Icon name="settings" size={18} /></button>
</div>

<style>
  .app-navigation { display: flex; flex: none; gap: 8px; align-items: center; }
  .vertical { flex-direction: column; }
  button { width: 36px; height: 36px; flex: none; display: flex; align-items: center; justify-content: center; color: var(--text-dim); background: transparent; }
  button:hover { color: var(--text); background: var(--bg-3); }
  button.active { background: var(--accent); color: var(--accent-text); }
  button:disabled { opacity: 0.6; cursor: default; }
</style>
