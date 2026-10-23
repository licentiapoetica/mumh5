<script lang="ts">
  import Icon from './Icon.svelte';
  import ChatLog from './ChatLog.svelte';
  import Composer from './Composer.svelte';
  import VoiceStage from './VoiceStage.svelte';
  import ResizeHandle from './ResizeHandle.svelte';
  import { share } from '../lib/share.svelte.ts';
  import { session } from '../lib/session.svelte.ts';

  // showStage: voice tiles above the chat when the window is too narrow for the member list
  // videoOnly: streams as a plain picture without the tiles (stacked layout)
  let { onmenu, onpanel, showMenu, showStage = false, videoOnly = false }: { onmenu: () => void; onpanel: () => void; showMenu: boolean; showStage?: boolean; videoOnly?: boolean } = $props();

  // Stacked layout with a stream above the chat: the chat's height can be dragged larger than
  // its minimum; the picture gets the rest. Unset until dragged, then the picture decides.
  const LOG_MIN = 124;
  // The picture above always keeps its bar and some of the picture (see the styles below)
  const STREAM_MIN = 156;
  let chatEl = $state<HTMLElement>();
  // The message box's real height: it grows with the formatting bar and longer messages
  let composerH = $state(64);
  $effect(() => {
    // The message box only exists while connected
    void session.status;
    const box = chatEl?.querySelector<HTMLElement>('.composer');
    if (!box) return;
    const ro = new ResizeObserver(() => (composerH = box.offsetHeight));
    ro.observe(box);
    return () => ro.disconnect();
  });
  // As tall as the chat can get without squeezing the picture under its minimum
  const logMax = () => {
    const composer = chatEl?.querySelector<HTMLElement>('.composer')?.offsetHeight ?? 0;
    return Math.max(LOG_MIN, (chatEl?.clientHeight ?? window.innerHeight) - composer - STREAM_MIN);
  };
  const here = (s: { server?: { id: string } | null } | null | undefined) => !!s && s.server?.id === session.server?.id;
  // Not while the picture is in a window of its own: then only a bar is left above the chat
  const streamAbove = $derived(videoOnly && session.status === 'connected' && !share.poppedOut && ((!!share.stream && here(share.host)) || share.watches.some(w => here(w.host))));
  let logHeight = $state(Number((() => { try { return localStorage.getItem('mumh5.stackedChatHeight'); } catch { return null; } })()) || 0);
  const logFixed = $derived(streamAbove && logHeight >= LOG_MIN);

  const isDm = $derived(session.view.startsWith('dm:'));
  const isText = $derived(!isDm && session.isText(Number(session.view.slice(3))));
  const title = $derived(session.status === 'connected' ? session.viewTitle() : 'mumh5');
  const topic = $derived.by(() => {
    if (isDm || session.status !== 'connected') return '';
    return (session.channel(Number(session.view.slice(3)))?.description ?? '').replace(/<[^>]*>/g, ' ').trim();
  });
</script>

<section class="chat" class:video-only={videoOnly} class:log-fixed={logFixed} aria-label="Chat" bind:this={chatEl} style:--composer-h="{composerH}px">
  <!-- Stacked layout: no title bar; the channel list above already names the channel -->
  {#if !videoOnly}
  <header>
    {#if showMenu}<button class="icon-btn" onclick={onmenu} aria-label="Open channels"><Icon name="menu" /></button>{/if}
    <Icon name={isDm ? 'message' : 'hash'} size={20} />
    <h1>{title}</h1>
    {#if topic}<span class="topic" title={topic}>{topic}</span>{/if}
    <span class="grow"></span>
    <button class="icon-btn" onclick={onpanel} title="Members"><Icon name="users" /></button>
  </header>
  {/if}

  {#if session.status === 'connected'}<VoiceStage always={showStage} {videoOnly} />{/if}


  <div class="logbox" style:height={logFixed ? `${logHeight}px` : undefined}>
  {#if streamAbove}
    <ResizeHandle bind:width={logHeight} edge="top" min={LOG_MIN} max={logMax} initial={220}
      storageKey="mumh5.stackedChatHeight" label="Resize the chat" />
  {/if}
  <ChatLog key={session.view}>
    {#snippet empty()}
      <div class="empty">
        {#if session.status === 'connected'}
          <h2>{isDm ? `Direct messages with ${title}` : `Welcome to #${title}`}</h2>
          <p>{isDm ? 'Messages here are only visible to the two of you.' : isText ? 'A text channel: everyone on this server who uses mumh5 can read and write here, from any channel. Other Mumble clients do not see these messages.' : 'Messages go to everyone in this channel. Drop files here to share them.'}</p>
        {:else}
          <h2>Connecting...</h2>
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
  /* Stacked layout: the shortest chat plus the message box (as tall as it is now) always fit, and
     the picture's bar and minimum too when one is shown; the channel list gives way instead */
  .chat.video-only { min-height: calc(124px + var(--composer-h, 64px)); }
  .chat.video-only:has(:global(.stage.solo .spot:not(.popped))) { min-height: calc(36px + 120px + 124px + var(--composer-h, 64px)); }
  .logbox { position: relative; flex: 1; min-height: 0; display: flex; flex-direction: column; }
  /* Dragged to a height of its own: the stream above takes what is left */
  /* Its own height, but it gives way (down to its minimum) when the window gets shorter */
  .chat.log-fixed .logbox { flex: 0 1 auto; }
  .chat.log-fixed :global(.stage.solo), .chat.log-fixed :global(.stage.solo .spot), .chat.log-fixed :global(.stage.solo .pic) { flex: 1 1 0; min-height: 0; }
  /* The picture is never squeezed away: its bar and at least 120 px stay (STREAM_MIN) */
  .chat.video-only :global(.stage.solo:has(.spot:not(.popped))), .chat.video-only :global(.stage.solo .spot:not(.popped)) { min-height: 156px; }
  .chat.log-fixed :global(.stage.solo .spot video) { flex: 1 1 0; max-height: none; }
  .chat { position: relative; flex: 1; min-width: 0; display: flex; flex-direction: column; background: var(--bg-2); }
  header { height: var(--header-h); flex: none; display: flex; align-items: center; gap: 8px; padding: 0 10px 0 16px; border-bottom: 1px solid var(--line); color: var(--text-faint); }
  h1 { flex: 0 1 auto; max-width: 60%; font-size: 15px; font-weight: 650; margin: 0; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .topic { flex: 1 1 0; font-size: 13px; color: var(--text-dim); padding-left: 12px; margin-left: 4px; border-left: 1px solid var(--line); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  .grow { flex: 1; }
  .topic + .grow { flex: 0; }
  /* On phones the channel name matters more than its description */
  @media (max-width: 600px) { .topic { display: none; } h1 { max-width: none; } .topic + .grow { flex: 1; } }
  .empty { padding: 40px 20px 8px; max-width: 640px; }
  .empty h2 { margin: 0 0 6px; font-size: 24px; font-weight: 700; letter-spacing: -0.02em; }
  .empty p { margin: 0; color: var(--text-dim); }
</style>
