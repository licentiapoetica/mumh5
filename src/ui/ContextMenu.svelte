<script lang="ts">
  import { menu } from '../lib/menu.svelte.ts';

  let el: HTMLDivElement | undefined = $state();
  // Live values of slider items while the menu is open
  let sliderValues = $state<Record<number, number>>({});
  $effect(() => { void menu.open; sliderValues = {}; });
  let pos = $state({ x: 0, y: 0 });

  // Keep the menu on screen near the pointer
  $effect(() => {
    const m = menu.open;
    if (!m || !el) return;
    const r = el.getBoundingClientRect();
    pos = {
      x: Math.max(4, Math.min(m.x, window.innerWidth - r.width - 4)),
      y: Math.max(4, Math.min(m.y, window.innerHeight - r.height - 4))
    };
    el.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  });

  function onkeydown(e: KeyboardEvent) {
    if (!menu.open) return;
    if (e.key === 'Escape') menu.close();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      // Arrow keys adjust a focused slider instead of moving through the items
      if ((document.activeElement as HTMLInputElement | null)?.type === 'range') return;
      const buttons = [...el!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
      buttons[(i + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
    }
  }
</script>

<svelte:window {onkeydown} onblur={() => menu.close()} onresize={() => menu.close()} />

{#if menu.open}
  <div class="catcher" role="presentation" onmousedown={() => menu.close()} oncontextmenu={e => { e.preventDefault(); menu.close(); }}></div>
  <div class="menu" role="menu" bind:this={el} style:left="{pos.x}px" style:top="{pos.y}px">
    {#each menu.open.items as item, i (i)}
      {#if item.separator}
        <div class="sep" role="separator"></div>
      {:else if item.slider}
        {@const sl = item.slider}
        <div class="slider">
          <span class="slider-label"><span>{item.label}</span><span>{sl.format(sliderValues[i] ?? sl.value)}</span></span>
          <input type="range" min={sl.min} max={sl.max} step={sl.step} value={sl.value} aria-label={item.label}
            oninput={e => { const v = Number(e.currentTarget.value); sliderValues[i] = v; sl.oninput(v); }}
            ondblclick={() => { sliderValues[i] = 1; sl.oninput(1); }} />
        </div>
      {:else}
        <button role="menuitem" class:danger={item.danger} disabled={item.disabled}
          onclick={() => { menu.close(); item.action?.(); }}>
          <span class="label">{item.label}</span>
          {#if item.checked !== undefined}<span class="box" class:on={item.checked}></span>{/if}
        </button>
      {/if}
    {/each}
  </div>
{/if}

<style>
  .catcher { position: fixed; inset: 0; z-index: 200; }
  .menu {
    position: fixed; z-index: 201; min-width: 200px; max-width: 280px; padding: 6px;
    background: var(--bg-0); border: 1px solid var(--line); box-shadow: 0 8px 24px rgb(0 0 0 / 0.5);
  }
  button { display: flex; align-items: center; gap: 12px; width: 100%; padding: 7px 10px; font-size: 14px; text-align: left; color: var(--text); }
  button:hover:not(:disabled), button:focus-visible { background: var(--accent); color: var(--accent-text); outline: none; }
  button.danger { color: var(--danger); }
  button.danger:hover:not(:disabled), button.danger:focus-visible { background: var(--danger); color: #fff; }
  .label { flex: 1; }
  .box { width: 14px; height: 14px; border: 2px solid currentColor; }
  .box.on { background: currentColor; }
  .sep { height: 1px; margin: 4px 6px; background: var(--line); }
  .slider { padding: 6px 10px 8px; }
  .slider-label { display: flex; justify-content: space-between; font-size: 13px; color: var(--text-dim); }
  .slider input { width: 100%; padding: 0; border: 0; background: transparent; accent-color: var(--accent); margin-top: 4px; }
</style>
