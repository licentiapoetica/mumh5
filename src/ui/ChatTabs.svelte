<script module lang="ts">
  // Per server: the channel chat the first tab returns to after a private chat
  const lastChannel = $state<Record<string, `ch:${number}`>>({});
// Per server: text channels opened as tabs (closing a tab only hides it)
const openText = $state<Record<string, number[]>>({});
</script>

<script lang="ts">
  import Background from './Background.svelte';
  import { store } from '../lib/settings.svelte.ts';
  import { areaBackground } from '../lib/background.svelte.ts';
  import Icon from './Icon.svelte';
  import Avatar from './Avatar.svelte';
  import { session } from '../lib/session.svelte.ts';
  import { menu } from '../lib/menu.svelte.ts';

  let { always = false }: { always?: boolean } = $props();
  let strip = $state<HTMLElement>();
  // Height of the channel list's background, which the bar carries on from its lower edge
  let listH = $state(0);
  $effect(() => {
    if (mode !== 'tree') return;
    const list = document.querySelector<HTMLElement>('.sidebar .tree-bg');
    if (!list) { listH = 0; return; }
    const watch = new ResizeObserver(() => (listH = list.offsetHeight));
    watch.observe(list);
    return () => watch.disconnect();
  });
  // Stacked only: the bar can show the channel list's or the chat's background instead of a plain one
  const mode = $derived(always ? store.settings.tabBarBackground ?? 'none' : 'none');
  // A gradient flows from the list into the bar, so the line between them goes
  const seam = $derived(mode === 'tree' && areaBackground('tree')?.style.design === 'gradient');
  let bar = $state<HTMLElement>();
  // The list's resize handle moves under this bar while the bar touches the list. Measured,
  // since an empty stream area can stand between them in the page without taking room.
  $effect(() => {
    const own = bar, stack = own?.closest<HTMLElement>('.stack');
    const tree = stack?.querySelector<HTMLElement>(':scope > .tree');
    const chat = own?.parentElement, log = chat?.querySelector<HTMLElement>(':scope > .logbox');
    if (!own || !stack || !tree || !chat) return;
    const place = () => {
      stack.classList.toggle('tabs-under-list', Math.abs(own.getBoundingClientRect().top - tree.getBoundingClientRect().bottom) < 1);
      stack.style.setProperty('--tab-bar', `${own.offsetHeight}px`);
    };
    const sized = new ResizeObserver(place);
    for (const el of [own, tree, log]) if (el) sized.observe(el);
    // A stream area coming or going moves the bar
    const children = new MutationObserver(place);
    children.observe(chat, { childList: true });
    return () => {
      sized.disconnect();
      children.disconnect();
      stack.classList.remove('tabs-under-list');
      stack.style.removeProperty('--tab-bar');
    };
  });
  // Two gradients never round to the same colors, so a gradient is one box over the list and the
  // bar, and each shows its part. Both read these sizes, so the boxes are identical.
  $effect(() => {
    const own = bar, stack = own?.closest<HTMLElement>('.stack');
    const list = document.querySelector<HTMLElement>('.sidebar .tree-bg');
    if (!seam || !own || !stack || !list) return;
    const watch = new ResizeObserver(() => {
      stack.style.setProperty('--seam-list', `${list.getBoundingClientRect().height}px`);
      stack.style.setProperty('--seam-bar', `${own.getBoundingClientRect().height}px`);
    });
    watch.observe(list);
    watch.observe(own);
    return () => {
      watch.disconnect();
      stack.style.removeProperty('--seam-list');
      stack.style.removeProperty('--seam-bar');
    };
  });

  const serverId = $derived(session.server?.id ?? '');
  $effect(() => {
    const view = session.view;
    if (!view.startsWith('ch:') || !serverId) return;
    const id = Number(view.slice(3));
    if (session.isText(id)) {
      const list = openText[serverId] ?? [];
      if (!list.includes(id)) openText[serverId] = [...list, id];
    } else lastChannel[serverId] = view as `ch:${number}`;
  });
  // Channels that stopped being text channels or were removed lose their tab
  const texts = $derived((openText[serverId] ?? []).filter(id => session.channel(id) && session.isText(id))
    .map(id => ({ key: `ch:${id}` as `ch:${number}`, id, name: session.viewTitle(`ch:${id}`) })));
  function closeText(id: number) {
    openText[serverId] = (openText[serverId] ?? []).filter(x => x !== id);
    delete session.unread[`ch:${id}`];
    if (session.view === `ch:${id}`) session.selectView(channelKey);
  }
  const channelKey = $derived.by((): `ch:${number}` => {
    if (session.view.startsWith('ch:') && !session.isText(Number(session.view.slice(3)))) return session.view as `ch:${number}`;
    const kept = lastChannel[serverId];
    return kept && session.channel(Number(kept.slice(3))) ? kept : `ch:${session.self?.channelId ?? 0}`;
  });
  const dms = $derived(Object.keys(session.logs).filter(k => k.startsWith('dm:'))
    .map(k => ({ key: k as `dm:${number}`, user: session.user(Number(k.slice(3))), name: session.viewTitle(k) })));

  $effect(() => {
    void session.view;
    strip?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });

  const dmMenu = (e: MouseEvent, key: `dm:${number}`) => menu.show(e, [
    { label: 'Close conversation', action: () => session.closeDm(key) },
    { label: 'Delete history', action: () => session.deleteDm(key) }
  ]);
</script>

<!-- Order: your voice channel's chat, open text channels, private chats. Stacked layout always shows it. -->
{#if session.status === 'connected' && (always || dms.length || texts.length)}
  <div class="tabs-wrap" class:clear={mode === 'chat'} class:own={mode === 'tree'} class:seam data-background bind:this={bar}>
  {#if mode === 'tree'}<Background area="tree" reach={seam ? undefined : listH || undefined} />{/if}
  <div class="chat-tabs" role="tablist" aria-label="Open chats" bind:this={strip}>
    <div class="chat-tab" class:active={session.view === channelKey}>
      <button role="tab" aria-selected={session.view === channelKey} onclick={() => session.selectView(channelKey)}>
        <Icon name="volume" size={16} />
        <span class="name">{session.viewTitle(channelKey)}</span>
        {#if session.unread[channelKey]}<span class="badge">{session.unread[channelKey]}</span>{/if}
      </button>
    </div>
    {#each texts as t (t.key)}
      <div class="chat-tab" class:active={session.view === t.key} role="presentation"
        onauxclick={e => { if (e.button === 1) closeText(t.id); }}>
        <button role="tab" aria-selected={session.view === t.key} title="Text channel: {t.name}" onclick={() => session.selectView(t.key)}>
          <Icon name="hash" size={16} />
          <span class="name">{t.name}</span>
          {#if session.unread[t.key]}<span class="badge">{session.unread[t.key]}</span>{/if}
        </button>
        <button class="close" title="Close tab" aria-label="Close tab for {t.name}" onclick={() => closeText(t.id)}><Icon name="x" size={14} /></button>
      </div>
    {/each}
    {#each dms as dm (dm.key)}
      <div class="chat-tab" class:active={session.view === dm.key} role="presentation"
        oncontextmenu={e => dmMenu(e, dm.key)}
        onauxclick={e => { if (e.button === 1) session.closeDm(dm.key); }}>
        <button role="tab" aria-selected={session.view === dm.key} title={dm.name} onclick={() => session.selectView(dm.key)}>
          <Avatar name={dm.name} size={18} src={session.avatar(dm.user?.session)} />
          <span class="name" class:offline={!dm.user}>{dm.name}</span>
          {#if session.unread[dm.key]}<span class="badge">{session.unread[dm.key]}</span>{/if}
        </button>
        <button class="close" title="Close conversation" aria-label="Close conversation with {dm.name}"
          onclick={() => session.closeDm(dm.key)}><Icon name="x" size={14} /></button>
      </div>
    {/each}
  </div>
  </div>
{/if}

<style>
  /* Right under the list, with no stream between, the list has no lower line: each tab draws its
     own top line instead (the active one its accent), and the bar beside them stays open */
  :global(.stack.tabs-under-list > .tree) { border-bottom-width: 0; --tree-line: 0px; }
  :global(.stack.tabs-under-list) .chat-tab { background-image: linear-gradient(var(--line), var(--line)); background-size: 100% 1px; background-repeat: no-repeat; background-origin: border-box; }
  /* The handle's line replaces the bar's lower border; its grab area lies below, clear of the tabs and their scrollbar */
  :global(.stack.tabs-under-list > .tree > .resize.bottom) { bottom: calc(-7px - var(--tree-line, 1px) - var(--tab-bar, 0px)); --line-at: 0px; }
  :global(.stack:has(.tabs-wrap.seam) .tree-bg) { overflow: hidden; }
  /* will-change: each piece gets its own layer, so both are blended the same way and round alike */
  :global(.stack:has(.tabs-wrap.seam) .tree-bg > .background-art) { bottom: auto; height: calc(var(--seam-list, 100%) + var(--seam-bar, 0px)); will-change: transform; }
  .tabs-wrap.seam > :global(.background-art) { top: calc(-1 * var(--seam-list, 0px)); bottom: auto; height: calc(var(--seam-list, 100%) + var(--seam-bar, 0px)); will-change: transform; }
  .tabs-wrap { flex: none; overflow: hidden; background: var(--bg-1); }
  .tabs-wrap.clear { background: none; }
  .tabs-wrap.clear .chat-tabs, .tabs-wrap.own .chat-tabs { background: none; }
  .chat-tabs { position: relative; flex: none; display: flex; overflow-x: auto; overflow-y: hidden; scrollbar-width: thin; background: var(--bg-1); border-bottom: 1px solid var(--line); }
  .chat-tab { flex: none; display: flex; max-width: 200px; border-right: 1px solid var(--line); border-top: 2px solid transparent; color: var(--text-dim); transition: background 100ms var(--ease), color 100ms var(--ease); }
  .chat-tab:hover { background: var(--bg-hover); color: var(--text); }
  .chat-tab.active { background: var(--bg-2); color: var(--text); border-top-color: var(--accent); }
  [role='tab'] { min-width: 0; height: var(--control-h); display: flex; align-items: center; gap: 6px; padding: 0 10px; color: inherit; font-size: 13px; }
  [role='tab'] :global(svg) { flex: none; }
  .chat-tab:has(.close) [role='tab'] { padding-right: 4px; }
  .name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .offline { color: var(--text-faint); font-style: italic; }
  .badge { flex: none; min-width: 18px; padding: 0 5px; line-height: 18px; text-align: center; font-size: 11px; font-weight: 700; background: var(--danger); color: #fff; }
  .close { flex: none; width: 26px; display: grid; place-items: center; color: var(--text-faint); }
  .close:hover { color: var(--text); }
</style>
