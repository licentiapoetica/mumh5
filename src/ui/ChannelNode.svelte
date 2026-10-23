<script lang="ts">
  import Icon from './Icon.svelte';
  import Avatar from './Avatar.svelte';
  import ChannelNode from './ChannelNode.svelte';
  import { session } from '../lib/session.svelte.ts';
  import { menu } from '../lib/menu.svelte.ts';
  import { ui } from '../lib/ui.svelte.ts';
  import { channelMenu, userMenu, openProfile } from '../lib/actions.ts';
  import { voice } from '../lib/audio/voice.svelte.ts';
  import { store } from '../lib/settings.svelte.ts';
  import { drag } from '../lib/drag.svelte.ts';
  import { sounds } from '../lib/audio/sounds.svelte.ts';
  import { renderIncoming } from '../lib/html.ts';
  import { share } from '../lib/share.svelte.ts';
  import { sessions } from '../lib/session.svelte.ts';
  import type { Channel } from '../core/client.ts';
  import { stripMark } from '../core/text-signal.ts';
  import { planMove } from '../core/channel-order.ts';

  let { channel, depth = 0, onnavigate }: { channel: Channel; depth?: number; onnavigate: () => void } = $props();

  const users = $derived(session.usersIn(channel.id));
  const children = $derived(session.childrenOf(channel.id));
  const expanded = $derived(session.isExpanded(channel.id));
  const here = $derived(session.self?.channelId === channel.id);
  // Read and written without joining: a click opens its chat
  const isText = $derived(session.isText(channel.id));
  const selected = $derived(isText ? session.view === `ch:${channel.id}` : session.selectedChannel === channel.id || (session.panel.kind === 'channel' && session.panel.id === channel.id && ui.panelOpen));
  const unread = $derived(session.unread[`ch:${channel.id}`] ?? 0);
  const total = $derived(session.subtreeUserCount(channel.id));

  // Resting on a channel that has a description for 1 second opens a quick preview next to its row
  const hasDescription = $derived(!!(stripMark(channel.description) || (!channel.description && channel.descriptionHash)));
  const descriptionHtml = $derived(channel.description ? renderIncoming(channel.description, store.trustedHosts).html : '');
  let preview = $state<{ x: number; y: number } | null>(null);
  let hoverTimer: ReturnType<typeof setTimeout> | undefined;
  // Opened on purpose (the marker or the menu): stays until a click elsewhere or Escape
  let pinned = $state(false);
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
      // Not while something is dragged, and not when the row moved away in the meantime
      if (drag.item || !rowEl?.matches(':hover')) return;
      // Long descriptions are only announced by hash; the text is fetched now
      session.loadDescription(channel.id);
      pinned = false;
      // Just below and right of the pointer, kept inside the window
      preview = { x: Math.max(8, Math.min(pointer.x + 12, window.innerWidth - 348)), y: Math.max(8, Math.min(pointer.y + 12, window.innerHeight - 340)) };
    }, 1000);
  }
  // Short grace period, so the pointer can move from the row into the preview
  function leaveRow() {
    clearTimeout(hoverTimer);
    if (pinned) return;
    // An image opened from the preview covers it; the preview stays underneath
    hoverTimer = setTimeout(() => { if (!ui.image) preview = null; }, 250);
  }
  // A row that moves away under the pointer (after a drop) never reports the pointer leaving,
  // so an open preview also watches where the pointer is
  let rowEl = $state<HTMLElement>();
  $effect(() => {
    if (!preview || pinned) return;
    let away: ReturnType<typeof setTimeout> | undefined;
    const inside = () => !!rowEl?.matches(':hover') || !!popEl?.matches(':hover') || !!ui.image;
    const check = () => {
      if (inside()) { clearTimeout(away); away = undefined; }
      else away ??= setTimeout(() => { away = undefined; if (!inside()) preview = null; }, 300);
    };
    window.addEventListener('mousemove', check);
    return () => { window.removeEventListener('mousemove', check); clearTimeout(away); };
  });
  // Back from the image: the preview stays while the pointer is on it, and goes when it is not
  let popEl = $state<HTMLElement>();
  let hadImage = false;
  $effect(() => {
    const open = !!ui.image;
    if (hadImage && !open && preview && !pinned && !popEl?.matches(':hover')) {
      clearTimeout(hoverTimer);
      hoverTimer = setTimeout(() => { if (!popEl?.matches(':hover')) preview = null; }, 1500);
    }
    hadImage = open;
  });
  // The description at once, where the marker was clicked (or the menu opened)
  function showDescriptionAt(x: number, y: number) {
    clearTimeout(hoverTimer);
    session.loadDescription(channel.id);
    preview = { x: Math.max(8, Math.min(x + 12, window.innerWidth - 348)), y: Math.max(8, Math.min(y + 12, window.innerHeight - 340)) };
    pinned = true;
  }
  $effect(() => {
    if (!preview || !pinned) return;
    const close = () => { preview = null; pinned = false; };
    const down = (e: MouseEvent) => { if (!popEl?.contains(e.target as Node) && !ui.image) close(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && !ui.image) close(); };
    // The click that opened it is over by now, so it does not close it again
    window.addEventListener('mousedown', down, true);
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('mousedown', down, true); window.removeEventListener('keydown', key); };
  });
  $effect(() => {
    const req = ui.channelPreview;
    if (!req || req.id !== channel.id) return;
    ui.channelPreview = null;
    showDescriptionAt(req.x, req.y);
  });

  // Single click previews, double click acts. The single action waits briefly so a
  // double click does not also flash the preview.
  let timer: ReturnType<typeof setTimeout> | undefined;
  function clickOrDouble(single: (el: HTMLElement) => void, double: () => void) {
    return {
      onclick: (e: MouseEvent) => { const el = e.currentTarget as HTMLElement; clearTimeout(timer); timer = setTimeout(() => single(el), 220); },
      ondblclick: () => { clearTimeout(timer); double(); }
    };
  }

  // Drop a person to move them here. A channel dropped on the middle of a row becomes a
  // subchannel; dropped on the upper or lower third it goes in front of or behind this one.
  type Zone = 'before' | 'after' | 'into';
  let zone = $state<Zone | null>(null);
  const dragging = $derived(drag.item?.kind === 'channel' && drag.item.id === channel.id);
  const open = $derived(expanded && (children.length > 0 || users.length > 0));

  function intoAllowed(): boolean {
    const d = drag.item;
    if (!d) return false;
    if (d.kind === 'user') return session.user(d.id)?.channelId !== channel.id;
    return d.id !== channel.id && channel.id !== session.channel(d.id)?.parent && !session.isInside(channel.id, d.id);
  }

  function zoneAt(e: DragEvent, row: HTMLElement): Zone | null {
    const d = drag.item;
    if (!d) return null;
    const into = intoAllowed();
    if (d.kind === 'user' || channel.id === 0) return into ? 'into' : null;
    if (d.id === channel.id || session.isInside(channel.id, d.id)) return null;
    const box = row.getBoundingClientRect();
    const y = (e.clientY - box.top) / box.height;
    if (y < 0.34) return 'before';
    if (y > 0.66) return 'after';
    if (into) return 'into';
    return y < 0.5 ? 'before' : 'after';
  }

  // Resting on a closed channel opens it, to reach the channels inside
  let openTimer: ReturnType<typeof setTimeout> | undefined;
  function setZone(z: Zone | null) {
    if (z === zone) return;
    zone = z;
    clearTimeout(openTimer);
    if (z === 'into' && !expanded && children.length) openTimer = setTimeout(() => { if (zone === 'into' && !expanded) session.toggleExpanded(channel.id); }, 700);
  }

  function onDragOver(e: DragEvent, fixed?: Zone) {
    const z = fixed ? (intoAllowed() ? fixed : null) : zoneAt(e, e.currentTarget as HTMLElement);
    if (z) e.preventDefault();
    setZone(z);
  }

  // Leaving for an element inside the same target is not leaving
  function onDragLeave(e: DragEvent) {
    if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) setZone(null);
  }

  function onDrop(e: DragEvent, fixed?: Zone) {
    e.preventDefault();
    // Work out the target before clearing: it depends on the dragged item
    const d = drag.item;
    const z = fixed ? (intoAllowed() ? fixed : null) : zoneAt(e, e.currentTarget as HTMLElement);
    setZone(null);
    drag.item = null;
    const client = session.client;
    if (!d || !z || !client) return;
    if (d.kind === 'user') {
      if (d.id === session.self?.session) session.joinChannel(channel.id);
      else session.moveUser(d.id, channel.id);
      return;
    }
    if (z === 'into') {
      client.updateChannel(d.id, { parent: channel.id });
    } else {
      const moved = session.channel(d.id);
      if (!moved || channel.parent == null) return;
      const rest = session.childrenOf(channel.parent).filter(c => c.id !== d.id);
      const plan = planMove(rest, moved, rest.findIndex(c => c.id === channel.id) + (z === 'after' ? 1 : 0));
      const own = plan.find(u => u.id === d.id);
      const reparent = moved.parent !== channel.parent;
      if (!reparent && !plan.length) return;
      if (reparent || own) client.updateChannel(d.id, { ...(reparent ? { parent: channel.parent } : {}), ...(own ? { position: own.position } : {}) });
      for (const u of plan) if (u.id !== d.id) client.updateChannel(u.id, { position: u.position });
    }
    sounds.play('channelMoved');
  }

  const openText = () => { session.selectView(`ch:${channel.id}`); onnavigate(); };
  const channelClicks = $derived(isText ? { onclick: openText } : clickOrDouble(
    () => { session.selectedChannel = channel.id; },
    () => { session.joinChannel(channel.id); onnavigate(); }
  ));
</script>

<!-- Behind an open channel is below its people and subchannels; the line is drawn there -->
<li class:after-end={zone === 'after' && open} style:--indent="{8 + depth * 14}px">
  <div class="row channel" class:here class:selected class:dragging class:into={zone === 'into'} class:before={zone === 'before'} class:after={zone === 'after' && !open} class:target={zone === 'after' && open}
    style:padding-left="{8 + depth * 14}px"
    oncontextmenu={e => menu.show(e, channelMenu(channel))} role="presentation"
    ondragover={onDragOver}
    ondragleave={onDragLeave}
    ondrop={onDrop} bind:this={rowEl}
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
    <button class="name" class:text={isText} title={isText ? 'Text channel: click to open' : 'Double-click to join'} {...channelClicks}
      draggable={channel.id !== 0}
      ondragstart={e => { clearTimeout(hoverTimer); preview = null; drag.item = { kind: 'channel', id: channel.id }; e.dataTransfer?.setData('text/plain', channel.name); }}
      ondragend={() => { drag.item = null; setZone(null); }}>
      {#if isText}<Icon name="hash" size={14} />{:else if !channel.canEnter}<Icon name="lock" size={14} />{/if}
      <span class="label">{channel.name || 'Root'}</span>
      {#if !expanded && total > 0}<span class="count" title="{total} {total === 1 ? 'person' : 'people'} inside">{total}</span>{/if}
      {#if unread}<span class="badge">{unread}</span>{/if}
    </button>
    {#if hasDescription}
      <button class="desc" title="Show description" aria-label="Show description of {channel.name || 'Root'}"
        onclick={e => showDescriptionAt(e.clientX, e.clientY)}><span></span></button>
    {/if}
  </div>
  {#if preview}
    <div class="desc-pop" role="tooltip" bind:this={popEl} style:left="{preview.x}px" style:top="{preview.y}px"
      onmouseenter={() => clearTimeout(hoverTimer)} onmouseleave={leaveRow}>
      <strong>{channel.name || 'Root'}</strong>
      {#if descriptionHtml}<div class="html">{@html descriptionHtml}</div>{:else}<p>Loading description...</p>{/if}
    </div>
  {/if}

  {#if users.length && expanded}
    <!-- The people under a channel belong to its drop target, so there is more to aim at -->
    <ul class="users" class:into={zone === 'into'} role="presentation"
      ondragover={e => onDragOver(e, 'into')} ondragleave={onDragLeave} ondrop={e => onDrop(e, 'into')}>
      {#each users as u (u.session)}
        {@const isSelf = u.session === session.self?.session}
        {@const clicks = clickOrDouble(
          el => openProfile(u.session, el),
          () => { if (!isSelf) { session.selectView(`dm:${u.session}`); onnavigate(); } }
        )}
        <li>
          <button class="row user" class:self={isSelf} style:padding-left="{30 + depth * 14}px"
            draggable="true"
            ondragstart={e => { drag.item = { kind: 'user', id: u.session }; e.dataTransfer?.setData('text/plain', u.name); }}
            ondragend={() => (drag.item = null)}
            title={isSelf ? 'You' : `${store.displayName(u)} (double-click to message)`} {...clicks}
            oncontextmenu={e => menu.show(e, userMenu(u))}>
            <Avatar name={u.name} size={22} speaking={voice.talking[u.session] || (isSelf && voice.transmitting)} src={session.avatar(u.session)} />
            <span class="label" class:talking={voice.talking[u.session] || (isSelf && voice.transmitting)}>{store.displayName(u)}</span>
            {#if u.userId != null}<span class="reg" title="Registered">R</span>{/if}
            {#if session.sharing[u.session]}
              {@const kind = session.sharing[u.session]}
              {#if isSelf}
                <span class="state sharing" title="You are sharing your {kind}"><Icon name={kind} size={14} /></span>
              {:else}
                <!-- A button cannot sit inside the row's button -->
                <span class="state sharing" role="button" tabindex="0" title="Sharing their {kind}. Click to watch" aria-label="Watch the {kind} of {store.displayName(u)}"
                  onclick={e => { e.stopPropagation(); clearTimeout(timer); share.watch(sessions.active, u.session); }}
                  ondblclick={e => e.stopPropagation()}
                  onkeydown={e => { if (e.key === 'Enter') { e.stopPropagation(); share.watch(sessions.active, u.session); } }}><Icon name={kind} size={14} /></span>
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
  .row { display: flex; align-items: center; gap: 4px; width: 100%; min-height: 30px; padding-right: 8px; color: var(--text-dim); transition: background 100ms var(--ease), color 100ms var(--ease); }
  .channel:hover, .user:hover { background: var(--bg-hover); color: var(--text); }
  .channel.selected { background: var(--bg-active); color: var(--text); }
  /* Drop targets: the whole row for "into", a line with a square end for "in front of" and "behind" */
  .channel { position: relative; }
  .channel.dragging { opacity: 0.4; }
  .channel.into { background: var(--accent); color: var(--accent-text); outline: 2px solid var(--accent-hover); outline-offset: -2px; }
  .channel.into .label { color: var(--accent-text); }
  .users.into { background: var(--bg-active); box-shadow: inset 3px 0 0 var(--accent); }
  li.after-end { position: relative; }
  .channel.before::before, .channel.after::before, li.after-end::before { content: ''; position: absolute; z-index: 2; left: var(--indent); right: 4px; height: 4px; background: var(--accent); pointer-events: none; }
  .channel.before::after, .channel.after::after, li.after-end::after { content: ''; position: absolute; z-index: 2; left: calc(var(--indent) - 4px); width: 12px; height: 12px; background: var(--accent); pointer-events: none; }
  .channel.before::before { top: -2px; }
  .channel.before::after { top: -6px; }
  .channel.after::before, li.after-end::before { bottom: -2px; }
  .channel.after::after, li.after-end::after { bottom: -6px; }
  .channel.before, .channel.after, .channel.target { background: var(--bg-hover); color: var(--text); }
  .channel.here .label { color: var(--text); font-weight: 600; }
  .channel.here { box-shadow: inset 2px 0 0 var(--speaking); }
  .caret { width: 14px; flex: none; display: inline-flex; justify-content: center; color: var(--text-faint); }
  .caret.collapsed svg { transform: rotate(-90deg); }
  .name { flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px; padding: 5px 0; text-align: left; color: inherit; font-weight: 500; user-select: none; }
  .label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .desc { flex: none; width: 20px; height: 20px; display: inline-flex; align-items: center; justify-content: center; }
  .desc span { width: 7px; height: 7px; background: var(--warn); }
  .desc:hover span { outline: 2px solid var(--warn); outline-offset: 1px; }
  .desc-pop { position: fixed; z-index: 40; width: 340px; max-width: calc(100vw - 16px); max-height: 320px; overflow: auto; padding: 12px 14px;
    background: var(--bg-1); border: 1px solid var(--line-strong); color: var(--text); font-size: 14px; box-shadow: var(--shadow-pop); }
  .desc-pop strong { display: block; margin-bottom: 6px; }
  .desc-pop p { margin: 0; color: var(--text-dim); }
  .desc-pop .html { overflow-wrap: anywhere; user-select: text; }
  .desc-pop .html :global(img) { max-width: 100%; }
  .count { flex: none; font-size: 11px; font-weight: 600; color: var(--text-dim); background: var(--bg-3); padding: 0 6px; line-height: 18px; }
  .badge { flex: none; min-width: 18px; text-align: center; background: var(--danger); color: #fff; font-size: 11px; font-weight: 700; padding: 0 5px; line-height: 18px; }
  .user { gap: 8px; min-height: 28px; text-align: left; user-select: none; }
  .user.self .label { color: var(--text); }
  .label.talking { color: var(--speaking); }
  .reg { font-size: 10px; font-weight: 700; color: var(--accent-hover); border: 1px solid var(--accent); padding: 0 3px; line-height: 14px; }
  .state { color: var(--text-faint); display: inline-flex; }
  .state.admin { color: var(--danger); }
  .state.sharing { color: var(--speaking); padding: 3px; }
  .state.sharing[role=button]:hover { background: var(--bg-active); }
  .rec { font-size: 10px; font-weight: 700; color: var(--danger); border: 1px solid var(--danger); padding: 0 3px; }
</style>
