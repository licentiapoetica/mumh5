<script lang="ts">
  import Icon from './Icon.svelte';
  import Avatar from './Avatar.svelte';
  import Members from './Members.svelte';
  import ChatLog from './ChatLog.svelte';
  import Composer from './Composer.svelte';
  import { session } from '../lib/session.svelte.ts';
  import { store } from '../lib/settings.svelte.ts';
  import { menu } from '../lib/menu.svelte.ts';
  import { userMenu, changeNamePrompt } from '../lib/actions.ts';
  import { voice } from '../lib/audio/voice.svelte.ts';
  import { renderIncoming } from '../lib/html.ts';
  import RichEditor from './RichEditor.svelte';

  let { onnavigate, onclose }: { onnavigate: () => void; onclose: () => void } = $props();

  const panel = $derived(session.panel);
  const channel = $derived(panel.kind === 'channel' ? session.channel(panel.id) : undefined);
  const user = $derived(panel.kind === 'user' ? session.user(panel.session) : undefined);
  const isSelf = $derived(!!user && user.session === session.self?.session);

  // Description or comment arrive later when they were only announced by hash
  // Re-runs when the hash changes, e.g. right after saving a long description
  $effect(() => { if (channel?.descriptionHash && !channel.description) session.loadDescription(channel.id); });
  $effect(() => { if (user?.commentHash && !user.comment) session.loadComment(user.session); });

  const description = $derived(channel?.description ? renderIncoming(channel.description, store.trustedHosts).html : '');
  const comment = $derived(user?.comment ? renderIncoming(user.comment, store.trustedHosts).html : '');
  const pendingDescription = $derived(!!channel?.descriptionHash && !channel.description);
  const pendingComment = $derived(!!user?.commentHash && !user.comment);

  // User-resizable width, remembered between sessions
  const MIN_W = 240, DEFAULT_W = 300;
  const maxW = () => Math.max(MIN_W, Math.min(900, window.innerWidth - 420));
  let width = $state(Math.max(MIN_W, Number(localStorage.getItem('mumh5.panelWidth')) || DEFAULT_W));
  let resizing = $state(false);

  function setWidth(w: number) {
    width = Math.round(Math.max(MIN_W, Math.min(maxW(), w)));
    try { localStorage.setItem('mumh5.panelWidth', String(width)); } catch { /* storage unavailable */ }
  }

  function startResize(e: PointerEvent) {
    e.preventDefault();
    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture(e.pointerId);
    resizing = true;
    const right = (handle.parentElement as HTMLElement).getBoundingClientRect().right;
    const move = (ev: PointerEvent) => setWidth(right - ev.clientX);
    const up = () => {
      resizing = false;
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  }

  function resizeKey(e: KeyboardEvent) {
    if (e.key === 'ArrowLeft') setWidth(width + 16);
    else if (e.key === 'ArrowRight') setWidth(width - 16);
    else return;
    e.preventDefault();
  }

  let editing = $state(false);
  let draft = $state('');
  $effect(() => { void panel; editing = false; });

  function startEdit() {
    draft = user?.comment ?? '';
    editing = true;
  }

  function saveComment() {
    session.setComment(draft);
    editing = false;
  }

</script>

<svelte:window onresize={() => setWidth(width)} />

<aside class="panel" class:resizing aria-label="Details" style:width="{width}px">
  <!-- Focusable separator is the ARIA window-splitter pattern -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
  <div class="resize" role="separator" aria-orientation="vertical" aria-label="Resize panel" aria-valuenow={width}
    aria-valuemin={MIN_W} aria-valuemax={maxW()} tabindex="0" title="Drag to resize, double-click to reset"
    onpointerdown={startResize} ondblclick={() => setWidth(DEFAULT_W)} onkeydown={resizeKey}></div>
  {#if panel.kind === 'members' || (!channel && !user)}
    <header><h2>Members</h2><button class="icon-btn" onclick={onclose} aria-label="Close"><Icon name="x" size={18} /></button></header>
    <Members {onnavigate} />
  {:else if channel && panel.kind === 'channel'}
    <header>
      <h2>{channel.name || 'Root'}</h2>
      <button class="icon-btn" onclick={() => session.closePanel()} aria-label="Close"><Icon name="x" size={18} /></button>
    </header>
    <div class="tabs" role="tablist">
      <button role="tab" aria-selected={panel.tab === 'info'} class:active={panel.tab === 'info'} onclick={() => session.showChannel(channel.id, 'info')}>Info</button>
      <button role="tab" aria-selected={panel.tab === 'chat'} class:active={panel.tab === 'chat'} onclick={() => session.showChannel(channel.id, 'chat')}>
        Chat{#if session.unread[`ch:${channel.id}`]}<span class="badge">{session.unread[`ch:${channel.id}`]}</span>{/if}
      </button>
    </div>
    {#if panel.tab === 'info'}
      <div class="body">
        {#if description}
          <div class="html">{@html description}</div>
        {:else if pendingDescription}
          <p class="dim">Loading description...</p>
        {:else}
          <p class="dim">This channel has no description.</p>
        {/if}
        <p class="dim small">{session.usersIn(channel.id).length} here, {session.subtreeUserCount(channel.id)} including subchannels{channel.maxUsers ? `, limit ${channel.maxUsers}` : ''}{channel.temporary ? ', temporary' : ''}</p>
        <div class="actions">
          {#if session.self?.channelId === channel.id}
            <span class="here">You are in this channel</span>
          {:else}
            <button class="btn primary" disabled={!channel.canEnter} onclick={() => { session.joinChannel(channel.id); onnavigate(); }}>
              {channel.canEnter ? 'Join channel' : 'No access'}
            </button>
          {/if}
          <button class="btn" onclick={() => session.showChannel(channel.id, 'chat')}>Open chat</button>
        </div>
      </div>
    {:else}
      <ChatLog key={`ch:${channel.id}`}>
        {#snippet empty()}<p class="dim pad">Messages sent here go to everyone in #{channel.name || 'Root'}, even if you are not in it.</p>{/snippet}
      </ChatLog>
      <Composer target={`ch:${channel.id}`} placeholder={`Message #${channel.name || 'Root'}`} />
    {/if}
  {:else if user}
    <header>
      <h2>{isSelf ? 'Your profile' : 'Profile'}</h2>
      <button class="icon-btn" onclick={() => session.closePanel()} aria-label="Close"><Icon name="x" size={18} /></button>
    </header>
    <div class="body">
      <div class="who" role="presentation" oncontextmenu={e => menu.show(e, userMenu(user))}>
        <Avatar name={user.name} size={56} speaking={voice.talking[user.session] || (isSelf && voice.transmitting)} />
        <div class="who-text">
          <h3>{store.displayName(user)}</h3>
          <p class="where" title="Current channel"><Icon name="channel" size={14} /><span>{session.channel(user.channelId)?.name || 'Root'}</span></p>
          {#if store.displayName(user) !== user.name}<p class="dim small">Real name: {user.name}</p>{/if}
          <p class="badges">
            {#if user.userId != null}<span class="badge-reg registered">Registered</span>{/if}
            {#if isSelf && user.userId == null}
              <button class="register" title="Reserve this name on the server, tied to your certificate" onclick={() => session.register(user.session)}>Register</button>
            {/if}
          </p>
          <p class="flags">
            {#if user.selfMute || user.mute}<span>{user.mute ? 'server muted' : 'muted'}</span>{/if}
            {#if user.selfDeaf || user.deaf}<span>{user.deaf ? 'server deafened' : 'deafened'}</span>{/if}
            {#if user.prioritySpeaker}<span>priority speaker</span>{/if}
            {#if user.recording}<span class="bad">recording</span>{/if}
          </p>
        </div>
      </div>

      {#if isSelf}
        <div class="actions"><button class="btn" onclick={() => changeNamePrompt(user)}>Change name</button></div>
      {/if}

      <h4>Description</h4>
      {#if editing}
        <RichEditor value={draft} limit={session.htmlLimit} placeholder="Tell people about yourself" onchange={h => (draft = h)} />
        <div class="actions">
          <button class="btn primary" onclick={saveComment}>Save</button>
          <button class="btn" onclick={() => (editing = false)}>Cancel</button>
        </div>
      {:else}
        {#if comment}
          <div class="html">{@html comment}</div>
        {:else if pendingComment}
          <p class="dim">Loading description...</p>
        {:else}
          <p class="dim">{isSelf ? 'You have no description yet.' : 'No description.'}</p>
        {/if}
        {#if isSelf}<div class="actions"><button class="btn" onclick={startEdit}>Edit description</button></div>{/if}
      {/if}


      {#if !isSelf}
        <div class="actions">
          <button class="btn primary" onclick={() => { session.selectView(`dm:${user.session}`); onnavigate(); }}>Send message</button>
          <button class="btn" onclick={e => menu.show(e, userMenu(user))}>More</button>
        </div>
      {/if}
    </div>
  {/if}
</aside>

<style>
  .panel { position: relative; max-width: 100%; height: 100%; flex: none; display: flex; flex-direction: column; background: var(--bg-1); border-left: 1px solid var(--line); min-height: 0; }
  .panel.resizing { user-select: none; }
  .resize { position: absolute; z-index: 5; top: 0; bottom: 0; left: -4px; width: 8px; cursor: col-resize; touch-action: none; }
  .resize:hover, .resize:focus-visible, .resizing .resize { background: linear-gradient(to right, transparent 3px, var(--accent) 3px, var(--accent) 5px, transparent 5px); outline: none; }
  header { height: 52px; flex: none; display: flex; align-items: center; gap: 8px; padding: 0 8px 0 14px; border-bottom: 1px solid var(--line); color: var(--text-dim); }
  h2 { flex: 1; min-width: 0; margin: 0; font-size: 15px; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tabs { display: flex; flex: none; border-bottom: 1px solid var(--line); }
  .tabs button { flex: 1; padding: 10px; color: var(--text-dim); font-weight: 600; font-size: 14px; display: inline-flex; justify-content: center; gap: 6px; }
  .tabs button.active { color: var(--text); box-shadow: inset 0 -2px 0 var(--accent); }
  .badge { background: var(--danger); color: #fff; font-size: 11px; padding: 0 5px; line-height: 16px; }
  .body { flex: 1; overflow-y: auto; padding: 14px; }
  .pad { padding: 14px; }
  .dim { color: var(--text-dim); margin: 0; }
  .small { font-size: 13px; margin-top: 8px; }
  .html { overflow-wrap: anywhere; user-select: text; }
  .html :global(img) { max-width: 100%; }
  .html :global(p) { margin: 0 0 6px; }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; align-items: center; }
  .here { color: var(--speaking); font-weight: 600; font-size: 14px; }
  .who { display: flex; gap: 14px; align-items: center; }
  .who-text { min-width: 0; }
  .where { display: flex; align-items: center; gap: 5px; margin: 3px 0 0; font-size: 13px; color: var(--text-dim); min-width: 0; }
  .where :global(svg) { flex: none; }
  .where span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  h3 { margin: 0; font-size: 18px; overflow-wrap: anywhere; }
  h4 { margin: 22px 0 8px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-dim); }
  .badges { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 6px 0 0; }
  .badge-reg { font-size: 11px; font-weight: 700; padding: 1px 6px; border: 1px solid var(--line); color: var(--text-dim); }
  .badge-reg.registered { border-color: var(--accent); background: var(--accent); color: var(--accent-text); }
  .register { font-size: 12px; color: var(--link); }
  .register:hover { text-decoration: underline; }
  .flags { display: flex; flex-wrap: wrap; gap: 4px; margin: 6px 0 0; }
  .flags span { font-size: 11px; padding: 0 6px; border: 1px solid var(--line); color: var(--text-dim); }
  .flags .bad { border-color: var(--danger); color: var(--danger); }
</style>
