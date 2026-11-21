<script lang="ts">
  import Icon from './Icon.svelte';
  import { serverInitials, store } from '../lib/settings.svelte.ts';
  import { sessions } from '../lib/session.svelte.ts';
  import { menu } from '../lib/menu.svelte.ts';
  import { currentServerMenu, serverState, serverUnread } from '../lib/server-menu.ts';

  // The current server while the server list is hidden; a click brings the list back
  const server = $derived(store.servers.find(s => s.id === sessions.activeId));
  const state = $derived(server ? serverState(server.id) : 'idle');
  // The list is out of sight, so news from the other servers shows here
  const unread = $derived(store.servers.reduce((sum, s) => sum + serverUnread(s.id), 0));
</script>

<button class="server-btn" class:live={state === 'connected'} class:connecting={state === 'connecting'}
  class:voice={state === 'connected' && sessions.voiceId === server?.id}
  title={server ? `${server.label}. Show servers` : 'Show servers'} aria-label="Show servers"
  onclick={() => { store.settings.railHidden = false; store.saveSettings(); }}
  oncontextmenu={e => menu.show(e, currentServerMenu(server))}>
  {#if server?.icon}<img src={server.icon} alt="" draggable="false" />
  {:else if server}{serverInitials(server.label)}
  {:else}<Icon name="server" size={18} />{/if}
  {#if unread}<span class="unread">{unread > 99 ? '99+' : unread}</span>{/if}
</button>

<style>
  .server-btn {
    position: relative; width: 36px; height: 36px; flex: none; display: flex; align-items: center; justify-content: center;
    background: var(--bg-3); font-weight: 650; font-size: 12px; letter-spacing: 0.02em;
    transition: background 120ms var(--ease), color 120ms var(--ease);
  }
  .server-btn:hover { background: var(--accent); color: var(--accent-text); }
  img { width: 100%; height: 100%; object-fit: cover; display: block; pointer-events: none; }
  .live::after, .connecting::after {
    content: ''; position: absolute; right: -2px; bottom: -2px; width: 9px; height: 9px;
    background: var(--speaking); border: 2px solid var(--bg-0);
  }
  .connecting::after { background: var(--text-faint); }
  .voice::after { box-shadow: 0 0 0 1px var(--speaking); }
  .unread {
    position: absolute; right: -5px; top: -5px; min-width: 18px; padding: 0 3px; line-height: 14px; text-align: center;
    font-size: 10px; font-weight: 700; letter-spacing: 0; background: var(--danger); color: #fff; border: 2px solid var(--bg-0);
  }
</style>
