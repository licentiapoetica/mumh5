<script lang="ts" module>
  import { toGroups, type EmojiGroup, type RawEmojiGroup } from '../core/emoji.ts';

  // A separate chunk, so the palette costs nothing until someone opens it
  let loading: Promise<EmojiGroup[]> | null = null;
  function loadEmoji(): Promise<EmojiGroup[]> {
    loading ??= import('unicode-emoji-json/data-by-group.json').then(m => toGroups(m.default as RawEmojiGroup[]));
    loading.catch(() => { loading = null; });
    return loading;
  }
</script>

<script lang="ts">
  import { onMount, tick } from 'svelte';
  import Icon from './Icon.svelte';
  import { SKIN_TONES, searchEmoji, withTone, type Emoji } from '../core/emoji.ts';

  let { anchor, onpick, onclose }: {
    anchor: HTMLElement;
    onpick: (emoji: string, keepOpen: boolean) => void;
    onclose: (refocus: boolean) => void;
  } = $props();

  const COLUMNS = 8;
  const HAND = '\u{1F44B}';
  const GROUP_ICONS: Record<string, string> = {
    smileys_emotion: 'smile', people_body: 'users', animals_nature: 'leaf', food_drink: 'coffee',
    travel_places: 'car', activities: 'trophy', objects: 'bulb', symbols: 'heart', flags: 'flag'
  };

  let root: HTMLDivElement;
  let field: HTMLInputElement;
  let scroller = $state<HTMLDivElement>();
  let groups = $state.raw<EmojiGroup[]>([]);
  let failed = $state(false);
  let query = $state('');
  let active = $state('smileys_emotion');
  let toneIndex = $state(loadTone());
  let place = $state(placeAtAnchor());
  let lastWidth = window.innerWidth;

  const tone = $derived(SKIN_TONES[toneIndex]);
  const results = $derived(query.trim() ? searchEmoji(groups, query) : []);
  const sections = $derived(query.trim() ? [{ name: 'Results', slug: 'results', emojis: results }] : groups);
  const shown = (e: Emoji) => (e.tones ? withTone(e.emoji, tone.modifier) : e.emoji);

  function loadTone(): number {
    try {
      const n = Number(localStorage.getItem('mumh5.emojiTone'));
      return Number.isInteger(n) && n >= 0 && n < SKIN_TONES.length ? n : 0;
    } catch { return 0; }
  }

  function nextTone() {
    toneIndex = (toneIndex + 1) % SKIN_TONES.length;
    try { localStorage.setItem('mumh5.emojiTone', String(toneIndex)); } catch { /* storage unavailable */ }
  }

  // Above the button, kept on screen on short and narrow windows
  function placeAtAnchor() {
    const r = anchor.getBoundingClientRect();
    const height = Math.min(400, Math.max(240, r.top - 16));
    const width = Math.min(352, window.innerWidth - 16);
    return {
      height,
      bottom: Math.max(8, Math.min(window.innerHeight - r.top + 6, window.innerHeight - height - 8)),
      right: Math.max(8, Math.min(window.innerWidth - r.right, window.innerWidth - width - 8))
    };
  }

  function outside(e: PointerEvent) {
    const t = e.target as Node;
    if (!root.contains(t) && !anchor.contains(t)) onclose(false);
  }

  // A phone's keyboard changes only the height, and must not close the picker
  function resized() {
    if (window.innerWidth !== lastWidth) onclose(false);
    lastWidth = window.innerWidth;
  }

  function pickFrom(e: MouseEvent) {
    const cell = (e.target as HTMLElement).closest<HTMLElement>('[data-emoji]');
    if (!cell?.dataset.emoji) return;
    onpick(cell.dataset.emoji, e.shiftKey);
    if (e.shiftKey) cell.focus();
  }

  async function jump(slug: string) {
    query = '';
    await tick();
    active = slug;
    const section = scroller?.querySelector<HTMLElement>(`[data-group="${slug}"]`);
    if (scroller && section) scroller.scrollTop = section.offsetTop;
  }

  function trackGroup() {
    if (query.trim() || !scroller) return;
    const top = scroller.scrollTop + 8;
    for (const s of scroller.querySelectorAll<HTMLElement>('[data-group]')) {
      if (s.offsetTop <= top && s.dataset.group) active = s.dataset.group;
    }
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    onclose(true);
  }

  function fieldKey(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      scroller?.querySelector<HTMLElement>('[data-emoji]')?.focus();
    } else if (e.key === 'Enter' && results.length) {
      e.preventDefault();
      onpick(shown(results[0]), e.shiftKey);
    }
  }

  function gridKey(e: KeyboardEvent) {
    const step = ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -COLUMNS, ArrowDown: COLUMNS } as Record<string, number>)[e.key];
    if (!step || !scroller) return;
    e.preventDefault();
    const cells = [...scroller.querySelectorAll<HTMLElement>('[data-emoji]')];
    const next = cells.indexOf(document.activeElement as HTMLElement) + step;
    if (next < 0) field.focus();
    else cells[Math.min(next, cells.length - 1)]?.focus();
  }

  onMount(() => {
    // On touch screens the keyboard stays down until someone taps the search field
    (matchMedia('(pointer: fine)').matches ? field : root).focus();
    loadEmoji().then(g => { groups = g; }, () => { failed = true; });
  });
</script>

<svelte:window onpointerdown={outside} onresize={resized} />

<div class="emoji-pop" role="dialog" aria-label="Emoji" tabindex="-1" bind:this={root} {onkeydown}
  style:right="{place.right}px" style:bottom="{place.bottom}px" style:height="{place.height}px">
  <div class="emoji-head">
    <input bind:this={field} bind:value={query} placeholder="Search emoji" aria-label="Search emoji"
      oninput={() => { if (scroller) scroller.scrollTop = 0; }} onkeydown={fieldKey} />
    <button class="emoji-tone" title="Skin tone: {tone.name}" aria-label="Skin tone: {tone.name}" onclick={nextTone}>{withTone(HAND, tone.modifier)}</button>
  </div>
  <div class="emoji-groups">
    {#each groups as g (g.slug)}
      <button class="emoji-group" class:on={!query.trim() && active === g.slug} title={g.name} aria-label={g.name} onclick={() => jump(g.slug)}>
        <Icon name={GROUP_ICONS[g.slug] ?? 'smile'} size={16} />
      </button>
    {/each}
  </div>
  <div class="emoji-scroll" role="presentation" bind:this={scroller} onscroll={trackGroup} onclick={pickFrom} onkeydown={gridKey}>
    {#if failed}
      <p>Could not load emoji.</p>
    {:else if !groups.length}
      <p>Loading...</p>
    {:else if query.trim() && !results.length}
      <p>No emoji found.</p>
    {:else}
      {#each sections as s (s.slug)}
        <section class="emoji-section" data-group={s.slug} style:--section-h="{26 + Math.ceil(s.emojis.length / COLUMNS) * 36}px">
          <h3>{s.name}</h3>
          <div class="emoji-grid">
            {#each s.emojis as e (e.emoji)}
              <button class="emoji-cell" tabindex="-1" title={e.name} aria-label={e.name} data-emoji={shown(e)}>{shown(e)}</button>
            {/each}
          </div>
        </section>
      {/each}
    {/if}
  </div>
</div>

<style>
  .emoji-pop { position: fixed; z-index: 50; width: min(352px, calc(100vw - 16px)); display: flex; flex-direction: column; background: var(--bg-1); border: 1px solid var(--line-strong); outline: none; }
  .emoji-head { flex: none; display: flex; gap: 4px; padding: 8px 8px 6px; }
  .emoji-head input { flex: 1; min-width: 0; }
  .emoji-tone { flex: none; width: var(--control-h); height: var(--control-h); display: grid; place-items: center; font-size: 18px; line-height: 1; border: 1px solid var(--line-strong); background: var(--bg-0); transition: background 120ms var(--ease); }
  .emoji-tone:hover { background: var(--bg-hover); }
  .emoji-groups { flex: none; display: grid; grid-template-columns: repeat(9, 1fr); padding: 0 6px; border-bottom: 1px solid var(--line); }
  .emoji-group { height: 32px; display: grid; place-items: center; color: var(--text-faint); transition: color 120ms var(--ease), background 120ms var(--ease); }
  .emoji-group:hover { color: var(--text); background: var(--bg-hover); }
  .emoji-group.on { color: var(--accent-hover); box-shadow: inset 0 -2px 0 var(--accent); }
  .emoji-scroll { position: relative; flex: 1; min-height: 0; overflow-y: auto; padding: 0 6px 8px; }
  .emoji-scroll p { margin: 16px 4px; color: var(--text-dim); font-size: 13px; }
  /* 1900 buttons: the browser lays out only the groups in view */
  .emoji-section { content-visibility: auto; contain-intrinsic-block-size: auto var(--section-h); }
  h3 { height: 14px; margin: 8px 2px 4px; font-size: 11px; line-height: 14px; font-weight: 650; text-transform: uppercase; letter-spacing: 0.07em; color: var(--text-faint); }
  .emoji-grid { display: grid; grid-template-columns: repeat(8, 1fr); grid-auto-rows: 36px; }
  .emoji-cell, .emoji-tone { font-family: 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif; }
  .emoji-cell { display: grid; place-items: center; min-width: 0; font-size: 22px; line-height: 1; transition: background 80ms var(--ease); }
  .emoji-cell:hover, .emoji-cell:focus-visible { background: var(--bg-active); outline: none; }
</style>
