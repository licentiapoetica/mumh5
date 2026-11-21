<script lang="ts">
  import Icon from './Icon.svelte';
  import Avatar from './Avatar.svelte';
  import AdminBadge from './AdminBadge.svelte';
  import RoleIcon from './RoleIcon.svelte';
  import { session, sessions } from '../lib/session.svelte.ts';
  import { ui } from '../lib/ui.svelte.ts';
  import { menu } from '../lib/menu.svelte.ts';
  import { store } from '../lib/settings.svelte.ts';
  import { userMenu } from '../lib/actions.ts';
  import { voice } from '../lib/audio/voice.svelte.ts';
  import { share } from '../lib/share.svelte.ts';
  import { renderIncoming } from '../lib/html.ts';
  import { roleTint } from '../core/roles.ts';

  // A person's card, next to what was clicked (a sheet at the bottom on phones)
  const open = $derived(ui.profile);
  const user = $derived(open ? session.user(open.session) : undefined);
  const isSelf = $derived(!!user && user.session === session.self?.session);
  const name = $derived(user ? store.displayName(user) : '');
  const talking = $derived(!!user && (voice.talking[user.session] || (isSelf && voice.transmitting)));
  const channelName = $derived(user ? session.channel(user.channelId)?.name || 'Root' : '');
  const sharing = $derived(user ? session.sharing[user.session] : undefined);
  const hue = $derived([...(user?.name ?? '')].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 360);

  // The description comes later when the server only announced its hash
  $effect(() => { if (user?.commentHash && !user.comment) session.loadComment(user.session); });
  const comment = $derived(user?.comment ? renderIncoming(user.comment, store.trustedHosts).html : '');
  const pending = $derived(!!user?.commentHash && !user.comment);

  // Its own attribute: a context menu opening or closing must not clear this one
  $effect(() => {
    const row = open?.row;
    row?.setAttribute('data-card-on', '');
    return () => row?.removeAttribute('data-card-on');
  });

  // Gone when the person left or the connection ended
  $effect(() => { if (open && (!user || session.status !== 'connected')) close(); });

  let el = $state<HTMLDivElement>();
  let pos = $state({ x: 0, y: 0 });
  let side = $state<'right' | 'left' | 'above'>('right');
  let sheet = $state(false);
  // Rows end a few pixels inside their list; the larger side gap keeps the card clear of the list's edge
  const GAP = 8, SIDE_GAP = 16, EDGE = 8;

  // What the card points at. A row as wide as the window (stacked layout) leaves no room beside it,
  // so the card goes beside the name in it, level with the row.
  function anchorBox(o: NonNullable<typeof open>): { left: number; right: number; top: number; bottom: number } {
    if (!o.el?.isConnected) return o.anchor;
    const row = o.el.getBoundingClientRect();
    if (row.width <= 360) return row;
    const label = o.el.querySelector('.label, .name, .pname, strong')?.getBoundingClientRect();
    if (!label?.width) return row;
    // The name's own width, not its box, which may stretch over the row
    const text = Math.min(label.width, measure(o.el.querySelector('.label, .name, .pname, strong')!));
    return { left: label.left, right: label.left + text, top: row.top, bottom: row.bottom };
  }
  function measure(node: Element): number {
    const range = document.createRange();
    range.selectNodeContents(node);
    return range.getBoundingClientRect().width;
  }

  // Like Discord: beside what was clicked, on the side toward the middle of the window, its top
  // level with the row and moved up only as far as the window needs. Your own panel at the bottom
  // opens it above, at the panel's left edge. It follows the row when the list scrolls.
  $effect(() => {
    const o = open;
    if (!o || !el) return;
    const place = () => {
      sheet = window.innerWidth < 560;
      if (sheet || !el) return;
      const a = anchorBox(o);
      const vw = window.innerWidth, vh = window.innerHeight, w = el.offsetWidth, h = el.offsetHeight;
      // The row scrolled out of sight: nothing left to point at
      if (o.el?.isConnected && (a.bottom < 0 || a.top > vh)) return close();
      let x: number, y: number;
      if (a.right - a.left >= 160 && a.top > vh * 0.6) {
        side = 'above';
        x = a.left;
        y = a.top - GAP - h;
      } else {
        const right = (a.left + a.right) / 2 < vw / 2;
        side = right ? 'right' : 'left';
        x = right ? a.right + SIDE_GAP : a.left - SIDE_GAP - w;
        if (right && x + w > vw - EDGE && a.left - SIDE_GAP - w >= EDGE) { x = a.left - SIDE_GAP - w; side = 'left'; }
        if (!right && x < EDGE && a.right + SIDE_GAP + w <= vw - EDGE) { x = a.right + SIDE_GAP; side = 'right'; }
        y = a.top;
      }
      pos = { x: Math.max(EDGE, Math.min(x, vw - w - EDGE)), y: Math.max(EDGE, Math.min(y, vh - h - EDGE)) };
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    // Scrolling anywhere but inside the card moves the row; follow it
    const scrolled = (e: Event) => { if (!el?.contains(e.target as Node)) place(); };
    document.addEventListener('scroll', scrolled, true);
    window.addEventListener('resize', place);
    return () => { ro.disconnect(); document.removeEventListener('scroll', scrolled, true); window.removeEventListener('resize', place); };
  });

  function close() {
    ui.profile = null;
  }

  // Outside the card closes it; the click still reaches what is under the pointer
  function outside(e: MouseEvent) {
    // Role switches in the side menu leave the card open behind them
    if (open && el && !el.contains(e.target as Node) && !(e.target as Element).closest?.('.menu.side')) close();
  }

  function message() {
    if (!user) return;
    session.selectView(`dm:${user.session}`);
    close();
  }
</script>

<svelte:window onmousedowncapture={outside} onkeydown={e => { if (open && !menu.open && e.key === 'Escape') close(); }} />

{#if open && user}
  {#if sheet}<button class="scrim" aria-label="Close" onclick={close}></button>{/if}
  <div class="card {side}" class:sheet role="dialog" tabindex="-1" aria-label="Profile of {name}" bind:this={el}
    style:left={sheet ? undefined : `${pos.x}px`} style:top={sheet ? undefined : `${pos.y}px`}
    oncontextmenu={e => menu.show(e, userMenu(user))}>
    <div class="banner" style:background="hsl({hue} 38% 30%)"></div>
    <div class="top">
      <span class="pic"><Avatar name={user.name} size={80} speaking={talking} src={session.avatar(user.session)} keep /></span>
    </div>
    <div class="body">
      <h3 style:color={session.roleColor(user)}>{name}</h3>
      <p class="sub">
        {#if name !== user.name}<span>{user.name}</span>{/if}
        <span>{#if session.isAdmin(user)}<AdminBadge size={13} /> {session.roleName('admin') ?? 'Admin'}{:else}{user.userId != null ? 'Registered' : 'Guest'}{/if}</span>
        {#if isSelf}<span>You</span>{/if}
      </p>
      <!-- Admin is already named on the line above -->
      {#if session.rolesFor(user).some(r => r.g !== 'admin')}
        <ul class="roles" aria-label="Roles">
          {#each session.rolesFor(user).filter(r => r.g !== 'admin') as r (r.g)}
            <li style:color={roleTint(r.c)}><RoleIcon role={r} size={13} /> {r.n}</li>
          {/each}
        </ul>
      {/if}
      {#if user.selfMute || user.mute || user.selfDeaf || user.deaf || user.prioritySpeaker || user.recording}
        <p class="flags">
          {#if user.selfDeaf || user.deaf}<span>{user.deaf ? 'Server deafened' : 'Deafened'}</span>
          {:else if user.selfMute || user.mute}<span>{user.mute ? 'Server muted' : 'Muted'}</span>{/if}
          {#if user.prioritySpeaker}<span>Priority speaker</span>{/if}
          {#if user.recording}<span class="bad">Recording</span>{/if}
        </p>
      {/if}

      <div class="box">
        <h4>In channel</h4>
        <p class="where"><Icon name="channel" size={14} /><span>{channelName}</span></p>
        {#if sharing}
          <p class="where live"><Icon name={sharing} size={14} /><span>{isSelf ? `Sharing your ${sharing}` : `Sharing their ${sharing}`}</span></p>
        {/if}
        <h4>Description</h4>
        {#if comment}
          <div class="html">{@html comment}</div>
        {:else if pending}
          <p class="dim">Loading...</p>
        {:else}
          <p class="dim">{isSelf ? 'You have no description yet.' : 'No description.'}</p>
        {/if}
      </div>

      {#if !isSelf}
        <div class="actions">
          <button class="btn primary" onclick={message}>Send message</button>
          {#if sharing}
            {#if share.watchOf(user.session)}<button class="btn" onclick={() => share.unwatch(user.session)}>Stop watching</button>
            {:else}<button class="btn" onclick={() => share.watch(sessions.active, user.session)}>Watch</button>{/if}
          {/if}
          <button class="btn icon" title="More" aria-label="More" onclick={e => menu.show(e, userMenu(user))}><Icon name="more" size={16} /></button>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .scrim { position: fixed; inset: 0; z-index: 90; background: rgb(0 0 0 / 0.5); }
  .card {
    position: fixed; z-index: 91; width: 320px; max-height: calc(100vh - 16px); overflow-y: auto;
    background: var(--bg-1); border: 1px solid var(--line-strong);
    animation: pop 130ms var(--ease);
  }
  /* Slides in from the side of what was clicked */
  .card.right { --from: translateX(-6px); }
  .card.left { --from: translateX(6px); }
  .card.above { --from: translateY(6px); }
  .card.sheet { left: 0; right: 0; bottom: 0; width: auto; max-height: 85vh; border-bottom: 0; padding-bottom: env(safe-area-inset-bottom); animation: up 160ms var(--ease); }
  .banner { height: 64px; }
  .top { position: relative; height: 48px; padding: 0 16px; }
  /* The picture sits over the edge of the banner, framed in the card's color */
  .pic { position: absolute; left: 14px; top: -44px; display: flex; border: 4px solid var(--bg-1); background: var(--bg-1); }
  .body { padding: 2px 16px 16px; }
  h3 { margin: 0; font-size: 20px; font-weight: 700; letter-spacing: -0.015em; overflow-wrap: anywhere; }
  .sub { display: flex; flex-wrap: wrap; gap: 0 10px; margin: 2px 0 0; font-size: 13px; color: var(--text-dim); }
  .sub span + span::before { content: ''; display: inline-block; width: 3px; height: 3px; margin: 0 10px 3px 0; background: var(--text-faint); }
  .roles { list-style: none; display: flex; flex-wrap: wrap; gap: 4px; margin: 8px 0 0; padding: 0; }
  .roles li { display: inline-flex; align-items: center; gap: 5px; min-height: 24px; padding: 0 7px; background: var(--bg-3); color: var(--text-dim); font-size: 12px; font-weight: 600; }
  .flags { display: flex; flex-wrap: wrap; gap: 4px; margin: 10px 0 0; }
  .flags span { font-size: 11px; font-weight: 500; padding: 0 6px; line-height: 20px; background: var(--bg-3); color: var(--text-dim); }
  .flags .bad { background: color-mix(in srgb, var(--danger) 16%, transparent); color: var(--danger); }
  .box { margin-top: 14px; padding: 10px 12px 12px; background: var(--bg-0); border: 1px solid var(--line); }
  h4 { margin: 10px 0 4px; font-size: 11px; font-weight: 650; text-transform: uppercase; letter-spacing: 0.07em; color: var(--text-faint); }
  h4:first-child { margin-top: 0; }
  .where { display: flex; align-items: center; gap: 6px; margin: 0; font-size: 14px; min-width: 0; }
  .where :global(svg) { flex: none; color: var(--text-faint); }
  .where span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .where.live, .where.live :global(svg) { color: var(--speaking); }
  .html { max-height: 220px; overflow-y: auto; font-size: 14px; overflow-wrap: anywhere; user-select: text; }
  .html :global(p) { margin: 0 0 6px; }
  .html :global(img) { max-width: 100%; }
  .dim { margin: 0; font-size: 14px; color: var(--text-dim); }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
  .actions .primary { flex: 1; }
  .btn.icon { padding: 8px 10px; }
  @keyframes pop { from { opacity: 0; transform: var(--from, none); } }
  @keyframes up { from { transform: translateY(24px); opacity: 0; } }
</style>
