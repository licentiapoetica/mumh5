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
  import { identities } from './lib/identities.svelte.ts';
  import { session } from './lib/session.svelte.ts';
  import { ui } from './lib/ui.svelte.ts';
  import { store, type SavedServer } from './lib/settings.svelte.ts';

  let width = $state(window.innerWidth);
  // wide: rail + sidebar + chat + panel; medium: panel as an overlay; narrow: everything but chat in drawers
  const layout = $derived(width >= 1100 ? 'wide' : width >= 760 ? 'medium' : 'narrow');

  let navOpen = $state(false);
  let editing = $state<{ server: SavedServer | null } | null>(null);

  const showPanel = $derived(ui.panelOpen && session.status === 'connected');

  // Color scheme on the root element; dark is the stylesheet default
  $effect(() => {
    const t = store.settings.theme;
    if (t && t !== 'dark') document.documentElement.dataset.theme = t;
    else delete document.documentElement.dataset.theme;
  });

  // The panel starts open on wide layouts only
  let lastLayout = '';
  $effect(() => {
    if (layout === lastLayout) return;
    ui.panelOpen = layout === 'wide';
    lastLayout = layout;
  });
  // On phones one drawer at a time
  $effect(() => { if (layout === 'narrow' && ui.panelOpen) navOpen = false; });

  function togglePanel() {
    if (!ui.panelOpen) ui.panelOpen = true;
    else if (session.panel.kind !== 'members') session.closePanel();
    else ui.panelOpen = false;
  }

  const closeOverlays = () => {
    navOpen = false;
    if (layout !== 'wide') ui.panelOpen = false;
  };
</script>

<svelte:window bind:innerWidth={width} />

<div class="app {layout}">
  {#if layout !== 'narrow' || navOpen}
    <div class="nav" class:drawer={layout === 'narrow'}>
      <ServerRail onadd={() => (editing = { server: null })} onedit={s => (editing = { server: s })} onbrowse={() => (ui.publicServers = true)}
        onsettings={() => (ui.settingsOpen = true)} />
      <Sidebar resizable={layout !== 'narrow'} onnavigate={() => { if (layout === 'narrow') navOpen = false; }} />
    </div>
    {#if layout === 'narrow'}<button class="scrim" aria-label="Close" onclick={() => (navOpen = false)}></button>{/if}
  {/if}

  <Chat showMenu={layout === 'narrow'} showStage={layout !== 'wide'} onmenu={() => (navOpen = true)} onpanel={togglePanel} />

  {#if showPanel}
    {#if layout === 'wide'}
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
{#if ui.prompt}<PromptDialog {...ui.prompt} onclose={() => (ui.prompt = null)} />{/if}
<ContextMenu />

<style>
  .app { position: relative; height: 100%; display: flex; overflow: hidden; }
  .nav { display: flex; flex: none; min-height: 0; }
  .nav.drawer { position: absolute; z-index: 20; top: 0; bottom: 0; left: 0; max-width: calc(100% - 48px); box-shadow: 8px 0 32px rgb(0 0 0 / 0.4); }
  .nav.drawer :global(.sidebar) { width: min(260px, calc(100vw - 68px - 48px)); }
  .scrim { position: absolute; inset: 0; z-index: 15; background: rgb(0 0 0 / 0.5); }
  .panel-drawer { position: absolute; z-index: 20; top: 0; right: 0; bottom: 0; max-width: calc(100% - 48px); display: flex; box-shadow: -8px 0 32px rgb(0 0 0 / 0.4); }
</style>
