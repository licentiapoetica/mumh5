<script lang="ts">
  import Icon from '../ui/Icon.svelte';
  import ChatLog from '../ui/ChatLog.svelte';
  import Composer from '../ui/Composer.svelte';
  import { session } from '../lib/session.svelte.ts';
  import { menu } from '../lib/menu.svelte.ts';
  import { channelMenu, userMenu } from '../lib/actions.ts';
  import { stripMark } from '../core/text-signal.ts';

  // back: shown where the rooms are a screen of their own
  let { back, onback }: { back: boolean; onback: () => void } = $props();

  const connected = $derived(session.status === 'connected');
  const isDm = $derived(session.view.startsWith('dm:'));
  const id = $derived(Number(session.view.slice(3)));
  const isText = $derived(!isDm && session.isText(id));
  const mine = $derived(!isDm && session.self?.channelId === id);
  const title = $derived(connected ? session.viewTitle() : 'Chat');
  const topic = $derived(isDm || !connected ? '' : stripMark(session.channel(id)?.description ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
  const kind = $derived(isDm ? 'Direct message' : isText ? 'Text channel' : mine ? 'Your room' : 'Room you are not in');

  function more(e: MouseEvent) {
    if (isDm) {
      const u = session.user(id);
      if (u) menu.show(e, userMenu(u));
    } else {
      const c = session.channel(id);
      if (c) menu.show(e, channelMenu(c));
    }
  }
</script>

<section class="chat2" aria-label="Chat">
  <header>
    {#if back}<button class="icon-btn" aria-label="Back to rooms" onclick={onback}><Icon name="back" /></button>{/if}
    <div class="title">
      <h1><Icon name={isDm ? 'message' : 'hash'} size={18} />{title}</h1>
      {#if connected}<span title={topic}>{kind}{topic ? `. ${topic}` : ''}</span>{/if}
    </div>
    {#if connected}<button class="icon-btn" aria-label="More for {title}" onclick={more}><Icon name="more" /></button>{/if}
  </header>
  <ChatLog key={session.view}>
    {#snippet empty()}
      <div class="empty">
        {#if connected}
          <h2>{isDm ? title : `#${title}`}</h2>
          <p>{isDm ? 'Messages here are only visible to the two of you.'
            : isText ? 'A text channel: everyone on this server who uses mumh5 can read and write here, from any room. Other Mumble clients do not see these messages.'
            : mine ? 'Messages go to everyone in this room.'
            : 'You are not in this room. Your messages reach the people in it, but you only see theirs after joining.'}</p>
        {:else}
          <h2>No chat open</h2>
          <p>Connect to a server and choose a room.</p>
        {/if}
      </div>
    {/snippet}
  </ChatLog>
  {#if connected}<Composer target={session.view} placeholder={`Message ${isDm ? '@' : '#'}${title}`} />{/if}
</section>

<style>
  .chat2 { height: 100%; min-height: 0; min-width: 0; display: flex; flex-direction: column; background: var(--bg-2); }
  header { flex: none; min-height: 60px; display: flex; align-items: center; gap: 4px; padding: 6px 8px; border-bottom: 1px solid var(--line); }
  .title { flex: 1; min-width: 0; padding-left: 8px; }
  h1 { margin: 0; display: flex; align-items: center; gap: 6px; font-size: 17px; line-height: 1.3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  h1 :global(svg) { flex: none; color: var(--text-dim); }
  .title span { display: block; font-size: 13px; color: var(--text-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .icon-btn { flex: none; width: 40px; height: 40px; }
  .empty { padding: 32px 16px 8px; }
  .empty h2 { margin: 0 0 4px; font-size: 24px; letter-spacing: -0.01em; }
  .empty p { margin: 0; color: var(--text-dim); }
</style>
