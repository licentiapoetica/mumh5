<script lang="ts">
  import Icon from './Icon.svelte';
  import { store } from '../lib/settings.svelte.ts';
  import { ui } from '../lib/ui.svelte.ts';
  import {
    DEFAULT_TOOLBAR, TOOLS, addToolbarSpacer, moveToolbarItem, normalizeToolbar, removeToolbarSpacer,
    setToolHidden, type ToolbarItem, type ToolbarLayout, type ToolId
  } from '../core/toolbar.ts';

  const q = $derived(ui.toolbarEdit!);
  const layout = $derived(normalizeToolbar(store.settings.toolbar));
  const atDefault = $derived(JSON.stringify(layout) === JSON.stringify(DEFAULT_TOOLBAR));
  let el: HTMLDivElement | undefined = $state();
  let list: HTMLOListElement | undefined = $state();
  let pos = $state({ x: 0, y: 0 });
  // The row that was right-clicked or last moved; a new spacer goes after it
  let selected = $state<number | null>(ui.toolbarEdit!.index);
  let dragging = $state<number | null>(null);

  $effect(() => {
    void layout.items.length;
    if (!el) return;
    const r = el.getBoundingClientRect();
    pos = {
      x: Math.max(8, Math.min(q.x, window.innerWidth - r.width - 8)),
      y: Math.max(8, Math.min(q.y, window.innerHeight - r.height - 8))
    };
  });

  const close = () => (ui.toolbarEdit = null);
  const tool = (item: ToolbarItem) => TOOLS.find(t => t.id === item);
  const label = (item: ToolbarItem) => tool(item)?.label ?? 'Spacer';

  function commit(next: ToolbarLayout) {
    store.settings.toolbar = next;
    store.saveSettings();
  }

  function move(from: number, to: number) {
    commit(moveToolbarItem(layout, from, to));
    selected = to;
  }

  function addSpacer() {
    const at = selected ?? layout.items.length - 1;
    commit(addToolbarSpacer(layout, at));
    selected = at + 1;
  }

  function removeSpacer(i: number) {
    commit(removeToolbarSpacer(layout, i));
    selected = null;
  }

  function reset() {
    commit(structuredClone(DEFAULT_TOOLBAR));
    selected = null;
  }

  // Rows are keyed by place, so the grabbed handle stays in the DOM and keeps the pointer
  function dragStart(e: PointerEvent, i: number) {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragging = selected = i;
  }

  function dragMove(e: PointerEvent) {
    if (dragging === null || !list) return;
    const rows = [...list.children];
    const under = rows.findIndex(r => e.clientY < r.getBoundingClientRect().bottom);
    const to = under < 0 ? rows.length - 1 : under;
    if (to === dragging) return;
    commit(moveToolbarItem(layout, dragging, to));
    dragging = selected = to;
  }
</script>

<svelte:window onkeydown={e => { if (e.key === 'Escape') close(); }} onresize={close} />

<div class="catcher" role="presentation" onmousedown={close} oncontextmenu={e => { e.preventDefault(); close(); }}></div>
<div class="pop" role="dialog" aria-label="Customize toolbar" bind:this={el} style:left="{pos.x}px" style:top="{pos.y}px">
  <h2>Customize toolbar</h2>
  <ol bind:this={list}>
    {#each layout.items as item, i (i)}
      {@const t = tool(item)}
      <li class:selected={selected === i} class:dragging={dragging === i} class:off={t && layout.hidden.includes(t.id)}>
        <span class="grip" role="presentation" title="Drag to move" onpointerdown={e => dragStart(e, i)} onpointermove={dragMove}
          onpointerup={() => (dragging = null)} onpointercancel={() => (dragging = null)}>
          <Icon name="menu" size={14} />
        </span>
        {#if t}
          <label class="name">
            <input type="checkbox" disabled={t.id === 'settings'} checked={!layout.hidden.includes(t.id)} aria-label="Show {t.label}"
              onchange={e => { commit(setToolHidden(layout, t.id as ToolId, !e.currentTarget.checked)); selected = i; }} />
            <Icon name={t.icon} size={15} />
            <span>{t.label}</span>
          </label>
        {:else}
          <span class="name spacer"><span class="line"></span><span>Spacer</span></span>
          <button class="icon-btn" title="Remove spacer" aria-label="Remove spacer {i + 1}" onclick={() => removeSpacer(i)}><Icon name="x" size={14} /></button>
        {/if}
        <button class="icon-btn" title="Move up" aria-label="Move {label(item)} {i + 1} up" disabled={i === 0} onclick={() => move(i, i - 1)}><Icon name="arrow-up" size={14} /></button>
        <button class="icon-btn" title="Move down" aria-label="Move {label(item)} {i + 1} down" disabled={i === layout.items.length - 1} onclick={() => move(i, i + 1)}><Icon name="arrow-down" size={14} /></button>
      </li>
    {/each}
  </ol>
  {#if !q.spacers}<p>Spacers and your name show only in the top toolbar.</p>
  {:else if !q.you}<p>Your name shows only in the top toolbar while connected.</p>{/if}
  <footer>
    <button onclick={addSpacer}>Add spacer</button>
    <button disabled={atDefault} onclick={reset}>Reset</button>
  </footer>
</div>

<style>
  .catcher { position: fixed; inset: 0; z-index: 200; }
  .pop { position: fixed; z-index: 201; width: min(320px, calc(100vw - 16px)); max-height: calc(100dvh - 16px); display: flex; flex-direction: column; padding: 10px; background: var(--bg-1); border: 1px solid var(--line-strong); }
  h2 { margin: 2px 4px 8px; font-size: 11px; font-weight: 650; letter-spacing: 0.07em; text-transform: uppercase; color: var(--text-dim); }
  ol { flex: 1; min-height: 0; overflow-y: auto; margin: 0; padding: 0; list-style: none; }
  li { display: flex; align-items: center; gap: 2px; min-height: 30px; padding-right: 2px; }
  li:hover { background: var(--bg-hover); }
  li.selected { background: var(--bg-active); }
  li.dragging { outline: 1px solid var(--accent); outline-offset: -1px; }
  li.off .name { color: var(--text-dim); }
  .grip { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 28px; color: var(--text-faint); cursor: grab; touch-action: none; }
  li.dragging .grip { cursor: grabbing; }
  .name { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; margin: 0; font-size: 13px; font-weight: 400; letter-spacing: 0; text-transform: none; color: var(--text); }
  .name > span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .name input { flex: none; width: auto; margin: 0; }
  .spacer { color: var(--text-dim); }
  .line { flex: none; width: 1px; height: 16px; margin: 0 7px 0 28px; background: var(--line-strong); }
  li .icon-btn { flex: none; width: 26px; height: 26px; }
  p { margin: 8px 4px 0; font-size: 12px; color: var(--text-dim); }
  footer { display: flex; justify-content: space-between; gap: 8px; margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--line); }
  footer button { padding: 4px; font-size: 13px; color: var(--link); }
  footer button:disabled { color: var(--text-faint); }
</style>
