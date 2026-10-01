<script lang="ts">
  import Icon from './Icon.svelte';
  import Avatar from './Avatar.svelte';
  import { session } from '../lib/session.svelte.ts';
  import { store } from '../lib/settings.svelte.ts';
  import { menu } from '../lib/menu.svelte.ts';
  import { ui } from '../lib/ui.svelte.ts';
  import { userMenu } from '../lib/actions.ts';
  import { voice } from '../lib/audio/voice.svelte.ts';
  import { share } from '../lib/share.svelte.ts';
  import { sessions } from '../lib/session.svelte.ts';

  // People in your voice channel as tiles. Shown on windows too narrow for the member list
  // (always), and on any window while someone in the channel shares a screen: a sharer's tile
  // carries the picture, and clicking it puts it on a large stage with the tiles as a strip.
  let { always = false }: { always?: boolean } = $props();

  const self = $derived(session.self);
  const channel = $derived(self ? session.channel(self.channelId) : undefined);
  const people = $derived(self ? session.usersIn(self.channelId) : []);
  const here = (s: { server?: { id: string } | null } | null | undefined) => !!s && s.server?.id === session.server?.id;

  const watching = $derived(share.watching && here(share.watching.host) ? share.watching : null);
  const mine = $derived(share.stream && here(share.host) ? share.stream : null);
  const anySharing = $derived(people.some(u => session.sharing[u.session]));
  const visible = $derived(!!self && (always || anySharing || !!watching || !!mine));

  // The picture a tile can show: our own stream, or the one we are watching
  function streamOf(s: number): MediaStream | null {
    if (s === self?.session) return mine;
    return watching?.session === s ? watching.stream : null;
  }

  // Tile on the large stage
  let focus = $state<number | null>(null);
  const focused = $derived(focus != null ? streamOf(focus) : null);
  const focusUser = $derived(focus != null ? session.user(focus) : undefined);
  // A stream we just started watching goes to the stage; it leaves when the stream ends
  let lastWatch: number | null = null;
  $effect(() => {
    const now = watching?.session ?? null;
    if (now !== lastWatch) {
      if (now != null) focus = now;
      else if (focus === lastWatch) focus = null;
      lastWatch = now;
    }
  });
  $effect(() => { if (focus === self?.session && !mine) focus = null; });

  let collapsed = $state(load());
  function load(): boolean {
    try { return localStorage.getItem('mumh5.stageCollapsed') === '1'; } catch { return false; }
  }
  function toggle() {
    collapsed = !collapsed;
    try { localStorage.setItem('mumh5.stageCollapsed', collapsed ? '1' : '0'); } catch { /* storage unavailable */ }
  }

  const talking = (s: number) => !!voice.talking[s] || (s === self?.session && voice.transmitting);

  // The same stream can sit in a tile and on the stage at once
  function media(node: HTMLMediaElement, stream: MediaStream | null) {
    node.srcObject = stream;
    return { update(next: MediaStream | null) { if (node.srcObject !== next) node.srcObject = next; } };
  }

  // Sound comes from one hidden player, so it plays once however many pictures are shown
  let player = $state<HTMLAudioElement>();
  const hasSound = $derived(!!watching?.stream?.getAudioTracks().length);
  $effect(() => {
    if (!player) return;
    player.volume = store.settings.shareVolume;
    player.muted = store.settings.shareVolume === 0;
  });

  function tileClick(session_: number) {
    if (streamOf(session_)) focus = focus === session_ ? null : session_;
    else if (session.sharing[session_] && session_ !== self?.session) share.watch(sessions.active, session_);
    else { session.showUser(session_); ui.panelOpen = true; }
  }

  let frame = $state<HTMLElement>();
  function fullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else frame?.requestFullscreen().catch(() => {});
  }
</script>

{#if share.error}<div class="bar bad" role="alert"><span>{share.error}</span><button class="btn" onclick={() => (share.error = '')}>Dismiss</button></div>{/if}

{#if visible && self}
  <section class="stage" class:meeting={!!focused} aria-label="Voice channel">
    <header>
      <button class="title" onclick={toggle} aria-expanded={!collapsed}>
        <svg class="caret" class:collapsed width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3l3 4 3-4" fill="none" stroke="currentColor" stroke-width="1.6" /></svg>
        <span class="name">{channel?.name || 'Root'}</span>
        <span class="count">{people.length}</span>
        {#if collapsed}
          <span class="mini" aria-hidden="true">
            {#each people.slice(0, 8) as u (u.session)}<Avatar name={u.name} size={18} speaking={talking(u.session)} />{/each}
          </span>
        {/if}
      </button>
      {#if mine}
        <span class="status" role="status">You are sharing your screen{mine.getAudioTracks().length ? ' with sound' : ''}{share.viewers ? `, ${share.viewers} watching` : ''}</span>
        <button class="btn small" onclick={() => share.stop()}>Stop sharing</button>
      {/if}
      <button class="icon-btn" class:on={self.selfMute} aria-label={self.selfMute ? 'Unmute' : 'Mute'} title={self.selfMute ? 'Unmute' : 'Mute'}
        onclick={() => session.setSelfMute(!self.selfMute)}>
        <Icon name={self.selfMute ? 'mic-off' : 'mic'} size={18} />
      </button>
      <button class="icon-btn" class:on={self.selfDeaf} aria-label={self.selfDeaf ? 'Undeafen' : 'Deafen'} title={self.selfDeaf ? 'Undeafen' : 'Deafen'}
        onclick={() => session.setSelfDeaf(!self.selfDeaf)}>
        <Icon name={self.selfDeaf ? 'headphones-off' : 'headphones'} size={18} />
      </button>
    </header>

    {#if watching?.stream}<audio bind:this={player} use:media={watching.stream} autoplay></audio>{/if}

    {#if focused && focus != null}
      <div class="spot" role="region" aria-label="Screen share" bind:this={frame}>
        <div class="spot-head">
          <Icon name="screen" size={16} />
          <span class="spot-who">{focus === self.session ? 'Your screen' : focusUser ? store.displayName(focusUser) : 'Screen share'}</span>
          {#if focus !== self.session && hasSound}
            <Icon name={store.settings.shareVolume === 0 ? 'headphones-off' : 'headphones'} size={16} />
            <input class="vol" type="range" min="0" max="1" step="0.01" bind:value={store.settings.shareVolume} onchange={() => store.saveSettings()}
              aria-label="Stream volume" title="Stream volume" />
          {/if}
          <button class="icon-btn" title="Full screen" aria-label="Full screen" onclick={fullscreen}><Icon name="expand" size={16} /></button>
          {#if focus !== self.session}<button class="btn small" onclick={() => share.unwatch()}>Stop watching</button>{/if}
          <button class="icon-btn" title="Back to tiles" aria-label="Back to tiles" onclick={() => (focus = null)}><Icon name="x" size={16} /></button>
        </div>
        <!-- svelte-ignore a11y_media_has_caption -->
        <video use:media={focused} autoplay playsinline muted ondblclick={fullscreen}></video>
      </div>
    {/if}

    {#if !collapsed}
      <ul class="tiles" class:strip={!!focused}>
        {#each people as u (u.session)}
          {@const stream = streamOf(u.session)}
          {@const sharing = !!session.sharing[u.session]}
          {@const isSelf = u.session === self.session}
          <li class:wide={!!stream}>
            <button class="tile" class:talking={talking(u.session)} class:self={isSelf} class:video={!!stream} class:focused={focus === u.session}
              onclick={() => tileClick(u.session)}
              oncontextmenu={e => menu.show(e, userMenu(u))}
              title={stream ? (focus === u.session ? 'Back to tiles' : 'Show large') : sharing && !isSelf ? 'Sharing their screen. Click to watch' : store.displayName(u)}
              aria-label={stream ? `${focus === u.session ? 'Shrink' : 'Enlarge'} the screen of ${store.displayName(u)}` : sharing && !isSelf ? `Watch the screen of ${store.displayName(u)}` : store.displayName(u)}>
              {#if stream}
                <!-- svelte-ignore a11y_media_has_caption -->
                <video use:media={stream} autoplay playsinline muted></video>
              {:else}
                <Avatar name={u.name} size={44} speaking={talking(u.session)} />
              {/if}
              <span class="who">{store.displayName(u)}</span>
              {#if watching?.session === u.session && watching.state !== 'live'}
                <span class="note">{watching.state === 'connecting' ? 'Connecting...' : 'Could not connect'}</span>
              {/if}
              {#if sharing}<span class="badge live"><Icon name="screen" size={13} /></span>
              {:else if u.deaf || u.selfDeaf}
                <span class="badge" class:admin={u.deaf}><Icon name="headphones-off" size={13} /></span>
              {:else if u.mute || u.selfMute || u.suppress}
                <span class="badge" class:admin={u.mute || u.suppress}><Icon name="mic-off" size={13} /></span>
              {/if}
            </button>
          </li>
        {/each}
      </ul>
      {#if watching?.state === 'failed'}
        <p class="failed">Could not connect to the stream. Across the internet both of you need a STUN server set in Settings, Voice (the person sharing has to restart the stream after setting it).</p>
      {/if}
    {/if}
  </section>
{/if}

<style>
  .stage { flex: none; border-bottom: 1px solid var(--line); background: var(--bg-1); }
  header { display: flex; align-items: center; gap: 2px; padding: 4px 8px 4px 4px; }
  .title { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; padding: 6px 8px; text-align: left; }
  .title:hover { background: var(--bg-hover); }
  .caret { flex: none; color: var(--text-faint); }
  .caret.collapsed { transform: rotate(-90deg); }
  .name { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .count { font-size: 12px; color: var(--text-faint); }
  .mini { display: flex; gap: 3px; min-width: 0; overflow: hidden; margin-left: 4px; }
  .tiles { list-style: none; margin: 0; padding: 0 10px 10px; display: grid; grid-template-columns: repeat(auto-fill, minmax(84px, 1fr)); gap: 6px;
    max-height: 40vh; overflow-y: auto; }
  .tile { position: relative; width: 100%; display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 10px 4px 8px;
    background: var(--bg-2); border: 1px solid var(--line); transition: border-color 80ms, box-shadow 80ms; }
  .tile:hover { background: var(--bg-hover); }
  .tile.talking { border-color: var(--speaking); box-shadow: inset 0 0 0 1px var(--speaking); }
  .who { max-width: 100%; font-size: 12px; color: var(--text-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tile.self .who { color: var(--text); font-weight: 600; }
  .badge { position: absolute; top: 4px; right: 4px; display: inline-flex; color: var(--text-faint); }
  .badge.admin { color: var(--danger); }
  .badge.live { color: var(--speaking); }

  /* Streams */
  .bar { flex: none; display: flex; align-items: center; gap: 8px; padding: 6px 12px; font-size: 13px; background: var(--bg-1); border-bottom: 1px solid var(--line); }
  .bar span { flex: 1; min-width: 0; }
  .bar.bad { color: var(--danger); }
  .btn.small, .bar .btn { padding: 4px 10px; font-size: 12px; flex: none; }
  .status { font-size: 12px; color: var(--speaking); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; margin-right: 4px; }
  .tiles li.wide { grid-column: span 2; }
  .tile.video { padding: 0 0 6px; overflow: hidden; }
  .tile.video video { width: 100%; aspect-ratio: 16 / 9; object-fit: contain; background: #000; display: block; }
  .tile.focused { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
  .note { font-size: 11px; color: var(--text-faint); }
  .failed { margin: 0; padding: 0 12px 10px; font-size: 12px; color: var(--danger); }
  /* Meeting view: the chosen picture large, everyone else in one row below */
  .stage.meeting { display: flex; flex-direction: column; max-height: 72%; min-height: 220px; }
  .spot { flex: 1; min-height: 0; display: flex; flex-direction: column; background: #000; }
  .spot-head { flex: none; display: flex; align-items: center; gap: 8px; padding: 2px 6px 2px 12px; background: var(--bg-0); color: var(--text-dim); font-size: 13px; }
  .spot-who { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); font-weight: 600; }
  .spot video { flex: 1; min-height: 0; width: 100%; object-fit: contain; background: #000; display: block; }
  .vol { width: 110px; flex: none; padding: 0; }
  .tiles.strip { flex: none; display: flex; overflow-x: auto; overflow-y: hidden; padding-top: 8px; max-height: none; }
  .tiles.strip li { flex: 0 0 96px; }
  .tiles.strip li.wide { flex-basis: 150px; }
</style>
