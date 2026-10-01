<script lang="ts">
  import Icon from './Icon.svelte';
  import Avatar from './Avatar.svelte';
  import ChannelNode from './ChannelNode.svelte';
  import { session } from '../lib/session.svelte.ts';
  import { menu } from '../lib/menu.svelte.ts';
  import { ui } from '../lib/ui.svelte.ts';
  import { channelMenu, userMenu } from '../lib/actions.ts';
  import { voice } from '../lib/audio/voice.svelte.ts';
  import { store } from '../lib/settings.svelte.ts';
  import { drag } from '../lib/drag.svelte.ts';
  import { sounds } from '../lib/audio/sounds.svelte.ts';
  import { renderIncoming } from '../lib/html.ts';
  import { share } from '../lib/share.svelte.ts';
  import { sessions } from '../lib/session.svelte.ts';
  import type { Channel } from '../core/client.ts';

  let { channel, depth = 0, onnavigate }: { channel: Channel; depth?: number; onnavigate: () => void } = $props();

  const users = $derived(session.usersIn(channel.id));
  const children = $derived(session.childrenOf(channel.id));
  const expanded = $derived(session.isExpanded(channel.id));
  const here = $derived(session.self?.channelId === channel.id);
  const selected = $derived(session.panel.kind === 'channel' && session.panel.id === channel.id);
  const unread = $derived(session.unread[`ch:${channel.id}`] ?? 0);
  const total = $derived(session.subtreeUserCount(channel.id));

  // Resting on a channel that has a description for 1 second opens a quick preview next to its row
  const hasDescription = $derived(!!(channel.description || channel.descriptionHash));
  const descriptionHtml = $derived(channel.description ? renderIncoming(channel.description, store.trustedHosts).html : '');
  let preview = $state<{ x: number; y: number } | null>(null);
  let hoverTimer: ReturnType<typeof setTimeout> | undefined;
  // Where the pointer is while it rests on the row; the preview opens there
  let pointer = { x: 0, y: 0 };
  function trackPointer(e: MouseEvent) {
    pointer = { x: e.clientX, y: e.clientY };
  }
  function hoverRow(e: MouseEvent) {
    if (!hasDescription) return;
    trackPointer(e);
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => {
      // Long descriptions are only announced by hash; the text is fetched now
      session.loadDescription(channel.id);
      // Just below and right of the pointer, kept inside the window
      preview = { x: Math.max(8, Math.min(pointer.x + 12, window.innerWidth - 348)), y: Math.max(8, Math.min(pointer.y + 12, window.innerHeight - 340)) };
    }, 1000);
  }
  // Short grace period, so the pointer can move from the row into the preview
  function leaveRow() {
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => (preview = null), 250);
  }
  function showDescription() {
    clearTimeout(hoverTimer);
    preview = null;
    session.showChannel(channel.id, 'info');
    ui.panelOpen = true;
  }

  // Single click previews, double click acts. The single action waits briefly so a
  // double click does not also flash the preview.
  let timer: ReturnType<typeof setTimeout> | undefined;
  function clickOrDouble(single: () => void, double: () => void) {
    return {
      onclick: () => { clearTimeout(timer); timer = setTimeout(single, 220); },
      ondblclick: () => { clearTimeout(timer); double(); }
    };
  }

  // Drop a person to move them here, or a channel to make it a subchannel of this one
  let over = $state(false);
  const canDrop = $derived.by(() => {
    const d = drag.item;
    if (!d) return false;
    if (d.kind === 'user') return session.user(d.id)?.channelId !== channel.id;
    return d.id !== channel.id && channel.id !== session.channel(d.id)?.parent && !session.isInside(channel.id, d.id);
  });

  function onDrop(e: DragEvent) {
    e.preventDefault();
    over = false;
    // Check before clearing: canDrop is derived from the dragged item
    const d = drag.item;
    const ok = canDrop;
    drag.item = null;
    if (!d || !ok) return;
    if (d.kind === 'user') {
      if (d.id === session.self?.session) session.joinChannel(channel.id);
      else session.moveUser(d.id, channel.id);
    } else {
      session.client?.updateChannel(d.id, { parent: channel.id });
      sounds.play('channelMoved');
    }
  }

  const channelClicks = clickOrDouble(
    () => { session.showChannel(channel.id); ui.panelOpen = true; },
    () => { session.joinChannel(channel.id); onnavigate(); }
  );
</script>

<li>
  <div class="row channel" class:here class:selected class:over style:padding-left="{8 + depth * 14}px"
    oncontextmenu={e => menu.show(e, channelMenu(channel))} role="presentation"
    ondragover={e => { if (canDrop) { e.preventDefault(); over = true; } }}
    ondragleave={() => (over = false)}
    ondrop={onDrop}
    onmouseenter={hoverRow} onmousemove={trackPointer} onmouseleave={leaveRow}>
    {#if children.length || users.length}
      <button class="caret" class:collapsed={!expanded} onclick={() => session.toggleExpanded(channel.id)}
        aria-label={expanded ? 'Collapse' : 'Expand'} aria-expanded={expanded}>
        <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 3l3 4 3-4" fill="none" stroke="currentColor" stroke-width="1.6" /></svg>
      </button>
    {:else}
      <span class="caret"></span>
    {/if}
    <!-- The name is what people grab; a drag cannot start from a button inside a draggable element -->
    <button class="name" title="Click for details, double-click to join" {...channelClicks}
      draggable={channel.id !== 0}
      ondragstart={e => { clearTimeout(hoverTimer); preview = null; drag.item = { kind: 'channel', id: channel.id }; e.dataTransfer?.setData('text/plain', channel.name); }}
      ondragend={() => { drag.item = null; over = false; }}>
      {#if !channel.canEnter}<Icon name="lock" size={14} />{/if}
      <span class="label">{channel.name || 'Root'}</span>
      {#if !expanded && total > 0}<span class="count" title="{total} {total === 1 ? 'person' : 'people'} inside">{total}</span>{/if}
      {#if unread}<span class="badge">{unread}</span>{/if}
    </button>
    {#if hasDescription}
      <button class="desc" title="Show description" aria-label="Show description of {channel.name || 'Root'}"
        onclick={showDescription}><span></span></button>
    {/if}
  </div>
  {#if preview}
    <div class="desc-pop" role="tooltip" style:left="{preview.x}px" style:top="{preview.y}px"
      onmouseenter={() => clearTimeout(hoverTimer)} onmouseleave={leaveRow}>
      <strong>{channel.name || 'Root'}</strong>
      {#if descriptionHtml}<div class="html">{@html descriptionHtml}</div>{:else}<p>Loading description...</p>{/if}
    </div>
  {/if}

  {#if users.length && expanded}
    <ul class="users">
      {#each users as u (u.session)}
        {@const isSelf = u.session === session.self?.session}
        {@const clicks = clickOrDouble(
          () => { session.showUser(u.session); ui.panelOpen = true; },
          () => { if (!isSelf) { session.selectView(`dm:${u.session}`); onnavigate(); } }
        )}
        <li>
          <button class="row user" class:self={isSelf} style:padding-left="{30 + depth * 14}px"
            draggable="true"
            ondragstart={e => { drag.item = { kind: 'user', id: u.session }; e.dataTransfer?.setData('text/plain', u.name); }}
            ondragend={() => (drag.item = null)}
            title={isSelf ? 'You' : `${store.displayName(u)} (double-click to message)`} {...clicks}
            oncontextmenu={e => menu.show(e, userMenu(u))}>
            <Avatar name={u.name} size={22} speaking={voice.talking[u.session] || (isSelf && voice.transmitting)} />
            <span class="label" class:talking={voice.talking[u.session] || (isSelf && voice.transmitting)}>{store.displayName(u)}</span>
            {#if u.userId != null}<span class="reg" title="Registered">R</span>{/if}
            {#if session.sharing[u.session]}
              {#if isSelf}
                <span class="state sharing" title="You are sharing your screen"><Icon name="screen" size={14} /></span>
              {:else}
                <!-- A button cannot sit inside the row's button -->
                <span class="state sharing" role="button" tabindex="0" title="Sharing their screen. Click to watch" aria-label="Watch the screen of {store.displayName(u)}"
                  onclick={e => { e.stopPropagation(); clearTimeout(timer); share.watch(sessions.active, u.session); }}
                  ondblclick={e => e.stopPropagation()}
                  onkeydown={e => { if (e.key === 'Enter') { e.stopPropagation(); share.watch(sessions.active, u.session); } }}><Icon name="screen" size={14} /></span>
              {/if}
            {/if}
            {#if u.comment || u.commentHash}<span class="state" title="Has a description"><Icon name="message" size={12} /></span>{/if}
            {#if u.prioritySpeaker}<span class="state" title="Priority speaker"><Icon name="channel" size={14} /></span>{/if}
            {#if u.recording}<span class="rec" title="Recording">REC</span>{/if}
            {#if u.deaf || u.selfDeaf}
              <span class="state" class:admin={u.deaf} title={u.deaf ? 'Deafened by server' : 'Deafened'}><Icon name="headphones-off" size={14} /></span>
            {:else if u.mute || u.selfMute || u.suppress}
              <span class="state" class:admin={u.mute || u.suppress} title={u.mute ? 'Muted by server' : u.suppress ? 'Suppressed' : 'Muted'}><Icon name="mic-off" size={14} /></span>
            {/if}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
  {#if children.length && expanded}
    <ul>
      {#each children as c (c.id)}
        <ChannelNode channel={c} depth={depth + 1} {onnavigate} />
      {/each}
    </ul>
  {/if}
</li>

<style>
  ul { list-style: none; margin: 0; padding: 0; }
  li { margin: 0; }
  .row { display: flex; align-items: center; gap: 4px; width: 100%; min-height: 30px; padding-right: 8px; color: var(--text-dim); }
  .channel:hover, .user:hover { background: var(--bg-hover); color: var(--text); }
  .channel.selected { background: var(--bg-active); color: var(--text); }
  .channel.over { background: var(--accent); color: var(--accent-text); }
  .channel.over .label { color: var(--accent-text); }
  .channel.here .label { color: var(--text); font-weight: 600; }
  .channel.here { box-shadow: inset 3px 0 0 var(--speaking); }
  .caret { width: 14px; flex: none; display: inline-flex; justify-content: center; color: var(--text-faint); }
  .caret.collapsed svg { transform: rotate(-90deg); }
  .name { flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px; padding: 4px 0; text-align: left; color: inherit; user-select: none; }
  .label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .desc { flex: none; width: 20px; height: 20px; display: inline-flex; align-items: center; justify-content: center; }
  .desc span { width: 9px; height: 9px; background: var(--warn); }
  .desc:hover span { outline: 2px solid var(--warn); outline-offset: 1px; }
  .desc-pop { position: fixed; z-index: 40; width: 340px; max-width: calc(100vw - 16px); max-height: 320px; overflow: auto; padding: 10px 12px;
    background: var(--bg-2); border: 1px solid var(--line); color: var(--text); font-size: 14px; box-shadow: 0 8px 32px rgb(0 0 0 / 0.4); }
  .desc-pop strong { display: block; margin-bottom: 6px; }
  .desc-pop p { margin: 0; color: var(--text-dim); }
  .desc-pop .html { overflow-wrap: anywhere; user-select: text; }
  .desc-pop .html :global(img) { max-width: 100%; }
  .count { font-size: 11px; color: var(--text-faint); border: 1px solid var(--line); padding: 0 5px; line-height: 16px; }
  .badge { background: var(--danger); color: #fff; font-size: 11px; font-weight: 700; padding: 0 5px; line-height: 16px; }
  .user { gap: 8px; text-align: left; font-size: 14px; user-select: none; }
  .user.self .label { color: var(--text); }
  .label.talking { color: var(--speaking); }
  .reg { font-size: 10px; font-weight: 700; color: var(--accent-hover); border: 1px solid var(--accent); padding: 0 3px; line-height: 14px; }
  .state { color: var(--text-faint); display: inline-flex; }
  .state.admin { color: var(--danger); }
  .state.sharing { color: var(--speaking); padding: 3px; }
  .state.sharing[role=button]:hover { background: var(--bg-active); }
  .rec { font-size: 10px; font-weight: 700; color: var(--danger); border: 1px solid var(--danger); padding: 0 3px; }
</style>
