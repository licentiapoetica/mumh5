<script module lang="ts">
  // Per server: the channel chat the first tab returns to after a private chat
  const lastChannel = $state<Record<string, `ch:${number}`>>({});
</script>

<script lang="ts">
  import Background from './Background.svelte';
  import { store } from '../lib/settings.svelte.ts';
  import Icon from './Icon.svelte';
  import Avatar from './Avatar.svelte';
  import { session } from '../lib/session.svelte.ts';
  import { menu } from '../lib/menu.svelte.ts';

  let { always = false }: { always?: boolean } = $props();
  let strip = $state<HTMLElement>();
  // Stacked only: the bar can show the channel list's or the chat's background instead of a plain one
  const mode = $derived(always ? store.settings.tabBarBackground ?? 'none' : 'none');

  const serverId = $derived(session.server?.id ?? '');
  $effect(() => {
    const view = session.view;
    if (view.startsWith('ch:') && serverId) lastChannel[serverId] = view as `ch:${number}`;
  });
  const channelKey = $derived.by((): `ch:${number}` => {
    if (session.view.startsWith('ch:')) return session.view as `ch:${number}`;
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

<!-- Stacked layout always names the channel here; other layouts need tabs for private chats. -->
{#if session.status === 'connected' && (always || dms.length)}
  <div class="tabs-wrap" class:clear={mode === 'chat'} class:own={mode === 'tree'} data-background>
  {#if mode === 'tree'}<Background area="tree" />{/if}
  <div class="chat-tabs" role="tablist" aria-label="Open chats" bind:this={strip}>
    <div class="chat-tab" class:active={session.view === channelKey}>
      <button role="tab" aria-selected={session.view === channelKey} onclick={() => session.selectView(channelKey)}>
        <Icon name="hash" size={16} />
        <span class="name">{session.viewTitle(channelKey)}</span>
        {#if session.unread[channelKey]}<span class="badge">{session.unread[channelKey]}</span>{/if}
      </button>
    </div>
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
  .tabs-wrap { flex: none; background: var(--bg-1); }
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
