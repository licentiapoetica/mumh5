<script lang="ts">
  import Background from '../ui/Background.svelte';
  import Icon from '../ui/Icon.svelte';
  import Avatar from '../ui/Avatar.svelte';
  import RoleBadges from '../ui/RoleBadges.svelte';
  import { session, sessions } from '../lib/session.svelte.ts';
  import { serverInitials as initials, store, type SavedServer } from '../lib/settings.svelte.ts';
  import { menu } from '../lib/menu.svelte.ts';
  import { ui } from '../lib/ui.svelte.ts';
  import { channelMenu, userMenu, openProfile, voiceMark, showServerCert } from '../lib/actions.ts';
  import { railMenu, serverState as stateOf, serverUnread as unreadOf } from '../lib/server-menu.ts';
  import { voice } from '../lib/audio/voice.svelte.ts';
  import { desktop } from '../lib/native.ts';
  import { peopleOn } from '../lib/server-status.svelte.ts';
  import { PERM, type Channel } from '../core/client.ts';
  import { describeLink } from '../core/link-quality.ts';
  import { channelTopic } from '../core/text-signal.ts';
  import { selectUser, SELECT_HINT } from '../lib/user-selection.svelte.ts';
  import { drag } from '../lib/drag.svelte.ts';
  import UserSelection from '../ui/UserSelection.svelte';
  import ConnectionWave from '../ui/ConnectionWave.svelte';

  // The home screen: servers across the top, then every room of the server with the people
  // in it, text channels and direct messages. Rooms are a list, not a tree; where a room
  // sits is written under its name.
  let { onadd, onedit, onbrowse, onchat }:
    { onadd: () => void; onedit: (s: SavedServer) => void; onbrowse: () => void; onchat: () => void } = $props();

  const self = $derived(session.self);
  const connected = $derived(session.status === 'connected');
  const cert = $derived(session.serverCert);

  interface Row { channel: Channel; path: string }
  const all = $derived.by(() => {
    const out: Row[] = [];
    const walk = (parent: number | null, path: string) => {
      for (const c of session.childrenOf(parent)) {
        out.push({ channel: c, path });
        walk(c.id, c.id === 0 ? '' : path ? `${path} / ${c.name}` : c.name);
      }
    };
    walk(null, '');
    return out;
  });

  let query = $state('');
  const q = $derived(query.trim().toLowerCase());
  const matches = (r: Row) => !q || (r.channel.name || 'Root').toLowerCase().includes(q)
    || session.usersIn(r.channel.id).some(u => store.displayName(u).toLowerCase().includes(q));
  // Your own room leads the list; the others keep the server's order
  const voiceRooms = $derived(all.filter(r => !session.isText(r.channel.id) && matches(r))
    .sort((a, b) => Number(b.channel.id === self?.channelId) - Number(a.channel.id === self?.channelId)));
  const textRooms = $derived(all.filter(r => session.isText(r.channel.id) && matches(r)));
  const dms = $derived(Object.keys(session.logs).filter(k => k.startsWith('dm:'))
    .map(k => ({ key: k as `dm:${number}`, user: session.user(Number(k.slice(3))), name: session.viewTitle(k) }))
    .filter(d => !q || d.name.toLowerCase().includes(q)));

  // A room shows its people when opened; the one you are in is open unless you close it
  let opened = $state<Record<number, boolean>>({});
  const isOpen = (id: number) => opened[id] ?? (id === self?.channelId || !!q);

  // Last thing said in a chat, as plain text
  function last(key: string): string {
    const e = [...(session.logs[key] ?? [])].reverse().find(x => x.kind === 'text');
    if (!e) return '';
    const text = e.html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
    return `${e.self ? 'You' : e.author}: ${text || (e.embeds.length ? 'sent a file' : '')}`;
  }
  const about = (c: Channel) => channelTopic(c.description);
  const talking = (s: number) => !!voice.talking[s] || (s === self?.session && voice.transmitting);

  let dropRoom = $state<number | null>(null);
  function canDrop(id: number) {
    const d = drag.item;
    return d?.kind === 'user' && d.serverId === session.server?.id && d.ids.some(userId => {
      const user = session.user(userId);
      return user && user.channelId !== id;
    });
  }
  function dropUsers(e: DragEvent, id: number) {
    e.preventDefault();
    const d = drag.item;
    const allowed = canDrop(id);
    dropRoom = null;
    drag.item = null;
    if (allowed && d?.kind === 'user') session.moveUsers(d.ids, id);
  }

  function openChat(key: `ch:${number}` | `dm:${number}`) {
    session.selectView(key);
    onchat();
  }

  function listMenu(e: MouseEvent) {
    if (!connected) return;
    const noMake = session.can(0, PERM.MakeChannel) === false && session.can(0, PERM.MakeTempChannel) === false;
    menu.show(e, [{ label: 'Create channel...', disabled: noMake, action: () => (ui.channelDialog = { mode: 'create', parent: 0 }) }]);
  }
</script>

<section data-background class="rooms" aria-label="Rooms">
  <Background />
  <nav class="servers" aria-label="Servers">
    {#each store.servers as s, i (s.id)}
      {@const state = stateOf(s.id)}
      {@const unread = unreadOf(s.id)}
      {@const people = peopleOn(s.id)}
      <button class="srv" class:active={sessions.activeId === s.id} class:live={state === 'connected'} class:connecting={state === 'connecting'}
        class:voice={sessions.voiceId === s.id && state === 'connected'}
        title="{s.label} ({s.host}){state === 'connected' ? (sessions.voiceId === s.id ? ', voice' : ', connected') : ''}{people ? `, ${people.users}${people.maxUsers ? ` of ${people.maxUsers}` : ''} ${people.users === 1 ? 'person' : 'people'} online` : ''}"
        onclick={() => sessions.open(s)} oncontextmenu={e => menu.show(e, railMenu(s, i, { horizontal: true, onedit }))}>
        <span class="pic">{#if s.icon}<img src={s.icon} alt="" draggable="false" />{:else}{initials(s.label)}{/if}{#if people}<span class="online" class:empty={!people.users} aria-hidden="true">{people.users > 999 ? '999+' : people.users}</span>{/if}</span>
        <span class="cap">{s.label}</span>
        {#if unread}<span class="count">{unread > 99 ? '99+' : unread}</span>{/if}
      </button>
    {/each}
    <button class="srv add" title="Add a server" onclick={onadd}><span class="pic"><Icon name="plus" /></span><span class="cap">Add</span></button>
    <!-- The public list and its pings need the desktop app -->
    {#if desktop}<button class="srv add" title="Browse public servers" onclick={onbrowse}><span class="pic"><Icon name="globe" /></span><span class="cap">Browse</span></button>{/if}
  </nav>

  <header class="top">
    {#if connected}<ConnectionWave />{/if}
    <button class="place" onclick={showServerCert} disabled={!cert} title={cert ? (cert.authorized ? 'Valid certificate. Click to view' : 'Self-signed or untrusted certificate. Click to view') : ''}>
      <h1>{session.server?.label ?? 'mumh5'}</h1>
      <span class="status" role="status" onpointerenter={e => (e.currentTarget.title = describeLink(session.client?.link.read(Date.now())))}>
        {#if connected}<span class="dot"></span>Connected{#if session.rtt}, {session.rtt} ms{/if}{#if cert}<Icon name={cert.authorized ? 'lock' : 'shield'} size={12} />{/if}
        {:else if session.status === 'connecting'}Connecting...
        {:else if session.reconnectDelay != null}Waiting to reconnect
        {:else}Not connected{/if}
      </span>
    </button>
    {#if connected}<button class="icon-btn" title="Server information" aria-label="Server information" onclick={() => (ui.serverInfo = true)}><Icon name="info" size={18} /></button>{/if}
    {#if session.status !== 'idle' || session.reconnectDelay != null}
      <button class="icon-btn" title="Disconnect" aria-label="Disconnect" onclick={() => session.server && sessions.close(session.server.id)}><Icon name="power" size={18} /></button>
    {/if}
  </header>

  {#if connected}
    <label class="find">
      <Icon name="search" size={16} />
      <input type="search" placeholder="Find a room or a person" aria-label="Find a room or a person" bind:value={query} />
    </label>
  {/if}

  <div class="scroll" data-user-list="rooms" role="presentation" oncontextmenu={listMenu}>
    {#if connected}
      {#if textRooms.length}
        <h2>Text channels</h2>
        <ul>
          {#each textRooms as r (r.channel.id)}
            {@const c = r.channel}
            {@const key = `ch:${c.id}` as const}
            <li class="entry" data-menu-row class:viewing={session.view === key}>
              <button class="main" onclick={() => openChat(key)} oncontextmenu={e => menu.show(e, channelMenu(c))}>
                <span class="glyph"><Icon name="hash" size={18} /></span>
                <span class="text">
                  <span class="name">{c.name}</span>
                  <span class="sub">{last(key) || r.path || 'No messages yet'}</span>
                </span>
                {#if session.unread[key]}<span class="badge">{session.unread[key]}</span>{/if}
              </button>
              <button class="icon-btn" aria-label="More for {c.name}" onclick={e => menu.show(e, channelMenu(c))}><Icon name="more" size={18} /></button>
            </li>
          {/each}
        </ul>
      {/if}

      <h2>Rooms</h2>
      <ul>
        {#each voiceRooms as r (r.channel.id)}
          {@const c = r.channel}
          {@const users = session.usersIn(c.id)}
          {@const here = self?.channelId === c.id}
          {@const open = isOpen(c.id)}
          {@const key = `ch:${c.id}` as const}
          <li class="room" class:here class:open class:empty={!users.length}>
            <div class="entry" data-menu-row class:drop-target={dropRoom === c.id && drag.item?.kind === 'user'} role="presentation" oncontextmenu={e => menu.show(e, channelMenu(c))}
              ondragover={e => { if (canDrop(c.id)) { e.preventDefault(); dropRoom = c.id; } }}
              ondragleave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) dropRoom = null; }}
              ondrop={e => dropUsers(e, c.id)}>
              <button class="main" aria-expanded={open} onclick={() => (opened[c.id] = !open)}>
                <span class="text">
                  <span class="name">{#if !c.canEnter}<Icon name="lock" size={14} />{/if}{c.name || 'Root'}</span>
                  {#if r.path}<span class="sub">in {r.path}</span>{/if}
                </span>
                {#if users.length && !open}
                  <span class="faces" aria-label="{users.length} {users.length === 1 ? 'person' : 'people'}">
                    {#each users.slice(0, 4) as u (u.session)}<Avatar name={u.name} size={26} speaking={talking(u.session)} src={session.avatar(u.session)} />{/each}
                    {#if users.length > 4}<span class="extra">+{users.length - 4}</span>{/if}
                  </span>
                {/if}
                {#if session.unread[key]}<span class="badge">{session.unread[key]}</span>{/if}
              </button>
              {#if here}
                <span class="tag">You are here</span>
              {:else}
                <button class="join" aria-label="Join {c.name || 'Root'}" onclick={() => session.joinChannel(c.id)}>{c.canEnter ? 'Join' : 'Unlock'}</button>
              {/if}
              <button class="icon-btn" aria-label="More for {c.name || 'Root'}" onclick={e => menu.show(e, channelMenu(c))}><Icon name="more" size={18} /></button>
            </div>
            {#if open}
              <div class="inside">
                {#if about(c)}<p class="about">{about(c)}</p>{/if}
                {#if users.length}
                  <ul class="people">
                    {#each users as u (u.session)}
                      {@const me = u.session === self?.session}
                      {@const mark = voiceMark(u)}
                      {@const onSphere = !!mark && store.settings.avatars === 'spheres'}
                      <li>
                        <button class="person" data-menu-row use:selectUser={{ id: u.session }} draggable="true" title={SELECT_HINT} aria-pressed={session.selectedUsers.includes(u.session)} onclick={e => openProfile(u.session, e.currentTarget)} oncontextmenu={e => menu.show(e, userMenu(u))}>
                          {#if mark && onSphere}
                            <span class="mark face" class:bad={mark.admin} title={mark.title}><Icon name={mark.icon} size={22} /></span>
                          {:else}
                            <Avatar name={u.name} size={32} speaking={talking(u.session)} src={session.avatar(u.session)} />
                          {/if}
                          <span class="pname" class:talking={talking(u.session)} style:color={talking(u.session) ? undefined : session.roleColor(u)}>{store.displayName(u)}{#if me} <em>you</em>{/if}</span>
                          <RoleBadges user={u} />
                          {#if session.sharing[u.session]}<span class="mark live" title="Sharing their {session.sharing[u.session]}"><Icon name={session.sharing[u.session]} size={14} /></span>{/if}
                          {#if u.recording}<span class="rec">REC</span>{/if}
                          {#if mark && !onSphere}<span class="mark" class:bad={mark.admin} title={mark.title}><Icon name={mark.icon} size={14} /></span>{/if}
                        </button>
                      </li>
                    {/each}
                  </ul>
                {:else}
                  <p class="nobody">Nobody here.</p>
                {/if}
                <div class="acts">
                  <button class="btn" onclick={() => openChat(key)}>Chat</button>
                  <button class="btn" onclick={() => { session.showChannel(c.id, 'info'); ui.panelOpen = true; }}>Details</button>
                </div>
              </div>
            {/if}
          </li>
        {:else}
          <li class="none">Nothing matches "{query}".</li>
        {/each}
      </ul>

      {#if dms.length}
        <h2>Direct messages</h2>
        <ul>
          {#each dms as dm (dm.key)}
            <li class="entry" data-menu-row class:viewing={session.view === dm.key}
              oncontextmenu={e => { e.stopPropagation(); menu.show(e, [{ label: 'Close conversation', action: () => session.closeDm(dm.key) }, { label: 'Delete history', action: () => session.deleteDm(dm.key) }]); }}>
              <button class="main" onclick={() => openChat(dm.key)}>
                <Avatar name={dm.name} size={32} src={session.avatar(dm.user?.session)} />
                <span class="text">
                  <span class="name" class:gone={!dm.user}>{dm.user ? store.displayName(dm.user) : dm.name}</span>
                  <span class="sub">{last(dm.key)}</span>
                </span>
                {#if session.unread[dm.key]}<span class="badge">{session.unread[dm.key]}</span>{/if}
              </button>
              <button class="icon-btn dm-close" title="Close conversation" aria-label="Close conversation with {dm.user ? store.displayName(dm.user) : dm.name}"
                onclick={() => session.closeDm(dm.key)}><Icon name="x" size={16} /></button>
            </li>
          {/each}
        </ul>
      {/if}
      <UserSelection list="rooms" />
    {:else if session.status === 'idle' && (session.disconnectInfo || session.reconnectDelay != null)}
      {@const d = session.disconnectInfo}
      <div class="ended" class:bad={d?.kind === 'kicked' || d?.kind === 'banned'}>
        <h2>
          {#if d?.kind === 'kicked'}You were kicked{d.by ? ` by ${d.by}` : ''}
          {:else if d?.kind === 'banned'}You were banned{d.by ? ` by ${d.by}` : ''}
          {:else if d?.kind === 'rejected'}The server refused the connection
          {:else if d}Connection lost
          {:else}Could not connect{/if}
        </h2>
        {#if d ? d.reason : session.error}<p class="reason">{d ? d.reason : session.error}</p>{/if}
        {#if session.reconnectDelay != null}
          <p role="status">Retrying in {session.reconnectDelay} second{session.reconnectDelay === 1 ? '' : 's'}.</p>
          <button class="btn" onclick={() => session.cancelReconnect()}>Cancel auto-reconnect</button>
        {/if}
        <button class="btn primary" onclick={() => session.reconnect()}>Reconnect</button>
      </div>
    {:else if session.status === 'connecting'}
      <p class="blank">Connecting...</p>
    {:else}
      <div class="blank">
        {#if session.error}<p class="error">{session.error}</p>{/if}
        <p>Choose a server above, or add one.</p>
        <div class="acts">
          <button class="btn primary" onclick={onadd}>Add a server</button>
          {#if desktop}<button class="btn" onclick={onbrowse}>Browse public servers</button>{/if}
          <button class="btn" onclick={() => { ui.settingsTab = 'identities'; ui.settingsOpen = true; }}>Manage identities</button>
        </div>
      </div>
    {/if}
  </div>
</section>

<style>
  .rooms { height: 100%; min-height: 0; display: flex; flex-direction: column; background: var(--bg-1); }
  ul { list-style: none; margin: 0; padding: 0; }

  .servers { flex: none; display: flex; gap: 4px; padding: 10px 12px 6px; overflow-x: auto; scrollbar-width: none; }
  .servers::-webkit-scrollbar { display: none; }
  .srv { position: relative; flex: none; width: 64px; display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 4px 0; color: var(--text-dim); }
  .pic { position: relative; width: 48px; height: 48px; display: flex; align-items: center; justify-content: center; background: var(--bg-3); font-weight: 700; color: var(--text); }
  .pic img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .cap { max-width: 100%; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .srv.active .pic { outline: 2px solid var(--accent); outline-offset: 2px; }
  .srv.active .cap { color: var(--text); }
  .srv.live .pic::after, .srv.connecting .pic::after { content: ''; position: absolute; right: -3px; bottom: -3px; width: 10px; height: 10px; background: var(--speaking); border: 2px solid var(--bg-1); }
  .srv.connecting .pic::after { background: var(--text-faint); }
  .srv.voice .pic::after { box-shadow: 0 0 0 2px var(--speaking); }
  .online { position: absolute; left: -5px; bottom: -5px; min-width: 20px; padding: 0 4px; line-height: 16px; text-align: center; font-size: 10px; font-weight: 700; background: var(--bg-3); color: var(--text); border: 2px solid var(--bg-1); }
  .online.empty { color: var(--text-faint); }
  .srv.add .pic { background: transparent; border: 1px dashed var(--line); color: var(--text-dim); }
  .srv.add:hover .pic { color: var(--text); border-color: var(--text-dim); }
  .count { position: absolute; top: 0; right: 4px; min-width: 18px; padding: 0 4px; line-height: 16px; font-size: 10px; font-weight: 700; background: var(--danger); color: #fff; }

  .top { position: relative; isolation: isolate; flex: none; display: flex; align-items: center; gap: 4px; padding: 6px 8px 6px 0; }
  .place { flex: 1; min-width: 0; padding: 4px 16px; text-align: left; }
  .place:disabled { opacity: 1; }
  h1 { margin: 0; font-size: 24px; line-height: 1.2; letter-spacing: -0.01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .status { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--text-dim); }
  .dot { width: 8px; height: 8px; background: var(--speaking); }

  .find { flex: none; display: flex; align-items: center; gap: 8px; margin: 4px 16px 8px; padding: 0 12px; height: 44px; background: var(--bg-0); border: 1px solid var(--line-strong); color: var(--text-faint); text-transform: none; letter-spacing: 0; font-weight: 400; }
  .find:focus-within { border-color: var(--accent); }
  .find input { border: 0; background: none; padding: 0; height: 100%; font-size: 15px; box-shadow: none; }

  .scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 0 8px 16px; }
  h2 { margin: 18px 8px 6px; font-size: 11px; font-weight: 650; text-transform: uppercase; letter-spacing: 0.07em; color: var(--text-faint); }

  .entry { display: flex; align-items: center; gap: 4px; min-height: 56px; padding-right: 4px; }
  .entry:hover, .entry.viewing { background: var(--bg-hover); }
  .entry.drop-target { background: var(--bg-active); outline: 2px solid var(--accent); outline-offset: -2px; }
  .main { flex: 1; min-width: 0; align-self: stretch; display: flex; align-items: center; gap: 12px; padding: 8px; text-align: left; }
  .glyph { flex: none; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; background: var(--bg-3); color: var(--text-dim); }
  .text { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .name { display: flex; align-items: center; gap: 6px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .name.gone { color: var(--text-faint); font-style: italic; }
  .sub { font-size: 13px; color: var(--text-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .badge { flex: none; min-width: 20px; padding: 0 6px; line-height: 20px; text-align: center; font-size: 12px; font-weight: 700; background: var(--danger); color: #fff; }

  .room { margin-bottom: 2px; border-left: 3px solid transparent; }
  .room.empty .name { color: var(--text-dim); font-weight: 500; }
  .room.here { border-left-color: var(--speaking); background: var(--bg-2); }
  .room.here .name { color: var(--text); font-weight: 700; }
  .faces { flex: none; display: flex; align-items: center; gap: 4px; }
  .extra { font-size: 12px; color: var(--text-dim); padding-left: 2px; }
  .join { flex: none; height: 36px; padding: 0 14px; font-weight: 600; font-size: 14px; border: 1px solid var(--line-strong); color: var(--text); transition: background 120ms var(--ease), border-color 120ms var(--ease), color 120ms var(--ease); }
  .join:hover:not(:disabled) { background: var(--accent); border-color: var(--accent); color: var(--accent-text); }
  .tag { flex: none; padding: 0 6px; font-size: 12px; font-weight: 600; color: var(--speaking); }
  .icon-btn { flex: none; width: 40px; height: 40px; }

  .inside { padding: 0 8px 12px 8px; }
  .about { margin: 0 8px 8px; font-size: 14px; color: var(--text-dim); display: -webkit-box; -webkit-line-clamp: 3; line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
  .nobody { margin: 0 8px 8px; font-size: 14px; color: var(--text-faint); }
  .person { width: 100%; min-height: 44px; display: flex; align-items: center; gap: 12px; padding: 4px 8px; text-align: left; }
  .person:hover { background: var(--bg-hover); }
  .pname { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pname.talking { color: var(--speaking); }
  .pname em { margin-left: 6px; font-style: normal; font-size: 12px; color: var(--text-faint); }
  .mark { flex: none; display: inline-flex; color: var(--text-faint); }
  .mark.bad { color: var(--danger); }
  .mark.face { width: 32px; height: 32px; align-items: center; justify-content: center; }
  .mark.face:not(.bad) { color: var(--text); }
  .mark.live { color: var(--speaking); }
  .rec { flex: none; font-size: 10px; font-weight: 700; color: var(--danger); border: 1px solid var(--danger); padding: 0 3px; }
  .acts { display: flex; flex-wrap: wrap; gap: 8px; margin: 8px 8px 0; }
  .none { padding: 12px 8px; color: var(--text-dim); }

  .blank { padding: 24px 16px; color: var(--text-dim); }
  .blank p { margin: 0 0 4px; }
  .blank .acts { margin: 14px 0 0; }
  .error { color: var(--danger); }
  .ended { margin: 16px 8px; padding: 16px; background: var(--bg-2); border: 1px solid var(--line); border-left: 4px solid var(--warn); }
  .ended.bad { border-left-color: var(--danger); }
  .ended h2 { margin: 0 0 6px; font-size: 18px; text-transform: none; letter-spacing: 0; color: var(--text); }
  .ended .reason { margin: 0 0 12px; overflow-wrap: anywhere; }
</style>
