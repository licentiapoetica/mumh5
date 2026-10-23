<script lang="ts">
  import Icon from './Icon.svelte';
  import Avatar from './Avatar.svelte';
  import Members from './Members.svelte';
  import ResizeHandle from './ResizeHandle.svelte';
  import ChatLog from './ChatLog.svelte';
  import Composer from './Composer.svelte';
  import { session } from '../lib/session.svelte.ts';
  import { store } from '../lib/settings.svelte.ts';
  import { menu } from '../lib/menu.svelte.ts';
  import { ui } from '../lib/ui.svelte.ts';
  import { userMenu, changeNamePrompt } from '../lib/actions.ts';
  import { voice } from '../lib/audio/voice.svelte.ts';
  import { renderIncoming } from '../lib/html.ts';
  import RichEditor from './RichEditor.svelte';
  import { share } from '../lib/share.svelte.ts';
  import { sessions } from '../lib/session.svelte.ts';

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


  let editing = $state(false);
  let draft = $state('');
  $effect(() => { void panel; editing = false; });

  function startEdit() {
    draft = user?.comment ?? '';
    editing = true;
  }

  // After the reset above, so a request from the toolbar survives the panel switching to the profile
  $effect(() => {
    if (!ui.editDescription || !isSelf) return;
    ui.editDescription = false;
    startEdit();
  });

  function saveComment() {
    session.setComment(draft);
    editing = false;
  }

</script>

<aside class="panel" aria-label="Details" style:width="{width}px">
  <ResizeHandle bind:width edge="left" min={MIN_W} max={maxW} initial={DEFAULT_W} storageKey="mumh5.panelWidth" label="Resize panel" />
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
          {#if session.isText(channel.id)}
            <button class="btn primary" onclick={() => { session.selectView(`ch:${channel.id}`); onnavigate(); }}>Open text channel</button>
          {:else if session.self?.channelId === channel.id}
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
        <Avatar name={user.name} size={56} speaking={voice.talking[user.session] || (isSelf && voice.transmitting)} src={session.avatar(user.session)} />
        <div class="who-text">
          <h3>{store.displayName(user)}</h3>
          <p class="where" title="Current channel"><Icon name="channel" size={14} /><span>{session.channel(user.channelId)?.name || 'Root'}</span></p>
          {#if store.displayName(user) !== user.name}<p class="dim small">Real name: {user.name}</p>{/if}
          <p class="flags">
            {#if user.selfMute || user.mute}<span>{user.mute ? 'server muted' : 'muted'}</span>{/if}
            {#if user.selfDeaf || user.deaf}<span>{user.deaf ? 'server deafened' : 'deafened'}</span>{/if}
            {#if user.prioritySpeaker}<span>priority speaker</span>{/if}
            {#if user.recording}<span class="bad">recording</span>{/if}
          </p>
        </div>
      </div>

      {#if session.sharing[user.session]}
        <div class="sharing">
          <Icon name={session.sharing[user.session]} size={16} />
          <span>{isSelf ? `You are sharing your ${session.sharing[user.session]}` : `Sharing their ${session.sharing[user.session]}`}</span>
          {#if isSelf}<button class="btn" onclick={() => share.stop()}>Stop sharing</button>
          {:else if share.watchOf(user.session)}<button class="btn" onclick={() => share.unwatch(user.session)}>Stop watching</button>
          {:else}<button class="btn primary" onclick={() => share.watch(sessions.active, user.session)}>Watch</button>{/if}
        </div>
      {/if}

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
  .sharing { display: flex; align-items: center; gap: 8px; margin-top: 12px; padding: 8px 10px; font-size: 13px; color: var(--speaking); border: 1px solid var(--line); background: var(--bg-0); }
  .sharing span { flex: 1; min-width: 0; color: var(--text); }
  .sharing .btn { padding: 4px 10px; font-size: 12px; }
  .panel { position: relative; max-width: 100%; height: 100%; flex: none; display: flex; flex-direction: column; background: var(--bg-1); border-left: 1px solid var(--line); min-height: 0; }
  header { height: var(--header-h); flex: none; display: flex; align-items: center; gap: 8px; padding: 0 10px 0 16px; border-bottom: 1px solid var(--line); color: var(--text-dim); }
  h2 { flex: 1; min-width: 0; margin: 0; font-size: 15px; font-weight: 650; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tabs { display: flex; flex: none; border-bottom: 1px solid var(--line); }
  .tabs button { flex: 1; padding: 10px; color: var(--text-dim); font-weight: 600; display: inline-flex; justify-content: center; align-items: center; gap: 6px; transition: color 120ms var(--ease); }
  .tabs button:hover { color: var(--text); }
  .tabs button.active { color: var(--text); box-shadow: inset 0 -2px 0 var(--accent); }
  .badge { min-width: 18px; text-align: center; background: var(--danger); color: #fff; font-size: 11px; font-weight: 700; padding: 0 5px; line-height: 18px; }
  .body { flex: 1; overflow-y: auto; padding: 16px; }
  .pad { padding: 16px; }
  .dim { color: var(--text-dim); margin: 0; }
  .small { font-size: 13px; margin-top: 8px; }
  .html { overflow-wrap: anywhere; user-select: text; }
  .html :global(img) { max-width: 100%; }
  .html :global(p) { margin: 0 0 6px; }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; align-items: center; }
  .here { color: var(--speaking); font-weight: 600; font-size: 14px; }
  .who { display: flex; gap: 14px; align-items: center; }
  .who-text { min-width: 0; }
  .where { display: flex; align-items: center; gap: 5px; margin: 3px 0 0; font-size: 13px; color: var(--text-dim); min-width: 0; }
  .where :global(svg) { flex: none; }
  .where span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  h3 { margin: 0; font-size: 18px; font-weight: 650; overflow-wrap: anywhere; }
  h4 { margin: 22px 0 8px; font-size: 11px; font-weight: 650; text-transform: uppercase; letter-spacing: 0.07em; color: var(--text-dim); }
  .flags { display: flex; flex-wrap: wrap; gap: 4px; margin: 6px 0 0; }
  .flags span { font-size: 11px; font-weight: 500; padding: 0 6px; line-height: 18px; background: var(--bg-3); color: var(--text-dim); }
  .flags .bad { background: color-mix(in srgb, var(--danger) 16%, transparent); color: var(--danger); }
</style>
