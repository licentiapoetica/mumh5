<script lang="ts">
  import Icon from './Icon.svelte';
  import ChatLog from './ChatLog.svelte';
  import Composer from './Composer.svelte';
  import VoiceStage from './VoiceStage.svelte';
  import ResizeHandle from './ResizeHandle.svelte';
  import { share } from '../lib/share.svelte.ts';
  import { ui } from '../lib/ui.svelte.ts';
  import { session } from '../lib/session.svelte.ts';

  // showStage: voice tiles above the chat when the window is too narrow for the member list
  // videoOnly: streams as a plain picture without the tiles (stacked layout)
  let { onmenu, onpanel, showMenu, showStage = false, videoOnly = false }: { onmenu: () => void; onpanel: () => void; showMenu: boolean; showStage?: boolean; videoOnly?: boolean } = $props();

  // Stacked layout with a stream above the chat: the chat's height can be dragged larger than
  // its minimum; the picture gets the rest. Unset until dragged, then the picture decides.
  const LOG_MIN = 124;
  const here = (s: { server?: { id: string } | null } | null | undefined) => !!s && s.server?.id === session.server?.id;
  const streamAbove = $derived(videoOnly && session.status === 'connected' && ((!!share.stream && here(share.host)) || (!!share.watching && here(share.watching.host))));
  let logHeight = $state(Number((() => { try { return localStorage.getItem('mumh5.stackedChatHeight'); } catch { return null; } })()) || 0);
  const logFixed = $derived(streamAbove && logHeight >= LOG_MIN);

  const isDm = $derived(session.view.startsWith('dm:'));
  const title = $derived(session.status === 'connected' ? session.viewTitle() : 'mumh5');
  const topic = $derived.by(() => {
    if (isDm || session.status !== 'connected') return '';
    return (session.channel(Number(session.view.slice(3)))?.description ?? '').replace(/<[^>]*>/g, ' ').trim();
  });
</script>

<section class="chat" class:video-only={videoOnly} class:log-fixed={logFixed} aria-label="Chat">
  <header>
    {#if showMenu}<button class="icon-btn" onclick={onmenu} aria-label="Open channels"><Icon name="menu" /></button>{/if}
    <Icon name={isDm ? 'message' : 'hash'} size={20} />
    <h1>{title}</h1>
    {#if topic}<span class="topic" title={topic}>{topic}</span>{/if}
    <span class="grow"></span>
    <button class="icon-btn" onclick={onpanel} title="Members"><Icon name="users" /></button>
  </header>

  {#if session.status === 'connected'}<VoiceStage always={showStage} {videoOnly} />{/if}

  {#if session.status === 'idle' && session.disconnectInfo}
    {@const d = session.disconnectInfo}
    <div class="ended" class:bad={d.kind === 'kicked' || d.kind === 'banned'}>
      <h2>
        {#if d.kind === 'kicked'}You were kicked{d.by ? ` by ${d.by}` : ''}
        {:else if d.kind === 'banned'}You were banned{d.by ? ` by ${d.by}` : ''}
        {:else if d.kind === 'rejected'}The server refused the connection
        {:else}Connection lost{/if}
      </h2>
      {#if d.reason}<p class="reason">{d.reason}</p>{/if}
      <p class="where">{session.server?.label}</p>
      <div class="row">
        <button class="btn primary" onclick={() => session.reconnect()}>Reconnect</button>
      </div>
    </div>
  {/if}


  <div class="logbox" style:height={logFixed ? `${logHeight}px` : undefined}>
  {#if streamAbove}
    <ResizeHandle bind:width={logHeight} edge="top" min={LOG_MIN} max={() => Math.max(LOG_MIN, window.innerHeight - 320)} initial={220}
      storageKey="mumh5.stackedChatHeight" label="Resize the chat" />
  {/if}
  <ChatLog key={session.view}>
    {#snippet empty()}
      <div class="empty">
        {#if session.status === 'connected'}
          <h2>{isDm ? `Direct messages with ${title}` : `Welcome to #${title}`}</h2>
          <p>{isDm ? 'Messages here are only visible to the two of you.' : 'Messages go to everyone in this channel. Drop files here to share them.'}</p>
        {:else if session.status === 'connecting'}
          <h2>Connecting...</h2>
        {:else}
          <h2>mumh5</h2>
          <p>Choose a server to get started, or find one:</p>
          <div class="welcome-actions">
            <button class="btn" onclick={() => (ui.publicServers = true)}>Browse public servers</button>
            <button class="btn" onclick={() => { ui.settingsTab = 'identities'; ui.settingsOpen = true; }}>Manage identities</button>
          </div>
        {/if}
      </div>
    {/snippet}
  </ChatLog>
  </div>

  {#if session.status === 'connected'}
    <Composer target={session.view} placeholder={`Message ${isDm ? '@' : '#'}${title}`} />
  {/if}
</section>

<style>
  /* Stacked layout: room for about five lines of chat whatever the stream above takes */
  .chat.video-only .logbox { min-height: 124px; flex-shrink: 0; }
  .logbox { position: relative; flex: 1; min-height: 0; display: flex; flex-direction: column; }
  /* Dragged to a height of its own: the stream above takes what is left */
  .chat.log-fixed .logbox { flex: none; }
  .chat.log-fixed :global(.stage.solo), .chat.log-fixed :global(.stage.solo .spot), .chat.log-fixed :global(.stage.solo .pic) { flex: 1 1 0; min-height: 0; }
  .chat.log-fixed :global(.stage.solo .spot video) { flex: 1 1 0; max-height: none; }
  .chat { position: relative; flex: 1; min-width: 0; display: flex; flex-direction: column; background: var(--bg-2); }
  header { height: 52px; flex: none; display: flex; align-items: center; gap: 8px; padding: 0 8px 0 16px; border-bottom: 1px solid var(--line); color: var(--text-dim); }
  h1 { flex: 0 1 auto; max-width: 60%; font-size: 16px; margin: 0; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .topic { flex: 1 1 0; font-size: 13px; padding-left: 10px; margin-left: 4px; border-left: 1px solid var(--line); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  .grow { flex: 1; }
  .topic + .grow { flex: 0; }
  /* On phones the channel name matters more than its description */
  @media (max-width: 600px) { .topic { display: none; } h1 { max-width: none; } .topic + .grow { flex: 1; } }
  .empty { padding: 32px 16px 8px; }
  .empty h2 { margin: 0 0 4px; font-size: 24px; }
  .empty p { margin: 0; color: var(--text-dim); }
  .welcome-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
  .ended { max-width: 460px; margin: 16px 16px 0; padding: 16px 18px; background: var(--bg-1); border: 1px solid var(--line); border-left: 4px solid var(--warn); }
  .ended.bad { border-left-color: var(--danger); }
  .ended h2 { margin: 0; font-size: 20px; }
  .ended .reason { margin: 8px 0 0; color: var(--text); font-size: 15px; overflow-wrap: anywhere; }
  .ended .where { margin-top: 4px; font-size: 13px; color: var(--text-faint); }
  .ended .row { margin-top: 14px; }
</style>
