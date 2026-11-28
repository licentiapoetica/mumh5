<script lang="ts">
  import Icon from './Icon.svelte';
  import RoleIcon from './RoleIcon.svelte';
  import { menu, type MenuItem } from '../lib/menu.svelte.ts';
  import { roleTint } from '../core/roles.ts';

  let el: HTMLDivElement | undefined = $state();
  let subEl: HTMLDivElement | undefined = $state();
  // Live values of slider items while the menu is open
  let sliderValues = $state<Record<number, number>>({});
  let sub = $state<{ index: number; rect: DOMRect } | null>(null);
  let subPos = $state({ x: 0, y: 0 });
  const subItems = $derived(sub ? menu.open?.items[sub.index]?.submenu?.items() ?? [] : []);
  let subTrigger: HTMLButtonElement | null = null;
  // Opened by keyboard: focus moves in as soon as there is something to focus
  let focusSub = false;
  let hoverTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => { void menu.open; sliderValues = {}; sub = null; clearTimeout(hoverTimer); });
  let pos = $state({ x: 0, y: 0 });

  // Full screen shows only the element's own content, so the menu moves into it while open
  let host: HTMLDivElement;
  $effect(() => {
    const full = document.fullscreenElement;
    if (!menu.open || !full) return;
    const home = host.parentNode!, next = host.nextSibling;
    full.appendChild(host);
    return () => { home.insertBefore(host, next); };
  });

  // Keep the menu on screen near the pointer
  $effect(() => {
    const m = menu.open;
    if (!m || !el) return;
    const r = el.getBoundingClientRect();
    pos = {
      x: Math.max(4, Math.min(m.x, window.innerWidth - r.width - 4)),
      y: Math.max(4, Math.min(m.y, window.innerHeight - r.height - 4))
    };
    if (!m.keepFocus) el.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  });

  // Beside its item, on the other side if there is no room, over the menu on a phone
  $effect(() => {
    void subItems.length;
    if (!sub || !subEl) return;
    const r = subEl.getBoundingClientRect();
    const right = sub.rect.right + 6;
    const left = sub.rect.left - r.width - 6;
    subPos = {
      x: right + r.width <= window.innerWidth - 4 ? right : left >= 4 ? left : Math.max(4, window.innerWidth - r.width - 4),
      y: Math.max(4, Math.min(sub.rect.top - 6, window.innerHeight - r.height - 4))
    };
    if (focusSub) {
      const first = subEl.querySelector<HTMLButtonElement>('button:not(:disabled)');
      if (first) { first.focus(); focusSub = false; }
    }
  });

  function openSub(item: MenuItem, index: number, button: HTMLButtonElement, focus: boolean) {
    clearTimeout(hoverTimer);
    focusSub = focus;
    if (sub?.index === index) {
      if (focus) subEl?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
      return;
    }
    subTrigger = button;
    sub = { index, rect: button.getBoundingClientRect() };
    item.submenu?.onopen?.();
  }

  function closeSub() {
    clearTimeout(hoverTimer);
    if (subEl?.contains(document.activeElement)) subTrigger?.focus();
    sub = null;
  }

  // The short wait lets the pointer cross other items on its way into the side menu
  function hover(item: MenuItem, index: number, button: HTMLButtonElement) {
    clearTimeout(hoverTimer);
    if (sub?.index === index) return;
    if (!item.submenu && !sub) return;
    hoverTimer = setTimeout(() => {
      if (item.submenu) openSub(item, index, button, false);
      else closeSub();
    }, 160);
  }

  function pick(item: MenuItem) {
    if (!item.keepOpen) menu.close();
    item.action?.();
  }

  function onkeydown(e: KeyboardEvent) {
    if (!menu.open) return;
    const active = document.activeElement as HTMLElement | null;
    const inSub = !!subEl?.contains(active);
    if (e.key === 'Escape') {
      if (sub) closeSub();
      else menu.close();
    }
    if (e.key === 'ArrowLeft' && inSub) { e.preventDefault(); closeSub(); }
    if (e.key === 'ArrowRight' && !inSub && active?.dataset.sub != null) {
      e.preventDefault();
      const index = Number(active.dataset.sub);
      openSub(menu.open.items[index], index, active as HTMLButtonElement, true);
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      // Arrow keys adjust a focused slider instead of moving through the items
      if ((active as HTMLInputElement | null)?.type === 'range') return;
      const buttons = [...(inSub ? subEl! : el!).querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      const i = buttons.indexOf(active as HTMLButtonElement);
      buttons[(i + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
    }
  }
</script>

<svelte:window {onkeydown} onblur={() => menu.close()} onresize={() => menu.close()} />

{#snippet content(item: MenuItem)}
  {#if item.role}<span class="ri" style:--tint={roleTint(item.role.c)}><RoleIcon role={item.role} size={15} /></span>{/if}
  <span class="label">{item.label}</span>
  {#if item.submenu}<span class="more"><Icon name="arrow-right" size={13} /></span>
  {:else if item.checked !== undefined}<span class="box" class:on={item.checked}></span>{/if}
{/snippet}

<div class="host" bind:this={host}>
{#if menu.open}
  <div class="catcher" role="presentation" onmousedown={() => menu.close()} oncontextmenu={e => { e.preventDefault(); menu.close(); }}></div>
  <div class="menu" role="menu" bind:this={el} style:left="{pos.x}px" style:top="{pos.y}px">
    {#each menu.open.items as item, i (i)}
      {#if item.header}
        <div class="head" role="presentation">{item.label}</div>
      {:else if item.separator}
        <div class="sep" role="separator"></div>
      {:else if item.slider}
        {@const sl = item.slider}
        <div class="slider">
          <span class="slider-label"><span>{item.label}</span><span>{sl.format(sliderValues[i] ?? sl.value)}</span></span>
          <input type="range" min={sl.min} max={sl.max} step={sl.step} value={sl.value} aria-label={item.label}
            oninput={e => { const v = Number(e.currentTarget.value); sliderValues[i] = v; sl.oninput(v); }}
            ondblclick={() => { sliderValues[i] = 1; sl.oninput(1); }} />
        </div>
      {:else if item.submenu}
        <button role="menuitem" class:open={sub?.index === i} aria-haspopup="menu" aria-expanded={sub?.index === i} data-sub={i}
          onmouseenter={e => hover(item, i, e.currentTarget)}
          onmousedown={e => e.preventDefault()} onclick={e => openSub(item, i, e.currentTarget, e.detail === 0)}>
          {@render content(item)}
        </button>
      {:else}
        <button role="menuitem" class:danger={item.danger} disabled={item.disabled} title={item.title}
          onmouseenter={e => hover(item, i, e.currentTarget)}
          onmousedown={e => e.preventDefault()} onclick={() => pick(item)}>
          {@render content(item)}
        </button>
      {/if}
    {/each}
  </div>
  {#if sub}
    <div class="menu side" role="menu" tabindex="-1" aria-label={menu.open.items[sub.index]?.label} bind:this={subEl}
      style:left="{subPos.x}px" style:top="{subPos.y}px" onmouseenter={() => clearTimeout(hoverTimer)}>
      {#each subItems as item, i (i)}
        {#if item.separator}
          <div class="sep" role="separator"></div>
        {:else if item.checked !== undefined}
          <button role="menuitemcheckbox" aria-checked={item.checked} disabled={item.disabled} title={item.title}
            onmousedown={e => e.preventDefault()} onclick={() => pick(item)}>
            {@render content(item)}
          </button>
        {:else}
          <button role="menuitem" disabled={item.disabled} title={item.title}
            onmousedown={e => e.preventDefault()} onclick={() => pick(item)}>
            {@render content(item)}
          </button>
        {/if}
      {/each}
    </div>
  {/if}
{/if}
</div>

<style>
  .host { display: contents; }
  .catcher { position: fixed; inset: 0; z-index: 200; }
  .menu {
    position: fixed; z-index: 201; min-width: 210px; max-width: 280px; max-height: calc(100vh - 8px); overflow-y: auto; padding: 5px;
    background: var(--bg-1); border: 1px solid var(--line-strong);
    animation: pop 110ms var(--ease);
  }
  .menu.side { z-index: 202; min-width: 180px; }
  button { display: flex; align-items: center; gap: 12px; width: 100%; padding: 6px 10px; line-height: 20px; text-align: left; color: var(--text); }
  button:hover:not(:disabled), button:focus-visible, button.open { background: var(--accent); color: var(--accent-text); outline: none; }
  button.danger { color: var(--danger); }
  button.danger:hover:not(:disabled), button.danger:focus-visible { background: var(--danger); color: #fff; }
  .label { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .ri { display: inline-flex; flex: none; margin-right: -4px; color: var(--tint, currentColor); }
  button:hover:not(:disabled) .ri, button:focus-visible .ri { color: inherit; }
  .more { display: inline-flex; flex: none; }
  .box { flex: none; width: 14px; height: 14px; border: 2px solid currentColor; }
  .box.on { background: currentColor; }
  .sep { height: 1px; margin: 5px 4px; background: var(--line); }
  .head { padding: 5px 10px 7px; margin-bottom: 5px; font-size: 12px; font-weight: 650; color: var(--text-dim); border-bottom: 1px solid var(--line);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .slider { padding: 6px 10px 8px; }
  .slider-label { display: flex; justify-content: space-between; font-size: 13px; color: var(--text-dim); }
  .slider input { width: 100%; padding: 0; border: 0; background: transparent; accent-color: var(--accent); margin-top: 4px; }
  @keyframes pop { from { opacity: 0; transform: translateY(-3px); } }
</style>
