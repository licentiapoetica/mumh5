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
  import ResizeHandle from './ResizeHandle.svelte';
  import ShareStats from './ShareStats.svelte';

  // People in your voice channel as tiles. Shown on windows too narrow for the member list
  // (always), and on any window while someone in the channel shares something. A screen is shown
  // large above the tiles, which become a strip; cameras play in the tiles themselves, as many
  // as are on, and a click enlarges one.
  // videoOnly: just the picture, as wide as the chat (stacked layout, where the channel list
  // above already shows who is here)
  let { always = false, videoOnly = false }: { always?: boolean; videoOnly?: boolean } = $props();

  const self = $derived(session.self);
  const channel = $derived(self ? session.channel(self.channelId) : undefined);
  const inChannel = $derived(self ? session.usersIn(self.channelId) : []);
  const here = (s: { server?: { id: string } | null } | null | undefined) => !!s && s.server?.id === session.server?.id;

  const watches = $derived(share.watches.filter(w => here(w.host)));
  // The screen being watched; cameras are watched next to it
  const watching = $derived(watches.find(w => w.kind === 'screen') ?? null);
  const watchOf = (s: number) => watches.find(w => w.session === s);
  const mine = $derived(share.stream && here(share.host) ? share.stream : null);
  const anySharing = $derived(inChannel.some(u => session.sharing[u.session]));
  const anyCamera = $derived(inChannel.some(u => session.sharing[u.session] === 'camera' && u.session !== self?.session));
  const visible = $derived(!!self && (videoOnly ? watches.length > 0 || !!mine : always || anySharing || watches.length > 0 || !!mine));

  // The picture we have of someone: our own stream, or one we are watching
  function streamOf(s: number): MediaStream | null {
    if (s === self?.session) return mine;
    return watchOf(s)?.stream ?? null;
  }
  // A camera plays in the person's tile; a screen never does
  const camOf = (s: number) => session.sharing[s] === 'camera' ? streamOf(s) : null;

  // People with a stream we can show come first, then others who share
  const rank = (s: number) => streamOf(s) ? 0 : session.sharing[s] ? 1 : 2;
  const people = $derived([...inChannel].sort((a, b) => rank(a.session) - rank(b.session)));
  // Who gets a tile: everyone, or in the stacked layout only the people whose camera we see
  const shown = $derived(videoOnly ? people.filter(u => camOf(u.session)) : people);

  // Tile on the large stage
  let focus = $state<number | null>(null);
  const focused = $derived(focus != null ? streamOf(focus) : null);
  const focusUser = $derived(focus != null ? session.user(focus) : undefined);
  // Screen or camera, for the wording and the icons
  const focusKind = $derived((focus != null && session.sharing[focus]) || 'screen');
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
  // Our own stream opens large when it starts, unless another one is on the stage
  let hadMine = false;
  $effect(() => {
    const has = !!mine;
    if (has && !hadMine && focus == null && self && share.kind === 'screen') focus = self.session;
    else if (!has && focus === self?.session) focus = null;
    hadMine = has;
  });
  // Without tiles there is nothing to choose: the watched stream, else our own
  let lastSolo: number | null = null;
  $effect(() => {
    if (!videoOnly) return;
    const solo = watching ? watching.session : mine && share.kind === 'screen' ? self?.session ?? null : null;
    if (solo !== lastSolo) { focus = solo; lastSolo = solo; }
  });

  // The stage is as tall as the user drags it; the tiles grow and shrink to fill it. The
  // meeting view (one picture large) remembers its own height.
  const stored = (key: string, fallback: number) => { try { return Number(localStorage.getItem(key)) || fallback; } catch { return fallback; } };
  let tilesHeight = $state(stored('mumh5.stageHeight', 210));
  let meetingHeight = $state(stored('mumh5.stageHeightMeeting', 460));
  const maxHeight = () => Math.max(160, window.innerHeight - 220);

  // The tiles fill the stage completely, like a meeting's tile view: rows of equal tiles, with
  // the number of columns chosen so the tiles come closest to a 16:9 shape. A last row with
  // fewer people stretches, so no space is left over. Measured live, so it follows every resize.
  let gridW = $state(0), gridH = $state(0);
  const GAP = 8, PAD = 8;
  const cols = $derived.by(() => {
    const n = shown.length;
    const w = gridW - PAD * 2, h = gridH - PAD * 2;
    if (n < 2 || w <= 0 || h <= 0) return 1;
    let best = 1, bestSize = 0;
    for (let c = 1; c <= n; c++) {
      const r = Math.ceil(n / c);
      // Width of the largest 16:9 picture that fits one cell
      const size = Math.min((w - GAP * (c - 1)) / c, ((h - GAP * (r - 1)) / r) * 16 / 9);
      if (size > bestSize + 0.5) { best = c; bestSize = size; }
    }
    return best;
  });
  // In the meeting view everyone sits in one row under the picture
  const rows = $derived.by(() => {
    if (focused) return [shown];
    const out: (typeof shown)[] = [];
    for (let i = 0; i < shown.length; i += cols) out.push(shown.slice(i, i + cols));
    return out;
  });
  const avatar = $derived.by(() => {
    if (focused) return 36;
    const cellW = (gridW - PAD * 2 - GAP * (cols - 1)) / cols;
    const cellH = (gridH - PAD * 2 - GAP * (rows.length - 1)) / Math.max(1, rows.length);
    return Math.max(24, Math.min(128, Math.round(Math.min(cellH * 0.5, cellW * 0.34))));
  });

  let collapsed = $state(load());
  function load(): boolean {
    try { return localStorage.getItem('mumh5.stageCollapsed') === '1'; } catch { return false; }
  }
  function toggle() {
    collapsed = !collapsed;
    try { localStorage.setItem('mumh5.stageCollapsed', collapsed ? '1' : '0'); } catch { /* storage unavailable */ }
  }

  const talking = (s: number) => !!voice.talking[s] || (s === self?.session && voice.transmitting);

  // Mobile browsers do not always honour autoplay for a stream attached later, so play is asked for too
  function media(node: HTMLMediaElement, stream: MediaStream | null) {
    const attach = (s: MediaStream | null) => {
      node.srcObject = s;
      if (s) node.play().catch(() => {});
    };
    attach(stream);
    return { update(next: MediaStream | null) { if (node.srcObject !== next) attach(next); } };
  }

  // Sound comes from hidden players, one per stream that has any, so it plays once however
  // many pictures are shown. They all follow the stream volume.
  const withSound = $derived(watches.filter(w => w.stream?.getAudioTracks().length));
  const hasSound = $derived(focus != null && withSound.some(w => w.session === focus));
  function loud(node: HTMLMediaElement) {
    $effect(() => {
      node.volume = store.settings.shareVolume;
      node.muted = store.settings.shareVolume === 0;
    });
  }
  const focusWatch = $derived(focus != null ? watchOf(focus) : undefined);

  function tileClick(session_: number) {
    if (streamOf(session_)) focus = focus === session_ ? null : session_;
    else if (session.sharing[session_] && session_ !== self?.session) share.watch(sessions.active, session_);
    else { session.showUser(session_); ui.panelOpen = true; }
  }

  // Right-click on the picture
  let showStats = $state(false);
  const streamItems = () => [
    { label: 'Open in a separate window', action: popOut },
    { label: 'Full screen', action: fullscreen },
    { separator: true, label: '' },
    { label: 'Stats for nerds', checked: showStats, action: () => (showStats = !showStats) }
  ];
  const streamMenu = (e: MouseEvent) => menu.show(e, streamItems());
  // Touch screens have no right-click: holding a finger on the picture opens the same menu
  let hold: ReturnType<typeof setTimeout> | undefined;
  function touchStart(e: TouchEvent) {
    const touch = e.touches[0];
    clearTimeout(hold);
    if (e.touches.length !== 1) return;
    const { clientX, clientY } = touch;
    hold = setTimeout(() => menu.showAt(clientX, clientY, streamItems()), 550);
  }
  const touchEnd = () => clearTimeout(hold);

  let frame = $state<HTMLElement>();
  function fullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else frame?.requestFullscreen().catch(() => {});
  }

  // The large picture in a window of its own, to put on another screen. The window is an
  // empty page that gets the same stream; sound keeps coming from the main window.
  let popup: Window | null = null;
  let popVideo: HTMLVideoElement | null = null;
  let spotVideo = $state<HTMLVideoElement>();
  let popped = $state(false);
  function popOut() {
    if (popup && !popup.closed) return popup.focus();
    const w = window.open('', 'mumh5-stream', 'popup,width=960,height=600');
    if (!w) {
      // Refused (a pop-up blocker, or an app build that predates this). The floating
      // picture-in-picture window needs no permission where the browser has it.
      if (document.pictureInPictureEnabled && spotVideo) {
        spotVideo.requestPictureInPicture().catch(() => { share.error = 'The stream could not be opened in a separate window.'; });
      } else {
        share.error = 'The stream could not be opened in a separate window. If your browser blocked a pop-up, allow it for this page and try again.';
      }
      return;
    }
    popup = w;
    popped = true;
    w.document.body.style.cssText = 'margin:0;background:#000;overflow:hidden';
    const v = w.document.createElement('video');
    v.autoplay = true;
    v.muted = true;
    v.playsInline = true;
    v.style.cssText = 'width:100vw;height:100vh;object-fit:contain;display:block';
    v.ondblclick = () => { if (w.document.fullscreenElement) w.document.exitFullscreen(); else v.requestFullscreen().catch(() => {}); };
    w.document.body.replaceChildren(v);
    popVideo = v;
    w.addEventListener('pagehide', () => { if (popup === w) { popup = null; popVideo = null; popped = false; } });
  }
  function popIn() {
    popup?.close();
    popup = null;
    popVideo = null;
    popped = false;
  }
  // The window follows the picture on the stage and closes with it
  $effect(() => {
    const stream = focused;
    const title = focus === self?.session ? `Your ${focusKind}` : focusUser ? store.displayName(focusUser) : 'Screen share';
    if (!popped) return;
    if (!stream) return popIn();
    if (popVideo && popVideo.srcObject !== stream) popVideo.srcObject = stream;
    if (popup) popup.document.title = `${title} - mumh5`;
  });
  $effect(() => () => popup?.close());
</script>

{#if voice.error && session.status === 'connected'}<div class="bar bad" role="alert"><span>Voice is not working: {voice.error}</span></div>{/if}
{#if share.error}<div class="bar bad" role="alert"><span>{share.error}</span><button class="btn" onclick={() => (share.error = '')}>Dismiss</button></div>{/if}

{#snippet spot()}
  {#if self && focus != null && focused}
      <div class="spot" role="region" aria-label="Screen share" bind:this={frame}>
      <div class="spot-head">
        <Icon name={focusKind} size={16} />
        <span class="spot-who">{focus === self.session ? `Your ${focusKind}` : focusUser ? store.displayName(focusUser) : 'Screen share'}</span>
        {#if focus !== self.session && hasSound}
          <Icon name={store.settings.shareVolume === 0 ? 'headphones-off' : 'headphones'} size={16} />
          <input class="vol" type="range" min="0" max="1" step="0.01" bind:value={store.settings.shareVolume} onchange={() => store.saveSettings()}
            aria-label="Stream volume" title="Stream volume" />
        {/if}
        {#if popped}
          <button class="btn small" onclick={popIn}>Bring back</button>
        {:else}
          <button class="icon-btn" title="Open in a separate window" aria-label="Open in a separate window" onclick={popOut}><Icon name="popout" size={16} /></button>
          <button class="icon-btn" title="Full screen" aria-label="Full screen" onclick={fullscreen}><Icon name="expand" size={16} /></button>
        {/if}
        {#if focus !== self.session}<button class="btn small" onclick={() => { if (focus != null) share.unwatch(focus); }}>Stop watching</button>
        {:else if videoOnly}
          <span class="status" role="status" title="People watching your {share.kind}">{share.viewers} watching</span>
          <button class="btn small" onclick={() => share.stop()}>Stop sharing</button>
        {/if}
        {#if !videoOnly || shown.length}<button class="icon-btn" title="Back to tiles" aria-label="Back to tiles" onclick={() => (focus = null)}><Icon name="x" size={16} /></button>{/if}
      </div>
      <!-- svelte-ignore a11y_media_has_caption -->
      {#if popped}
        <p class="away">Shown in a separate window.</p>
      {:else}
        <div class="pic" role="presentation" oncontextmenu={streamMenu}
          ontouchstart={touchStart} ontouchend={touchEnd} ontouchmove={touchEnd} ontouchcancel={touchEnd}>
          <video bind:this={spotVideo} use:media={focused} autoplay playsinline muted ondblclick={fullscreen}></video>
          {#if focus !== self.session && focusWatch && focusWatch.state !== 'live'}
            <p class="pending" class:bad={focusWatch.state === 'failed'}>{focusWatch.state === 'failed'
              ? 'Could not connect to the stream. Across the internet both of you need a STUN server; networks that block direct connections need a relay. Both are in Settings, Voice.'
              : 'Connecting to the stream...'}</p>
          {/if}
          {#if showStats}<ShareStats own={focus === self.session} session={focus} onclose={() => (showStats = false)} />{/if}
        </div>
      {/if}
    </div>
  {/if}
{/snippet}

{#snippet tiles()}
      <div class="tiles" class:strip={!!focused} role="group" aria-label="People in this channel" bind:clientWidth={gridW} bind:clientHeight={gridH}>
        {#each rows as row, r (r)}
          <div class="row" role="presentation">
        {#each row as u (u.session)}
          {@const stream = streamOf(u.session)}
          {@const sharing = session.sharing[u.session]}
          {@const isSelf = u.session === self?.session}
          {@const cam = camOf(u.session)}
          {@const w = watchOf(u.session)}
          <button class="tile" class:talking={talking(u.session)} class:self={isSelf} class:focused={focus === u.session}
            onclick={() => tileClick(u.session)}
            oncontextmenu={e => menu.show(e, userMenu(u))}
            title={stream ? (focus === u.session ? 'Hide the stream' : 'Show the stream') : sharing && !isSelf ? `Sharing their ${sharing}. Click to watch` : store.displayName(u)}
            aria-label={stream ? `${focus === u.session ? 'Hide' : 'Show'} the ${sharing || 'stream'} of ${store.displayName(u)}` : sharing && !isSelf ? `Watch the ${sharing} of ${store.displayName(u)}` : store.displayName(u)}>
            {#if cam}
              <!-- svelte-ignore a11y_media_has_caption -->
              <video class:mirror={isSelf} use:media={cam} autoplay playsinline muted></video>
            {:else}
              <Avatar name={u.name} size={avatar} speaking={talking(u.session)} />
            {/if}
            <span class="who">{store.displayName(u)}</span>
            {#if w && w.state !== 'live'}
              <span class="note">{w.state === 'connecting' ? 'Connecting...' : 'Could not connect'}</span>
            {/if}
            {#if sharing}<span class="badge live"><Icon name={sharing} size={13} /></span>
            {:else if u.deaf || u.selfDeaf}
              <span class="badge" class:admin={u.deaf}><Icon name="headphones-off" size={13} /></span>
            {:else if u.mute || u.selfMute || u.suppress}
              <span class="badge" class:admin={u.mute || u.suppress}><Icon name="mic-off" size={13} /></span>
            {/if}
          </button>
        {/each}
          </div>
        {/each}
      </div>
{/snippet}

{#if visible && self && videoOnly}
  <section class="stage solo" aria-label="Voice channel">
    {#each withSound as w (w.session)}<audio use:media={w.stream} use:loud autoplay></audio>{/each}
    {#if focused}
      {@render spot()}
    {:else if watching}
      <p class="wait" class:bad={watching.state === 'failed'}>
        <span>{watching.state === 'failed' ? 'Could not connect to the stream. Across the internet both of you need a STUN server set in Settings, Voice.' : 'Connecting to the stream...'}</span>
        <button class="btn small" onclick={() => share.unwatch(watching.session)}>{watching.state === 'failed' ? 'Close' : 'Cancel'}</button>
      </p>
    {/if}
    <!-- Cameras: a grid of just the pictures -->
    {#if shown.length && !focused}
      <div class="camgrid" style:height="{tilesHeight}px">
        <ResizeHandle bind:width={tilesHeight} edge="bottom" min={110} max={maxHeight} initial={210} storageKey="mumh5.stageHeight" label="Resize the tiles" />
        {@render tiles()}
      </div>
    {/if}
  </section>
{:else if visible && self}
  <section class="stage" class:meeting={!!focused} class:collapsed aria-label="Voice channel"
    style:height={collapsed ? undefined : `${focused ? meetingHeight : tilesHeight}px`}>
    {#if !collapsed}
      {#if focused}
        <ResizeHandle bind:width={meetingHeight} edge="bottom" min={240} max={maxHeight} initial={460} storageKey="mumh5.stageHeightMeeting" label="Resize the meeting view" />
      {:else}
        <ResizeHandle bind:width={tilesHeight} edge="bottom" min={110} max={maxHeight} initial={210} storageKey="mumh5.stageHeight" label="Resize the tiles" />
      {/if}
    {/if}
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
      {#if anyCamera || share.cams}
        <button class="icon-btn" class:live={share.cams} aria-pressed={share.cams} title={share.cams ? 'Stop watching the cameras' : 'Watch everyone\'s camera'}
          aria-label={share.cams ? 'Stop watching the cameras' : 'Watch all cameras'} onclick={() => share.setCams(sessions.active, !share.cams)}>
          <Icon name="camera" size={18} />
        </button>
      {/if}
      {#if mine}
        <span class="status" role="status" title="People watching your {share.kind}"><Icon name={share.kind} size={14} />{share.viewers} watching</span>
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

    {#each withSound as w (w.session)}<audio use:media={w.stream} use:loud autoplay></audio>{/each}

    {#if focused && focus != null && !collapsed}{@render spot()}{/if}

    {#if !collapsed}
      {@render tiles()}
      {#if watches.some(w => w.state === 'failed')}
        <p class="failed">Could not connect to the stream. Across the internet both of you need a STUN server, chosen in Settings, Voice (the person sharing has to restart the stream afterwards).</p>
      {/if}
    {/if}
  </section>
{/if}

<style>
  .stage { position: relative; flex: none; display: flex; flex-direction: column; min-height: 0; border-bottom: 1px solid var(--line); background: var(--bg-0); }
  header { flex: none; display: flex; align-items: center; gap: 2px; padding: 4px 8px 4px 4px; background: var(--bg-1); }
  .title { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; padding: 6px 8px; text-align: left; }
  .title:hover { background: var(--bg-hover); }
  .caret { flex: none; color: var(--text-faint); }
  .caret.collapsed { transform: rotate(-90deg); }
  .name { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .count { font-size: 12px; color: var(--text-faint); }
  .mini { display: flex; gap: 3px; min-width: 0; overflow: hidden; margin-left: 4px; }

  /* Tile view: equal 16:9 tiles, centered, sized by the script to fill the stage */
  .tiles { flex: 1; min-height: 0; padding: 8px; display: flex; flex-direction: column; gap: 8px; overflow: hidden; }
  .row { flex: 1 1 0; min-height: 0; display: flex; gap: 8px; }
  .tile { position: relative; flex: 1 1 0; min-width: 0; min-height: 0; display: flex; align-items: center; justify-content: center; overflow: hidden;
    background: var(--bg-2); border: 2px solid transparent; transition: border-color 80ms; }
  .tile:hover { background: var(--bg-hover); }
  .tile.talking { border-color: var(--speaking); box-shadow: 0 0 0 1px var(--speaking), 0 0 18px -4px var(--speaking); }
  .tile.focused { border-color: var(--accent); }
  /* A camera fills its tile; your own is mirrored, the way a mirror shows you */
  .tile video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; background: #000; }
  .tile video.mirror { transform: scaleX(-1); }
  .icon-btn.live, .icon-btn.live:hover { color: var(--speaking); }
  .camgrid { position: relative; display: flex; flex-direction: column; flex: none; }
  /* Name tag over the lower left corner */
  .who { position: absolute; left: 4px; bottom: 4px; max-width: calc(100% - 8px); padding: 1px 6px; font-size: 12px; color: #fff; background: rgb(0 0 0 / 0.6);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tile.self .who { font-weight: 600; }
  .note { position: absolute; left: 0; right: 0; top: 4px; text-align: center; font-size: 11px; color: var(--text-dim); }
  .badge { position: absolute; top: 4px; right: 4px; display: inline-flex; padding: 2px; color: #fff; background: rgb(0 0 0 / 0.6); }
  .badge.admin { color: var(--danger); }
  .badge.live { color: var(--speaking); }
  .failed { flex: none; margin: 0; padding: 0 12px 8px; font-size: 12px; color: var(--danger); }

  .bar { flex: none; display: flex; align-items: center; gap: 8px; padding: 6px 12px; font-size: 13px; background: var(--bg-1); border-bottom: 1px solid var(--line); }
  .bar span { flex: 1; min-width: 0; }
  .bar.bad { color: var(--danger); }
  .btn.small, .bar .btn { padding: 4px 10px; font-size: 12px; flex: none; }
  .status { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--speaking); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; margin-right: 4px; }

  /* Meeting view: the chosen picture large, everyone in one row below */
  .spot { flex: 1; min-height: 0; display: flex; flex-direction: column; background: #000; }
  .spot-head { flex: none; display: flex; align-items: center; gap: 8px; padding: 2px 6px 2px 12px; background: var(--bg-0); color: var(--text-dim); font-size: 13px; }
  .spot-who { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); font-weight: 600; }
  .pic { position: relative; flex: 1; min-height: 0; display: flex; -webkit-touch-callout: none; user-select: none; }
  .pending { position: absolute; inset: 0; margin: 0; display: flex; align-items: center; justify-content: center; text-align: center; padding: 16px;
    color: #ddd; font-size: 13px; background: rgb(0 0 0 / 0.6); }
  .pending.bad { color: #ffb3ad; }
  .spot video { flex: 1; min-width: 0; min-height: 0; width: 100%; height: 100%; object-fit: contain; background: #000; display: block; }
  .away { flex: 1; margin: 0; display: flex; align-items: center; justify-content: center; color: #aaa; font-size: 13px; }
  .vol { width: 110px; flex: none; padding: 0; }
  /* Video only: the picture as wide as the chat, as tall as its shape asks */
  /* It gives way when the window is short, so the chat below keeps its last lines in view */
  .stage.solo { flex: 0 1 auto; background: #000; }
  .stage.solo .spot { flex: 0 1 auto; }
  .stage.solo .pic { flex: 0 1 auto; flex-direction: column; }
  .stage.solo .spot video { flex: 0 1 auto; height: auto; max-height: 62vh; }
  .stage.solo .away { flex: none; padding: 24px; }
  .wait { margin: 0; display: flex; align-items: center; gap: 8px; padding: 8px 12px; font-size: 13px; color: var(--text-dim); background: var(--bg-1); }
  .wait span { flex: 1; min-width: 0; }
  .wait.bad { color: var(--danger); }
  /* One row of a fixed height; tiles share the width and scroll sideways when there are many */
  .tiles.strip { flex: none; height: 92px; padding: 6px 8px; overflow-x: auto; overflow-y: hidden; }
  .tiles.strip .tile { flex: 1 0 120px; max-width: 220px; }
</style>
