<script lang="ts">
  import Icon from './Icon.svelte';
  import Avatar from './Avatar.svelte';
  import ChannelNode from './ChannelNode.svelte';
  import { session, sessions } from '../lib/session.svelte.ts';
  import { ui } from '../lib/ui.svelte.ts';
  import { menu } from '../lib/menu.svelte.ts';
  import { PERM } from '../core/client.ts';
  import ResizeHandle from './ResizeHandle.svelte';
  import UserBar from './UserBar.svelte';

  // resizable: false in the phone drawer, which keeps a fixed width
  // handleEdge: which side the resize handle sits on (left when the list is on the right, classic layout)
  // fill: take the whole area (stacked layout, where the parent sizes it)
  let { onnavigate, resizable = true, handleEdge = 'right', fill = false }:
    { onnavigate: () => void; resizable?: boolean; handleEdge?: 'left' | 'right'; fill?: boolean } = $props();

  const MIN_W = 200, DEFAULT_W = 260;
  const maxW = () => Math.max(MIN_W, Math.min(520, window.innerWidth - 520));
  let width = $state(Math.max(MIN_W, Number((() => { try { return localStorage.getItem('mumh5.sidebarWidth'); } catch { return null; } })()) || DEFAULT_W));

  const roots = $derived(session.childrenOf(null));
  const self = $derived(session.self);
  const cert = $derived(session.serverCert);
  const trusted = $derived(!!cert?.authorized);

  // Right-click on free space in the channel list (rows open their own menus and stop the event)
  function listMenu(e: MouseEvent) {
    if (session.status !== 'connected') return;
    const here = session.self?.channelId ?? 0;
    const hereName = session.channel(here)?.name || 'Root';
    const noMake = (id: number) => session.can(id, PERM.MakeChannel) === false && session.can(id, PERM.MakeTempChannel) === false;
    menu.show(e, [
      { label: 'Create channel...', disabled: noMake(0), action: () => (ui.channelDialog = { mode: 'create', parent: 0 }) },
      ...(here !== 0 ? [{ label: `Create channel in ${hereName}...`, disabled: noMake(here), action: () => (ui.channelDialog = { mode: 'create', parent: here }) }] : []),
      { separator: true, label: '' },
      { label: 'Expand all', action: () => session.setAllExpanded(true) },
      { label: 'Collapse all', action: () => session.setAllExpanded(false) }
    ]);
  }

  function showServerCert() {
    if (!cert?.chain.length) return;
    ui.cert = {
      title: `Certificate of ${session.server?.host}`,
      chain: cert.chain,
      status: trusted
        ? { ok: true, text: 'Valid certificate, signed by a trusted authority.' }
        : { ok: false, text: `Not signed by a trusted authority (${cert.authError ?? 'unknown reason'}). mumh5 pinned this certificate the first time you connected and warns you if it changes.` }
    };
  }
  const dms = $derived(
    Object.keys(session.logs).filter(k => k.startsWith('dm:')).map(k => ({ key: k as `dm:${number}`, user: session.user(Number(k.slice(3))) }))
  );
</script>

<aside class="sidebar" class:fill style:width={resizable && !fill ? `${width}px` : undefined}>
  {#if resizable && !fill}<ResizeHandle bind:width edge={handleEdge} min={MIN_W} max={maxW} initial={DEFAULT_W} storageKey="mumh5.sidebarWidth" label="Resize channel list" />{/if}
  <header class:trusted>
    <button class="title" onclick={showServerCert} disabled={!cert} title={cert ? (trusted ? 'Valid certificate. Click to view' : 'Self-signed or untrusted certificate. Click to view') : ''}>
      <strong>{#if cert}<Icon name={trusted ? 'lock' : 'shield'} size={14} />{/if}{session.server?.label ?? 'mumh5'}</strong>
      <span class="status">
        {#if session.status === 'connected'}
          <span class="dot"></span>Connected{#if session.rtt} , {session.rtt} ms{/if}
        {:else if session.status === 'connecting'}Connecting...
        {:else}Not connected{/if}
      </span>
    </button>
    {#if session.status !== 'idle'}
      <button class="icon-btn" title="Disconnect" onclick={() => session.server && sessions.close(session.server.id)}><Icon name="power" size={18} /></button>
    {/if}
  </header>

  <div class="scroll" role="presentation" oncontextmenu={listMenu}>
    {#if session.status === 'connected'}
      <ul class="tree">
        {#each roots as c (c.id)}<ChannelNode channel={c} {onnavigate} />{/each}
      </ul>
      {#if dms.length}
        <h3>Direct messages</h3>
        <ul class="tree">
          {#each dms as dm (dm.key)}
            <li>
              <button class="dm" class:viewing={session.view === dm.key}
                onclick={() => { session.selectView(dm.key); onnavigate(); }}>
                <Avatar name={dm.user?.name ?? '?'} size={22} src={session.avatar(dm.user?.session)} />
                <span class="label" class:offline={!dm.user}>{dm.user?.name ?? 'Offline user'}</span>
                {#if session.unread[dm.key]}<span class="badge">{session.unread[dm.key]}</span>{/if}
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    {/if}
  </div>

  {#if self && sessions.voiceSession && sessions.voiceSession !== sessions.active}
    <div class="elsewhere">
      <span>Voice is on <strong>{sessions.voiceSession.server?.label}</strong>, deafened here</span>
      <button class="btn" onclick={() => sessions.setVoice(sessions.active)}>Talk here</button>
    </div>
  {/if}
  <UserBar toolbar={fill} />
</aside>

<style>
  .sidebar { position: relative; width: 260px; flex: none; display: flex; flex-direction: column; background: var(--bg-1); min-height: 0; }
  .sidebar.fill { width: 100%; height: 100%; }
  header { height: var(--header-h); flex: none; display: flex; align-items: center; gap: 8px; padding: 0 10px 0 0; border-bottom: 1px solid var(--line); }
  header.trusted { background: #1d5c38; border-bottom-color: #2a7a4c; }
  header.trusted .status, header.trusted .icon-btn { color: #cfeedd; }
  header.trusted .dot { background: #fff; }
  .title { flex: 1; min-width: 0; align-self: stretch; display: flex; flex-direction: column; justify-content: center; gap: 1px; padding-left: 16px; text-align: left; transition: background 120ms var(--ease); }
  .title:disabled { opacity: 1; }
  .title:hover:not(:disabled) { background: rgb(255 255 255 / 0.05); }
  .title strong { display: flex; align-items: center; gap: 6px; font-size: 15px; font-weight: 650; letter-spacing: -0.01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .status { font-size: 12px; color: var(--text-dim); display: flex; align-items: center; gap: 6px; }
  .dot { width: 7px; height: 7px; background: var(--speaking); }
  .scroll { flex: 1; overflow-y: auto; padding: 8px; }
  ul { list-style: none; margin: 0; padding: 0; }
  h3 { font-size: 11px; font-weight: 650; text-transform: uppercase; letter-spacing: 0.07em; color: var(--text-faint); margin: 18px 8px 6px; }
  .dm { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 32px; padding: 4px 8px; color: var(--text-dim); text-align: left; transition: background 100ms var(--ease), color 100ms var(--ease); }
  .dm:hover { background: var(--bg-hover); color: var(--text); }
  .dm.viewing { background: var(--bg-active); color: var(--text); }
  .label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .offline { color: var(--text-faint); font-style: italic; }
  .badge { flex: none; min-width: 18px; text-align: center; background: var(--danger); color: #fff; font-size: 11px; font-weight: 700; padding: 0 5px; line-height: 18px; }
  .elsewhere { flex: none; display: flex; align-items: center; gap: 8px; padding: 8px 10px; font-size: 12px; color: var(--text-dim); background: var(--bg-0); border-top: 1px solid var(--line); }
  .elsewhere span { flex: 1; min-width: 0; }
  .elsewhere .btn { padding: 4px 10px; font-size: 12px; }
</style>
