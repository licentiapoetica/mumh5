<script lang="ts">
  import Icon from './Icon.svelte';
  import Avatar from './Avatar.svelte';
  import ChannelNode from './ChannelNode.svelte';
  import { session, sessions } from '../lib/session.svelte.ts';
  import { ui } from '../lib/ui.svelte.ts';
  import { menu } from '../lib/menu.svelte.ts';
  import { userMenu } from '../lib/actions.ts';
  import { PERM } from '../core/client.ts';
  import ResizeHandle from './ResizeHandle.svelte';
  import { voice } from '../lib/audio/voice.svelte.ts';
  import { share } from '../lib/share.svelte.ts';

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
  // Without a connection the buttons show the remembered choice, applied at the next connect
  const muted = $derived(self ? self.selfMute : sessions.mute);
  const deafened = $derived(self ? self.selfDeaf : sessions.deaf);
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

  function editDescription() {
    if (!self) return;
    session.showUser(self.session);
    ui.editDescription = true;
    ui.panelOpen = true;
  }

  // Sharing runs on one server at a time; the button stops it from anywhere
  const sharingHere = $derived(!!share.stream);
  const canShare = $derived(session.status === 'connected' && share.supported(sessions.active));
  function toggleShare() {
    if (share.stream) share.stop();
    else share.start(sessions.active);
  }

  // One button for the whole tree: open everything, then close everything
  let allOpen = $state(false);
  function toggleAll() {
    allOpen = !allOpen;
    session.setAllExpanded(allOpen);
  }

  function openQuick(e: MouseEvent, kind: 'input' | 'output') {
    e.preventDefault();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    ui.quickAudio = { kind, x: r.left + r.width / 2, y: r.top };
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
                <Avatar name={dm.user?.name ?? '?'} size={22} />
                <span class="label" class:offline={!dm.user}>{dm.user?.name ?? 'Offline user'}</span>
                {#if session.unread[dm.key]}<span class="badge">{session.unread[dm.key]}</span>{/if}
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    {:else if session.error && !session.disconnectInfo}
      <p class="error">{session.error}</p>
    {:else if session.status === 'idle'}
      <p class="hint">Pick a server on the left, or add one with the plus button.</p>
    {/if}
  </div>

  {#if self && sessions.voiceSession && sessions.voiceSession !== sessions.active}
    <div class="elsewhere">
      <span>Voice is on <strong>{sessions.voiceSession.server?.label}</strong>, deafened here</span>
      <button class="btn" onclick={() => sessions.setVoice(sessions.active)}>Talk here</button>
    </div>
  {/if}
  <footer class="me">
    {#if self}
      <button class="profile" title="Your profile" onclick={() => { session.showUser(self.session); ui.panelOpen = true; }}
        oncontextmenu={e => menu.show(e, userMenu(self))}>
        <Avatar name={self.name} size={32} speaking={voice.transmitting} />
        <span class="who">
          <strong>{self.name}</strong>
          <span>{voice.error ? 'Voice unavailable' : voice.settings.mode === 'ptt' && !self.selfMute ? (voice.pttDown ? 'Talking' : 'Push to talk') : session.channel(self.channelId)?.name || 'Root'}</span>
        </span>
      </button>
    {:else}
      <span class="who offline-who" title="Mute and deafen apply when you connect">
        <strong>{session.status === 'connecting' ? 'Connecting...' : 'Not connected'}</strong>
        <span>{deafened ? 'Deafened' : muted ? 'Muted' : 'Microphone on'}</span>
      </span>
    {/if}
    <div class="tools">
    <button class="icon-btn info" title="Server information" aria-label="Server information"
      disabled={session.status !== 'connected'} onclick={() => (ui.serverInfo = true)}>
      <Icon name="info" size={18} />
    </button>
    <button class="icon-btn" class:on={muted} title={muted ? 'Unmute (right-click for microphone options)' : 'Mute (right-click for microphone options)'}
      aria-label={muted ? 'Unmute' : 'Mute'}
      onclick={() => session.setSelfMute(!muted)} oncontextmenu={e => openQuick(e, 'input')}>
      <Icon name={muted ? 'mic-off' : 'mic'} size={18} />
    </button>
    <button class="icon-btn" class:on={deafened} title={deafened ? 'Undeafen (right-click for output options)' : 'Deafen (right-click for output options)'}
      aria-label={deafened ? 'Undeafen' : 'Deafen'}
      onclick={() => session.setSelfDeaf(!deafened)} oncontextmenu={e => openQuick(e, 'output')}>
      <Icon name={deafened ? 'headphones-off' : 'headphones'} size={18} />
    </button>
    <button class="icon-btn" class:live={sharingHere} title={sharingHere ? 'Stop sharing your screen' : 'Share your screen with your channel'}
      aria-label={sharingHere ? 'Stop sharing your screen' : 'Share your screen'} disabled={!sharingHere && !canShare} onclick={toggleShare}>
      <Icon name="screen" size={18} />
    </button>
    <span class="sep"></span>
    <button class="icon-btn" title="Change your description" aria-label="Change your description" disabled={!self} onclick={editDescription}>
      <Icon name="message" size={18} />
    </button>
    <span class="sep"></span>
    <button class="icon-btn" title="Configure" aria-label="Configure" onclick={() => (ui.settingsOpen = true)}>
      <Icon name="settings" size={18} />
    </button>
    <span class="sep"></span>
    <button class="icon-btn" title={allOpen ? 'Collapse all channels' : 'Expand all channels'} aria-label={allOpen ? 'Collapse all channels' : 'Expand all channels'}
      disabled={session.status !== 'connected'} onclick={toggleAll}>
      <Icon name="filter" size={18} />
    </button>
    </div>
  </footer>
</aside>

<style>
  .sidebar { position: relative; width: 260px; flex: none; display: flex; flex-direction: column; background: var(--bg-1); min-height: 0; }
  .sidebar.fill { width: 100%; height: 100%; }
  header { height: 52px; flex: none; display: flex; align-items: center; gap: 8px; padding: 0 8px 0 0; border-bottom: 1px solid var(--line); }
  header.trusted { background: #1d5c38; border-bottom-color: #2a7a4c; }
  header.trusted .status, header.trusted .icon-btn { color: #cfeedd; }
  header.trusted .dot { background: #fff; }
  .title { flex: 1; min-width: 0; align-self: stretch; display: flex; flex-direction: column; justify-content: center; padding-left: 14px; text-align: left; }
  .title:disabled { opacity: 1; }
  .title:hover:not(:disabled) { background: rgb(255 255 255 / 0.05); }
  .title strong { display: flex; align-items: center; gap: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .status { font-size: 12px; color: var(--text-dim); display: flex; align-items: center; gap: 6px; }
  .dot { width: 8px; height: 8px; background: var(--speaking); }
  .scroll { flex: 1; overflow-y: auto; padding: 8px 6px; }
  ul { list-style: none; margin: 0; padding: 0; }
  h3 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-faint); margin: 18px 8px 6px; }
  .dm { display: flex; align-items: center; gap: 8px; width: 100%; padding: 4px 8px; color: var(--text-dim); text-align: left; }
  .dm:hover { background: var(--bg-hover); color: var(--text); }
  .dm.viewing { background: var(--bg-active); color: var(--text); }
  .label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .offline { color: var(--text-faint); font-style: italic; }
  .badge { background: var(--danger); color: #fff; font-size: 11px; font-weight: 700; padding: 0 5px; line-height: 16px; }
  .hint, .error { padding: 8px; color: var(--text-dim); font-size: 14px; }
  .error { color: var(--danger); }
  .elsewhere { flex: none; display: flex; align-items: center; gap: 8px; padding: 8px 10px; font-size: 12px; color: var(--text-dim); background: var(--bg-0); border-top: 1px solid var(--line); }
  .elsewhere span { flex: 1; min-width: 0; }
  .elsewhere .btn { padding: 4px 10px; font-size: 12px; }
  /* One row when the sidebar is wide enough, otherwise the buttons go under the profile */
  .me { flex: none; min-height: var(--footer-h); display: flex; flex-wrap: wrap; align-items: center; gap: 2px 8px; padding: 4px 8px; background: var(--bg-0); }
  .tools { flex: none; max-width: 100%; display: flex; flex-wrap: wrap; align-items: center; gap: 2px; }
  .sep { width: 1px; height: 20px; margin: 0 4px; background: var(--line); }
  /* Stacked layout: the bar leads the stack, like the desktop client's toolbar */
  .sidebar.fill .me { order: -1; border-bottom: 1px solid var(--line); }
  .sidebar.fill .me .profile, .sidebar.fill .me .offline-who { display: none; }
  .profile { flex: 1 1 110px; min-width: 0; display: flex; align-items: center; gap: 8px; padding: 2px; text-align: left; }
  .profile:hover { background: var(--bg-hover); }
  .who { flex: 1; min-width: 0; display: flex; flex-direction: column; line-height: 1.2; }
  .who strong, .who span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .who span { font-size: 12px; color: var(--text-dim); }
  .info, .info:hover { color: var(--warn); }
  .live, .live:hover { color: var(--speaking); }
  .offline-who { flex: 1 1 110px; padding: 2px 2px 2px 6px; color: var(--text-dim); }
</style>
