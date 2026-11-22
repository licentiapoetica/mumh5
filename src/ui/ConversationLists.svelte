<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';

  let { children, messages, count, unread = 0, enabled = true }: {
    children: Snippet; messages: Snippet; count: number; unread?: number; enabled?: boolean;
  } = $props();
  let collapsed = $state(false);
  let messagesCollapsed = $state(false);
</script>

<div class="conversation-lists" class:collapsed={enabled && collapsed}>
  {#if enabled}
    <button class="heading" aria-expanded={!collapsed} onclick={() => (collapsed = !collapsed)}>
      <Icon name={collapsed ? 'arrow-right' : 'arrow-down'} size={14} />
      <span>Channels and chats</span>
      {#if collapsed && unread}<span class="badge">{unread}</span>{/if}
    </button>
  {/if}
  <div class="lists" hidden={enabled && collapsed}>
    {@render children()}
    {#if enabled}
      <section class="private-chats" aria-label="Direct messages">
        <button class="heading" aria-expanded={!messagesCollapsed} onclick={() => (messagesCollapsed = !messagesCollapsed)}>
          <Icon name={messagesCollapsed ? 'arrow-right' : 'arrow-down'} size={14} />
          <span>Direct messages</span><span class="count">{count}</span>
          {#if unread}<span class="badge">{unread}</span>{/if}
        </button>
        <div class="private-scroll" hidden={messagesCollapsed}>
          {#if count}{@render messages()}{:else}<p>No private chats yet.</p>{/if}
        </div>
      </section>
    {/if}
  </div>
</div>

<style>
  .conversation-lists { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
  .conversation-lists.collapsed { flex: none; }
  .lists { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  [hidden] { display: none; }
  .private-chats { flex: 0 1 auto; min-height: 32px; max-height: 50%; display: flex; flex-direction: column; border-top: 1px solid var(--line); }
  .heading { flex: none; width: 100%; min-height: 32px; display: flex; align-items: center; gap: 6px; padding: 6px 12px; text-align: left; color: var(--text-dim); font-size: 11px; font-weight: 650; text-transform: uppercase; letter-spacing: 0.07em; }
  .heading:hover { background: var(--bg-hover); color: var(--text); }
  .heading > span:first-of-type { flex: 1; }
  .count { color: var(--text-faint); }
  .badge { min-width: 18px; padding: 0 5px; line-height: 18px; text-align: center; background: var(--danger); color: #fff; letter-spacing: 0; }
  .private-scroll { min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 0 8px 8px; }
  p { margin: 4px 8px; color: var(--text-faint); font-size: 12px; }
</style>
