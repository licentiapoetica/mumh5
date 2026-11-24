<script lang="ts">
  import Icon from './Icon.svelte';
  import Avatar from './Avatar.svelte';
  import ServerButton from './ServerButton.svelte';
  import { store } from '../lib/settings.svelte.ts';
  import { session, sessions } from '../lib/session.svelte.ts';
  import { ui } from '../lib/ui.svelte.ts';
  import { menu } from '../lib/menu.svelte.ts';
  import { userMenu, openProfile } from '../lib/actions.ts';
  import { voice } from '../lib/audio/voice.svelte.ts';
  import { share } from '../lib/share.svelte.ts';
  import { t } from '../lib/i18n.svelte.ts';
  import { normalizeToolbar, visibleToolbarItems } from '../core/toolbar.ts';

  // You and your buttons, under the channel list and on the start screen.
  // toolbar: the buttons in one row along the top (stacked layout, like the desktop client), you at the far end
  // inline: you and the buttons side by side in one row (the start screen, which is wide)
  let { toolbar = false, inline = false }: { toolbar?: boolean; inline?: boolean } = $props();

  const self = $derived(session.self);
  // Without a connection the buttons show the remembered choice, applied at the next connect
  const muted = $derived(self ? self.selfMute : sessions.mute);
  const deafened = $derived(self ? self.selfDeaf : sessions.deaf);

  // Sharing runs on one server at a time, one stream at a time; the buttons stop it from anywhere
  const canShareScreen = $derived(session.status === 'connected' && share.screenSupported(sessions.active));
  const canShare = $derived(session.status === 'connected' && share.supported(sessions.active));
  function toggleShare() {
    if (share.screenOn) share.stop();
    else share.start(sessions.active);
  }
  const cameraHint = $derived(share.cameraOn ? t('Turn off your camera') : share.screenOn ? t('Stop sharing your screen to turn on your camera') : t('Turn on your camera'));

  // One button for the whole tree. It follows the tree, which single channels can change too
  const allOpen = $derived(session.allExpanded);
  function toggleAll() {
    session.setAllExpanded(!allOpen);
  }

  // The server button stays first: with the rail hidden it is the way back to it
  const serverButton = $derived(toolbar && store.settings.railHidden);
  const showsYou = $derived(toolbar && !!self);
  const items = $derived(visibleToolbarItems(normalizeToolbar(store.settings.toolbar), serverButton, showsYou));
  // With only spacers after it, the name keeps the far corner
  const inCorner = (drawn: number) => items.slice(drawn + 1).every(s => s.item === 'sep');

  function editRequest(e: MouseEvent) {
    const at = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-tool]') : null;
    return { x: e.clientX, y: e.clientY, index: at ? Number(at.dataset.tool) : null, spacers: toolbar || inline, you: showsYou };
  }

  function customize(e: MouseEvent) {
    if (e.defaultPrevented) return; // mute and deafen have their own popup
    e.preventDefault();
    ui.toolbarEdit = editRequest(e);
  }

  function openQuick(e: MouseEvent, kind: 'input' | 'output') {
    e.preventDefault();
    const anchor = e.currentTarget as HTMLElement;
    const r = anchor.getBoundingClientRect();
    ui.quickAudio = { kind, anchor, x: r.left + r.width / 2, top: r.top, bottom: r.bottom, tools: editRequest(e) };
  }
</script>

<footer class="me" class:toolbar class:inline>
  {#if !toolbar}
    {#if self}
      <button class="profile" data-menu-row title={t('Your profile')} onclick={e => openProfile(self.session, e.currentTarget)}
        oncontextmenu={e => menu.show(e, userMenu(self))}>
        <Avatar name={store.displayName(self)} size={32} speaking={voice.transmitting} src={session.avatar(self.session)} keep />
        <span class="who">
          <strong>{store.displayName(self)}</strong>
          <span>{voice.error ? t('Voice unavailable') : voice.settings.mode === 'ptt' && !self.selfMute ? (voice.pttDown ? t('Talking') : t('Push to talk')) : session.channel(self.channelId)?.name || t('Root')}</span>
        </span>
      </button>
    {:else}
      <span class="who offline-who" title={t('Mute and deafen apply when you connect')}>
        <strong>{session.status === 'connecting' ? t('Connecting...') : t('Not connected')}</strong>
        <span>{deafened ? t('Deafened') : muted ? t('Muted') : t('Microphone on')}</span>
      </span>
    {/if}
  {/if}
  <div class="tools" role="presentation" oncontextmenu={customize}>
    {#if serverButton}<ServerButton />{/if}
    {#each items as { item, index }, drawn (index)}
      {#if item === 'sep'}
        <span class="sep" class:lead={serverButton && drawn === 0} data-tool={index}></span>
      {:else if item === 'info'}
        <button class="icon-btn info" data-tool={index} title={t('Server information')} aria-label={t('Server information')}
          disabled={session.status !== 'connected'} onclick={() => (ui.serverInfo = true)}>
          <Icon name="info" size={18} />
        </button>
      {:else if item === 'mic'}
        <button class="icon-btn" data-tool={index} class:on={muted} title={muted ? t('Unmute (right-click for microphone options)') : t('Mute (right-click for microphone options)')}
          aria-label={muted ? t('Unmute') : t('Mute')}
          onclick={() => session.setSelfMute(!muted)} oncontextmenu={e => openQuick(e, 'input')}>
          <Icon name={muted ? 'mic-off' : 'mic'} size={18} />
        </button>
      {:else if item === 'deafen'}
        <button class="icon-btn" data-tool={index} class:on={deafened} title={deafened ? t('Undeafen (right-click for output options)') : t('Deafen (right-click for output options)')}
          aria-label={deafened ? t('Undeafen') : t('Deafen')}
          onclick={() => session.setSelfDeaf(!deafened)} oncontextmenu={e => openQuick(e, 'output')}>
          <Icon name={deafened ? 'headphones-off' : 'headphones'} size={18} />
        </button>
      {:else if item === 'camera'}
        <button class="icon-btn" data-tool={index} class:live={share.cameraOn} aria-pressed={share.cameraOn} title={cameraHint}
          aria-label={share.cameraOn ? t('Turn off your camera') : t('Turn on your camera')}
          disabled={!share.cameraOn && (!canShare || share.screenOn || share.opening)} onclick={() => share.toggleCamera(sessions.active)}>
          <Icon name="camera" size={18} />
        </button>
      {:else if item === 'screen'}
        <button class="icon-btn" data-tool={index} class:live={share.screenOn} title={share.screenOn ? t('Stop sharing your screen') : share.cameraOn ? t('Turn off your camera to share your screen') : t('Share your screen or camera with your channel')}
          aria-label={share.screenOn ? t('Stop sharing your screen') : t('Share your screen or camera')} disabled={!share.screenOn && (!canShareScreen || share.cameraOn)} onclick={toggleShare}>
          <Icon name="screen" size={18} />
        </button>
      {:else if item === 'profile'}
        <button class="icon-btn" data-tool={index} title={t('Edit your profile')} aria-label={t('Edit your profile')} disabled={!self} onclick={() => (ui.profileEdit = true)}>
          <Icon name="message" size={18} />
        </button>
      {:else if item === 'settings'}
        <button class="icon-btn" data-tool={index} title={t('Configure')} aria-label={t('Configure')} onclick={() => (ui.settingsOpen = true)}>
          <Icon name="settings" size={18} />
        </button>
      {:else if item === 'tree'}
        <button class="icon-btn" data-tool={index} title={allOpen ? t('Collapse all channels') : t('Expand all channels')} aria-label={allOpen ? t('Collapse all channels') : t('Expand all channels')}
          disabled={session.status !== 'connected'} onclick={toggleAll}>
          <Icon name="filter" size={18} />
        </button>
      {:else if item === 'you' && self}
        <!-- Who you are; the name gives way to the buttons when narrow -->
        <span class="you" class:corner={inCorner(drawn)} data-tool={index}>
          <button class="profile" data-menu-row title={t('Your profile')} onclick={e => openProfile(self.session, e.currentTarget)}
            oncontextmenu={e => menu.show(e, userMenu(self))}>
            <span class="who">
              <strong>{store.displayName(self)}</strong>
              <!-- Not shown, but screen readers still hear where you are -->
              <span class="sr-only">{session.channel(self.channelId)?.name || t('Root')}</span>
            </span>
            <Avatar name={store.displayName(self)} size={28} speaking={voice.transmitting} src={session.avatar(self.session)} keep />
          </button>
        </span>
      {/if}
    {/each}
  </div>
</footer>

<style>
  /* You on top, the buttons in one row below, spread over the width */
  .me { flex: none; display: flex; flex-direction: column; gap: 4px; padding: 6px 8px 6px; background: var(--bg-0); border-top: 1px solid var(--line); }
  /* Keeps a place to right-click when every button is hidden */
  .tools { min-height: 30px; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; }
  .sep { width: 1px; height: 18px; background: var(--line); }
  /* Under the channel list the buttons are evenly spread, without dividers */
  .me:not(.toolbar, .inline) .sep { display: none; }
  /* Eight buttons fit the default width (260px) in one row */
  .tools .icon-btn { width: 30px; }
  /* Stacked layout: the bar leads the stack, like the desktop client's toolbar */
  /* 8px above the row and, with the border, 8px below: the first server tile lines up with it */
  .me.toolbar { order: -1; min-height: var(--footer-h); justify-content: center; padding-block: 8px 7px; border-top: 0; border-bottom: 1px solid var(--line); }
  .me.toolbar .tools { justify-content: flex-start; gap: 2px; }
  .me.toolbar .sep { margin: 0 6px; }
  /* The server tile is filled to its edge, an icon sits 6px inside its button */
  .me.toolbar .sep.lead { margin-left: 12px; }
  /* Between the buttons it takes its own width, up to a limit */
  .me.toolbar .you { flex: 0 1 auto; min-width: 32px; max-width: 180px; display: flex; margin: 0 4px; }
  /* In the corner: basis 0 so it never pushes the buttons onto a second row; the avatar alone stays */
  .me.toolbar .you.corner { flex: 1 1 0; max-width: none; justify-content: flex-end; margin: 0 0 0 8px; }
  .me.toolbar .you .profile { max-width: 100%; gap: 8px; padding: 2px 4px; }
  .me.toolbar .you.corner .who { text-align: right; }
  /* Between the buttons on a narrow window, only the picture, so the row does not wrap */
  @media (max-width: 640px) { .me.toolbar .you:not(.corner) .who { display: none; } }
  .me.toolbar .you .who strong { font-size: 13px; font-weight: 500; }
  .me.inline { flex-direction: row; flex-wrap: wrap; align-items: center; gap: 4px 16px; padding: 6px 16px; }
  .me.inline .profile, .me.inline .offline-who { flex: 0 1 220px; }
  .me.inline .tools { justify-content: flex-start; gap: 2px; }
  .me.inline .sep { margin: 0 6px; }
  .profile { min-width: 0; display: flex; align-items: center; gap: 10px; padding: 4px; text-align: left; transition: background 120ms var(--ease); }
  .profile:hover { background: var(--bg-hover); }
  .who { flex: 1; min-width: 0; display: flex; flex-direction: column; line-height: 1.25; }
  .who strong, .who span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .who strong { font-weight: 600; }
  .who span { font-size: 12px; color: var(--text-dim); }
  .info, .info:hover { color: var(--warn); }
  .live, .live:hover { color: var(--speaking); }
  .offline-who { padding: 4px 4px 4px 6px; color: var(--text-dim); }
</style>
