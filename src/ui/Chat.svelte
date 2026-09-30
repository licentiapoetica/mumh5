<script lang="ts">
  import Icon from './Icon.svelte';
  import ChatLog from './ChatLog.svelte';
  import Composer from './Composer.svelte';
  import VoiceStage from './VoiceStage.svelte';
  import { session } from '../lib/session.svelte.ts';

  // showStage: voice tiles above the chat when the window is too narrow for the member list
  let { onmenu, onpanel, showMenu, showStage = false }: { onmenu: () => void; onpanel: () => void; showMenu: boolean; showStage?: boolean } = $props();

  const isDm = $derived(session.view.startsWith('dm:'));
  const title = $derived(session.status === 'connected' ? session.viewTitle() : 'mumh5');
  const topic = $derived.by(() => {
    if (isDm || session.status !== 'connected') return '';
    return (session.channel(Number(session.view.slice(3)))?.description ?? '').replace(/<[^>]*>/g, ' ').trim();
  });
</script>

<section class="chat" aria-label="Chat">
  <header>
    {#if showMenu}<button class="icon-btn" onclick={onmenu} aria-label="Open channels"><Icon name="menu" /></button>{/if}
    <Icon name={isDm ? 'message' : 'hash'} size={20} />
    <h1>{title}</h1>
    {#if topic}<span class="topic" title={topic}>{topic}</span>{/if}
    <span class="grow"></span>
    <button class="icon-btn" onclick={onpanel} title="Members"><Icon name="users" /></button>
  </header>

  {#if showStage && session.status === 'connected'}<VoiceStage />{/if}

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
          <p>Choose a server to get started.</p>
        {/if}
      </div>
    {/snippet}
  </ChatLog>

  <Composer target={session.view} placeholder={session.status === 'connected' ? `Message ${isDm ? '@' : '#'}${title}` : 'Not connected'} />
</section>

<style>
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
</style>
