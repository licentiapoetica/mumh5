<script lang="ts">
  import Icon from './Icon.svelte';
  import { desktop } from '../lib/native.ts';
  import { canPickColor } from '../lib/color-pick.ts';
  import { ui } from '../lib/ui.svelte.ts';

  // A pipette beside a color field, shown only where the field's own one picks from the wrong place (Wayland)
  let { onpick, label = 'Pick a color from the screen', cls = 'icon-btn', size = 18, disabled = false }:
    { onpick: (hex: string) => void; label?: string; cls?: string; size?: number; disabled?: boolean } = $props();

  let shown = $state(false);
  let busy = $state(false);
  canPickColor().then(v => (shown = v));

  async function pick() {
    if (busy || !desktop) return;
    busy = true;
    // The desktop's picker takes the focus; a text selection must still be there for the color
    const sel = window.getSelection();
    const range = sel?.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
    try {
      const color = await desktop.pickColor();
      if (!color) return;
      if (range) { sel!.removeAllRanges(); sel!.addRange(range); }
      onpick(color);
    } catch {
      ui.prompt = {
        title: 'Could not pick a color', label: '', confirm: 'OK', input: 'none',
        text: 'The desktop did not open its color picker. The color field still works by choosing or typing a color.',
        onsubmit: () => {}
      };
    } finally {
      busy = false;
    }
  }
</script>

{#if shown}
  <button type="button" class={cls} title={label} aria-label={label} disabled={disabled || busy}
    onmousedown={e => e.preventDefault()} onclick={pick}><Icon name="pipette" {size} /></button>
{/if}
