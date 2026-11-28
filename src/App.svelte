<script lang="ts">
  import { untrack } from 'svelte';
  import { applyLanguage } from './lib/i18n.svelte.ts';
  import ServerRail from './ui/ServerRail.svelte';
  import Sidebar from './ui/Sidebar.svelte';
  import Chat from './ui/Chat.svelte';
  import RightPanel from './ui/RightPanel.svelte';
  import ConnectDialog from './ui/ConnectDialog.svelte';
  import SettingsDialog from './ui/SettingsDialog.svelte';
  import CertDialog from './ui/CertDialog.svelte';
  import CertViewer from './ui/CertViewer.svelte';
  import PromptDialog from './ui/PromptDialog.svelte';
  import PokeDialog from './ui/PokeDialog.svelte';
  import ContextMenu from './ui/ContextMenu.svelte';
  import IdentityWizard from './ui/IdentityWizard.svelte';
  import QuickAudio from './ui/QuickAudio.svelte';
  import ToolbarEditor from './ui/ToolbarEditor.svelte';
  import UserInfoDialog from './ui/UserInfoDialog.svelte';
  import ChannelDialog from './ui/ChannelDialog.svelte';
  import PublicServers from './ui/PublicServers.svelte';
  import ServerInfoDialog from './ui/ServerInfoDialog.svelte';
  import RolesDialog from './ui/RolesDialog.svelte';
  import ImageViewer from './ui/ImageViewer.svelte';
  import ShareDialog from './ui/ShareDialog.svelte';
  import ProfileCard from './ui/ProfileCard.svelte';
  import ProfileDialog from './ui/ProfileDialog.svelte';
  import Home from './ui/Home.svelte';
  import { share } from './lib/share.svelte.ts';
  import ResizeHandle from './ui/ResizeHandle.svelte';
  import Icon from './ui/Icon.svelte';
  import { updates } from './lib/updates.svelte.ts';
  import { identities } from './lib/identities.svelte.ts';
  import { session, sessions } from './lib/session.svelte.ts';
  import { ui } from './lib/ui.svelte.ts';
  import { desktop } from './lib/native.ts';
  import { store, type SavedServer } from './lib/settings.svelte.ts';
  import { applyThemeStyle } from './lib/custom-themes.ts';
  import { studio } from './lib/theme-studio.svelte.ts';
  import ThemeCreator from './ui/ThemeCreator.svelte';
  import { applyCorners } from './lib/corners.ts';
  import { settingsWindow } from './lib/settings-window.svelte.ts';
  import { rolesWindow } from './lib/roles-window.svelte.ts';
  import { chatHistory } from './lib/chat-history.ts';

  $effect(() => {
    const enabled = store.settings.saveChatHistory, hours = store.settings.chatHistoryHours;
    untrack(() => { void chatHistory.configure(enabled, hours); });
  });

  let lastShareRoute = store.settings.screenShareRoute;
  $effect(() => {
    const route = store.settings.screenShareRoute;
    if (!desktop || route === lastShareRoute) return;
    lastShareRoute = route;
    untrack(() => {
      share.screenPolicyChanged();
      for (const server of sessions.list) server.mumpeer.policyChanged();
    });
  });

  // Mumpeer discovery also serves files sent through the relay
  let lastFileLink = store.settings.fileLink;
  $effect(() => {
    const v = store.settings.fileLink;
    if (v === lastFileLink) return;
    lastFileLink = v;
    untrack(() => { for (const server of sessions.list) server.mumpeer.policyChanged(); });
  });

  let width = $state(window.innerWidth);
  // wide: rail + sidebar + chat + panel; medium: panel as an overlay; narrow: everything but chat in drawers
  const layout = $derived(width >= 1100 ? 'wide' : width >= 760 ? 'medium' : 'narrow');

  // Arrangement (Appearance setting): side is the default, classic puts the channel list right
  // of the chat, stacked above it. Narrow windows use drawers, except stacked, which works at any width.
  const arrangement = $derived(store.settings.arrangement === 'stacked' ? 'stacked' : layout === 'narrow' ? 'side' : store.settings.arrangement ?? 'side');
  const classicLeft = $derived(store.settings.classicSide === 'left');
  // The member panel sits inline only in the side arrangement on wide windows, otherwise it overlays
  const panelInline = $derived(layout === 'wide' && arrangement === 'side');
  let treeHeight = $state(Math.max(120, Number((() => { try { return localStorage.getItem('mumh5.treeHeight'); } catch { return null; } })()) || 280));

  let navOpen = $state(false);
  // Stacked layout: the channel list may grow until the chat below is at its minimum
  let stackEl = $state<HTMLElement>();
  const treeMax = () => {
    const chat = stackEl?.querySelector<HTMLElement>(':scope > .chat');
    const chatMin = chat ? parseFloat(getComputedStyle(chat).minHeight) || 0 : 220;
    return Math.max(120, (stackEl?.clientHeight ?? window.innerHeight) - chatMin);
  };
  let editing = $state<{ server: SavedServer | null } | null>(null);

  const showPanel = $derived(ui.panelOpen && session.status === 'connected');
  // Not connected to the server shown: the start screen with the saved servers takes the window
  const home = $derived(session.status === 'idle');
  const railHidden = $derived(store.settings.railHidden);
  // The phone drawer holds the server list and the channels together, hidden or not
  // Private chats: tabs above the chat where the channel list is not always beside it, a list in it otherwise
  const chatTabs = $derived(arrangement === 'stacked' || layout === 'narrow');
  $effect(() => { ui.chatTabs = chatTabs; });
  const inDrawer = $derived(layout === 'narrow' && arrangement === 'side' && !home);
  // Home on request lies over the server view: unmounting it would lose drafts and stop stream audio
  const homeOver = $derived(sessions.homeShown && !home);
  let appEl = $state<HTMLElement>();
  $effect(() => {
    void layout; void arrangement;
    if (!homeOver || !appEl) return;
    navOpen = false;
    (document.activeElement as HTMLElement | null)?.blur();
    const behind = [...appEl.querySelectorAll<HTMLElement>(':scope > .chat, :scope > .stack, :scope > .sidebar, :scope > .panel, .nav > .sidebar')];
    for (const el of behind) el.inert = true;
    return () => { for (const el of behind) el.inert = false; };
  });

  // Servers marked to connect at start, once the identities are ready (not during first-run setup)
  // Test clients (MUMH5_TEST_SERVER=host:port): that server is always saved and joined at start
  function seedTestServer() {
    const m = /^(.+):(\d+)$/.exec(desktop?.testServer ?? '');
    if (!m) return;
    const [, host, port] = m;
    const known = store.servers.find(s => s.host === host && s.port === Number(port));
    if (known?.autoConnect && known.username) return;
    store.upsertServer({ id: crypto.randomUUID(), label: 'Local test', username: 'tester', password: '', ...known, host, port: Number(port), autoConnect: true });
  }
  let started = false;
  $effect(() => {
    if (started || !identities.loaded || !identities.setupDone) return;
    started = true;
    untrack(() => {
      seedTestServer();
      sessions.connectOnStart(store.servers);
    });
  });

  // Color scheme on the root element; dark is the stylesheet default
  $effect(() => {
    const own = studio.shown;
    // A theme that no longer exists falls back to dark; an edited scheme keeps its own
    const t = studio.scheme;
    if (t !== 'dark') document.documentElement.dataset.theme = t;
    else delete document.documentElement.dataset.theme;
    applyThemeStyle(document.documentElement.style, own);
    // Title bar of the installed web app and phone status bars
    const color = getComputedStyle(document.documentElement).getPropertyValue('--bg-1').trim();
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color || '#141518');
  });

  $effect(() => applyCorners(document.documentElement.style, store.settings.corners));

  // Settings opens in a window of its own; the dialog is only for phones and blocked pop-ups.
  // Before the page updates, so the dialog never shows for a moment first.
  $effect.pre(() => {
    if (!ui.settingsOpen) return;
    const tab = ui.settingsTab;
    if (!untrack(() => settingsWindow.present(tab))) return;
    ui.settingsOpen = false;
    ui.settingsTab = 'voice';
  });

  // Roles and members too, the same way
  $effect.pre(() => {
    const request = ui.rolesDialog;
    if (!request || !untrack(() => rolesWindow.present(request))) return;
    ui.rolesDialog = null;
  });

  // The panel starts open only where it sits inline
  let lastLayout = '';
  $effect(() => {
    const key = `${layout}/${arrangement}`;
    if (key === lastLayout) return;
    ui.panelOpen = panelInline;
    lastLayout = key;
  });
  // On phones one drawer at a time
  $effect(() => { if (layout === 'narrow' && ui.panelOpen) navOpen = false; });
  // Opening a chat from anywhere (a profile card, a menu) shows it
  $effect(() => { void session.view; navOpen = false; });

  function togglePanel() {
    if (!ui.panelOpen) ui.panelOpen = true;
    else if (session.panel.kind !== 'members') session.closePanel();
    else ui.panelOpen = false;
  }

  // Images in rendered text (messages, descriptions, the quick preview) and image embeds open
  // large on click. Not in editors, link preview cards or the YouTube card.
  function imageClick(e: MouseEvent) {
    if (e.button !== 0 || !(e.target instanceof HTMLImageElement)) return;
    const img = e.target;
    if (!img.closest('.html, .embed') || img.closest('[contenteditable], .rich, .card, .yt, .poster')) return;
    e.preventDefault();
    e.stopPropagation();
    ui.image = img.currentSrc || img.src;
  }

  // The copy button on code blocks in rendered text (html.ts)
  function codeCopy(e: MouseEvent) {
    const button = e.target instanceof Element ? e.target.closest('.code > .copy') : null;
    const code = button?.parentElement?.querySelector('pre')?.textContent;
    if (!button || code == null) return;
    e.preventDefault();
    e.stopPropagation();
    navigator.clipboard.writeText(code).then(() => {
      button.classList.add('copied');
      setTimeout(() => button.classList.remove('copied'), 1500);
    }, () => {});
  }

  const closeOverlays = () => {
    navOpen = false;
    if (!panelInline) ui.panelOpen = false;
  };

  // Screen readers and spell check follow the interface language
  $effect(() => applyLanguage());
</script>

<svelte:window bind:innerWidth={width} onclickcapture={e => { imageClick(e); codeCopy(e); }} />

{#snippet rail()}
  <ServerRail canHide={!inDrawer} onadd={() => (editing = { server: null })} onbrowse={() => (ui.publicServers = true)}
    onsettings={() => (ui.settingsOpen = true)} />
{/snippet}
{#snippet chat()}
  <Chat tabs={chatTabs} showMenu={layout === 'narrow' && arrangement === 'side'} showStage={!panelInline && arrangement === 'side'} videoOnly={arrangement === 'stacked'}
    serverButton={railHidden && arrangement === 'classic' && !classicLeft} onmenu={() => (navOpen = true)} onpanel={togglePanel} />
{/snippet}

<div class="frame">
{#if updates.showBar && updates.info}
  <div class="update-bar" role="status">
    <Icon name="download" size={16} />
    {#if updates.web}
      <span class="msg">This site has a newer version of mumh5.</span>
      <button class="btn primary" title="Loads the new version. Disconnects from servers until it has loaded." onclick={() => updates.reload()}>Reload</button>
    {:else}
      <span class="msg">A newer mumh5 is available ({updates.info.changes} {updates.info.changes === 1 ? 'change' : 'changes'}).</span>
      <a class="btn primary" href={updates.info.url} target="_blank" rel="noreferrer">Download</a>
    {/if}
    <button class="icon-btn" aria-label="Not now" title="Hide until there is another update" onclick={() => updates.dismiss()}><Icon name="x" size={16} /></button>
  </div>
{/if}
<div class="app {layout} {arrangement}" class:home bind:this={appEl}>
  {#if home}
    {#if !railHidden}{@render rail()}{/if}
    <Home top={arrangement === 'stacked'} onadd={() => (editing = { server: null })} onedit={s => (editing = { server: s })} onbrowse={() => (ui.publicServers = true)} />
  {:else if arrangement === 'classic'}
    {#if !railHidden}{@render rail()}{/if}
    {#if classicLeft}<Sidebar serverButton={railHidden} onnavigate={() => {}} />{/if}
    {@render chat()}
    {#if !classicLeft}<Sidebar handleEdge="left" onnavigate={() => {}} />{/if}
  {:else if arrangement === 'stacked'}
    {#if !railHidden}{@render rail()}{/if}
    <div class="stack" bind:this={stackEl}>
      <div class="tree" style:height="{treeHeight}px">
        <Sidebar fill chats={false} onnavigate={() => {}} />
        <ResizeHandle bind:width={treeHeight} edge="bottom" min={120} max={treeMax} initial={280}
          storageKey="mumh5.treeHeight" label="Resize channel list" />
      </div>
      {@render chat()}
    </div>
  {:else}
    {#if layout !== 'narrow' || navOpen}
      <div class="nav" class:drawer={layout === 'narrow'}>
        {#if !railHidden || layout === 'narrow'}{@render rail()}{/if}
        <Sidebar resizable={layout !== 'narrow'} chats={!chatTabs} serverButton={railHidden && layout !== 'narrow'} onnavigate={() => { if (layout === 'narrow') navOpen = false; }} />
      </div>
      {#if layout === 'narrow'}<button class="scrim" aria-label="Close" onclick={() => (navOpen = false)}></button>{/if}
    {/if}
    {@render chat()}
  {/if}

  {#if homeOver}
    <div class="home-over" class:after-rail={!railHidden && !inDrawer}>
      <Home top={arrangement === 'stacked'} onadd={() => (editing = { server: null })} onedit={s => (editing = { server: s })} onbrowse={() => (ui.publicServers = true)} />
    </div>
  {/if}

  {#if showPanel}
    {#if panelInline}
      <RightPanel onnavigate={() => {}} onclose={() => (ui.panelOpen = false)} />
    {:else}
      <button class="scrim" aria-label="Close" onclick={() => (ui.panelOpen = false)}></button>
      <div class="panel-drawer"><RightPanel onnavigate={closeOverlays} onclose={() => (ui.panelOpen = false)} /></div>
    {/if}
  {/if}
</div>
</div>

{#if studio.place === 'inline'}<ThemeCreator docked />{/if}
{#if editing}<ConnectDialog server={editing.server} onclose={() => (editing = null)} />{/if}
{#if ui.editServer}<ConnectDialog server={ui.editServer} onclose={() => (ui.editServer = null)} />{/if}
{#if ui.addServer}<ConnectDialog server={null} prefill={ui.addServer} onclose={() => (ui.addServer = null)} />{/if}
{#if ui.publicServers}<PublicServers onclose={() => (ui.publicServers = false)} />{/if}
{#if ui.serverInfo && session.status === 'connected'}<ServerInfoDialog onclose={() => (ui.serverInfo = false)} />{/if}
{#if ui.settingsOpen && !settingsWindow.isOpen}<SettingsDialog tab={ui.settingsTab} onpopout={t => settingsWindow.open(t)} onclose={() => { ui.settingsOpen = false; ui.settingsTab = 'voice'; }} />{/if}
{#if ui.profileEdit && session.status === 'connected'}
  <!-- A draft belongs to one server; before the prompt dialog, which opens on top of it -->
  {#key sessions.active}<ProfileDialog />{/key}
{/if}
{#if ui.quickAudio}<QuickAudio />{/if}
{#if ui.toolbarEdit}<ToolbarEditor />{/if}
{#if ui.userInfo != null && session.status === 'connected'}
  {#key ui.userInfo}<UserInfoDialog target={ui.userInfo} onclose={() => (ui.userInfo = null)} />{/key}
{/if}
{#if session.certPrompt}<CertDialog />{/if}
{#if ui.cert}<CertViewer {...ui.cert} onclose={() => (ui.cert = null)} />{/if}
{#if identities.loaded && !identities.setupDone}<IdentityWizard mode="setup" onclose={() => {}} />
{:else if ui.wizard}<IdentityWizard mode={ui.wizard} onclose={() => (ui.wizard = null)} />{/if}
{#if ui.channelDialog && session.status === 'connected'}
  {#key ui.channelDialog}<ChannelDialog {...ui.channelDialog} onclose={() => (ui.channelDialog = null)} />{/key}
{/if}
{#if ui.rolesDialog && session.status === 'connected'}
  {#key ui.rolesDialog}<RolesDialog {...ui.rolesDialog} onclose={() => (ui.rolesDialog = null)} />{/key}
{/if}
{#if share.dialog}<ShareDialog onclose={() => (share.dialog = null)} />{/if}
{#if ui.pokes.length}<PokeDialog />{/if}
{#if ui.prompt && !settingsWindow.promptHere}<PromptDialog {...ui.prompt} onclose={() => { const p = ui.prompt; ui.prompt = null; p?.oncancel?.(); }} />{/if}
<ProfileCard />
<ImageViewer />
<ContextMenu />

<style>
  /* The update bar on top, whichever interface below it */
  .frame { height: 100%; display: flex; flex-direction: column; }
  .frame > .app, .frame > :global(.shell) { flex: 1; min-height: 0; height: auto; }
  .update-bar { flex: none; display: flex; align-items: center; gap: 10px; padding: 6px 8px 6px 14px; background: var(--bg-2); border-bottom: 1px solid var(--line); box-shadow: inset 2px 0 0 var(--accent); color: var(--text); }
  .update-bar .msg { flex: 1; min-width: 0; }
  .update-bar .btn { padding-block: 5px; text-decoration: none; }
  .app { position: relative; height: 100%; display: flex; overflow: hidden; }
  .nav { display: flex; flex: none; min-height: 0; }
  .nav.drawer { position: absolute; z-index: 20; top: 0; bottom: 0; left: 0; max-width: calc(100% - 48px); border-right: 1px solid var(--line); }
  .nav.drawer :global(.sidebar) { width: min(260px, calc(100vw - var(--rail-w) - 48px)); }
  .stack { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  /* Its minimum (the shortest chat and the message box) comes from Chat.svelte; the list above gives way to it */
  .stack > :global(.chat) { flex: 1; }
  /* Its chosen height while there is room; on short windows it gives way first, down to its toolbar */
  .tree { position: relative; z-index: 1; flex: 0 1 auto; display: flex; min-height: var(--footer-h); border-bottom: 1px solid var(--line); }
  .scrim { position: absolute; inset: 0; z-index: 15; background: rgb(0 0 0 / 0.5); }
  .home-over { position: absolute; z-index: 14; inset: 0; display: flex; }
  .home-over.after-rail { left: var(--rail-w); }
  .panel-drawer { position: absolute; z-index: 20; top: 0; right: 0; bottom: 0; max-width: calc(100% - 48px); display: flex; }
</style>
