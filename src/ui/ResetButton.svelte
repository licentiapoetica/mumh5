<script lang="ts">
  import { ui } from '../lib/ui.svelte.ts';

  // what: the name in the button and the question; small: a link beside a heading
  // note: what else happens, said before confirming
  let { what, changed, onreset, note = '', small = false }:
    { what: string; changed: boolean; onreset: () => void; note?: string; small?: boolean } = $props();

  function ask() {
    ui.prompt = {
      title: `Reset ${what}?`, label: '', confirm: 'Reset', input: 'none',
      text: note || 'Back to the defaults. Files and identities are kept.',
      onsubmit: () => onreset()
    };
  }
</script>

<button class={small ? 'link' : 'btn'} disabled={!changed} aria-label={small ? `Reset ${what}` : undefined}
  title={changed ? '' : 'Already at the defaults'} onclick={ask}>{small ? 'Reset' : `Reset ${what}`}</button>

<style>
  .link { flex: none; color: var(--link); font-size: 13px; }
  .link:disabled { color: var(--text-faint); }
</style>
