<script lang="ts">
  import ServerRail from './ui/ServerRail.svelte';
  import Sidebar from './ui/Sidebar.svelte';
  import Chat from './ui/Chat.svelte';
  import RightPanel from './ui/RightPanel.svelte';
  import ConnectDialog from './ui/ConnectDialog.svelte';
  import SettingsDialog from './ui/SettingsDialog.svelte';
  import CertDialog from './ui/CertDialog.svelte';
  import CertViewer from './ui/CertViewer.svelte';
  import PromptDialog from './ui/PromptDialog.svelte';
  import ContextMenu from './ui/ContextMenu.svelte';
  import IdentityWizard from './ui/IdentityWizard.svelte';
  import QuickAudio from './ui/QuickAudio.svelte';
  import UserInfoDialog from './ui/UserInfoDialog.svelte';
  import ChannelDialog from './ui/ChannelDialog.svelte';
  import PublicServers from './ui/PublicServers.svelte';
  import ServerInfoDialog from './ui/ServerInfoDialog.svelte';
  import ImageViewer from './ui/ImageViewer.svelte';
  import ShareDialog from './ui/ShareDialog.svelte';
  import { share } from './lib/share.svelte.ts';
  import ResizeHandle from './ui/ResizeHandle.svelte';
  import { identities } from './lib/identities.svelte.ts';
  import { session } from './lib/session.svelte.ts';
  import { ui } from './lib/ui.svelte.ts';
  import { store, type SavedServer } from './lib/settings.svelte.ts';

  let width = $state(window.innerWidth);
  // wide: rail + sidebar + chat + panel; medium: panel as an overlay; narrow: everything but chat in drawers
  const layout = $derived(width >= 1100 ? 'wide' : width >= 760 ? 'medium' : 'narrow');

  // Arrangement (Appearance setting): side is the default, classic puts the channel list right
  // of the chat, stacked above it. Narrow windows use drawers, except stacked, which works at any width.
  const arrangement = $derived(store.settings.arrangement === 'stacked' ? 'stacked' : layout === 'narrow' ? 'side' : store.settings.arrangement ?? 'side');
  // The member panel sits inline only in the side arrangement on wide windows, otherwise it overlays
  const panelInline = $derived(layout === 'wide' && arrangement === 'side');
  let treeHeight = $state(Math.max(120, Number((() => { try { return localStorage.getItem('mumh5.treeHeight'); } catch { return null; } })()) || 280));

  let navOpen = $state(false);
  let editing = $state<{ server: SavedServer | null } | null>(null);

  const showPanel = $derived(ui.panelOpen && session.status === 'connected');

  // Color scheme on the root element; dark is the stylesheet default
  $effect(() => {
    const t = store.settings.theme;
    if (t && t !== 'dark') document.documentElement.dataset.theme = t;
    else delete document.documentElement.dataset.theme;
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
    if (!img.closest('.html, .embed') || img.closest('[contenteditable], .rich, .card, .yt')) return;
    e.preventDefault();
    e.stopPropagation();
    ui.image = img.currentSrc || img.src;
  }

  const closeOverlays = () => {
    navOpen = false;
    if (!panelInline) ui.panelOpen = false;
  };
</script>

<svelte:window bind:innerWidth={width} onclickcapture={imageClick} />

{#snippet rail()}
  <ServerRail onadd={() => (editing = { server: null })} onedit={s => (editing = { server: s })} onbrowse={() => (ui.publicServers = true)}
    onsettings={() => (ui.settingsOpen = true)} />
{/snippet}
{#snippet chat()}
  <Chat showMenu={layout === 'narrow' && arrangement === 'side'} showStage={!panelInline && arrangement === 'side'} videoOnly={arrangement === 'stacked'}
    onmenu={() => (navOpen = true)} onpanel={togglePanel} />
{/snippet}

<div class="app {layout} {arrangement}">
  {#if arrangement === 'classic'}
    {@render rail()}
    {@render chat()}
    <Sidebar handleEdge="left" onnavigate={() => {}} />
  {:else if arrangement === 'stacked'}
    {@render rail()}
    <div class="stack">
      <div class="tree" style:height="{treeHeight}px">
        <Sidebar fill onnavigate={() => {}} />
        <ResizeHandle bind:width={treeHeight} edge="bottom" min={120} max={() => window.innerHeight - 220} initial={280}
          storageKey="mumh5.treeHeight" label="Resize channel list" />
      </div>
      {@render chat()}
    </div>
  {:else}
    {#if layout !== 'narrow' || navOpen}
      <div class="nav" class:drawer={layout === 'narrow'}>
        {@render rail()}
        <Sidebar resizable={layout !== 'narrow'} onnavigate={() => { if (layout === 'narrow') navOpen = false; }} />
      </div>
      {#if layout === 'narrow'}<button class="scrim" aria-label="Close" onclick={() => (navOpen = false)}></button>{/if}
    {/if}
    {@render chat()}
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

{#if editing}<ConnectDialog server={editing.server} onclose={() => (editing = null)} />{/if}
{#if ui.addServer}<ConnectDialog server={null} prefill={ui.addServer} onclose={() => (ui.addServer = null)} />{/if}
{#if ui.publicServers}<PublicServers onclose={() => (ui.publicServers = false)} />{/if}
{#if ui.serverInfo && session.status === 'connected'}<ServerInfoDialog onclose={() => (ui.serverInfo = false)} />{/if}
{#if ui.settingsOpen}<SettingsDialog tab={ui.settingsTab} onclose={() => { ui.settingsOpen = false; ui.settingsTab = 'voice'; }} />{/if}
{#if ui.quickAudio}<QuickAudio />{/if}
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
{#if share.dialog}<ShareDialog onclose={() => (share.dialog = null)} />{/if}
{#if ui.prompt}<PromptDialog {...ui.prompt} onclose={() => { const p = ui.prompt; ui.prompt = null; p?.oncancel?.(); }} />{/if}
<ImageViewer />
<ContextMenu />

<style>
  .app { position: relative; height: 100%; display: flex; overflow: hidden; }
  .nav { display: flex; flex: none; min-height: 0; }
  .nav.drawer { position: absolute; z-index: 20; top: 0; bottom: 0; left: 0; max-width: calc(100% - 48px); box-shadow: 8px 0 32px rgb(0 0 0 / 0.4); }
  .nav.drawer :global(.sidebar) { width: min(260px, calc(100vw - 68px - 48px)); }
  .stack { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .stack > :global(.chat) { flex: 1; min-height: 0; }
  .tree { position: relative; z-index: 1; flex: none; display: flex; min-height: 0; border-bottom: 1px solid var(--line); }
  .scrim { position: absolute; inset: 0; z-index: 15; background: rgb(0 0 0 / 0.5); }
  .panel-drawer { position: absolute; z-index: 20; top: 0; right: 0; bottom: 0; max-width: calc(100% - 48px); display: flex; box-shadow: -8px 0 32px rgb(0 0 0 / 0.4); }
</style>
