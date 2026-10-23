<script lang="ts">
  import Icon from './Icon.svelte';
  import Avatar from './Avatar.svelte';
  import { session, sessions } from '../lib/session.svelte.ts';
  import { ui } from '../lib/ui.svelte.ts';
  import { menu } from '../lib/menu.svelte.ts';
  import { userMenu, openProfile } from '../lib/actions.ts';
  import { voice } from '../lib/audio/voice.svelte.ts';
  import { share } from '../lib/share.svelte.ts';

  // You and your buttons, under the channel list and on the start screen.
  // toolbar: the buttons alone in one row along the top (stacked layout, like the desktop client)
  // inline: you and the buttons side by side in one row (the start screen, which is wide)
  let { toolbar = false, inline = false }: { toolbar?: boolean; inline?: boolean } = $props();

  const self = $derived(session.self);
  // Without a connection the buttons show the remembered choice, applied at the next connect
  const muted = $derived(self ? self.selfMute : sessions.mute);
  const deafened = $derived(self ? self.selfDeaf : sessions.deaf);

  function editDescription() {
    if (!self) return;
    session.showUser(self.session);
    ui.editDescription = true;
    ui.panelOpen = true;
  }

  // Sharing runs on one server at a time; the button stops it from anywhere
  const sharingHere = $derived(!!share.stream);
  const canShare = $derived(session.status === 'connected' && share.supported(sessions.active));
  function toggleShare() {
    if (share.stream) share.stop();
    else share.start(sessions.active);
  }

  // One button for the whole tree: open everything, then close everything
  let allOpen = $state(false);
  function toggleAll() {
    allOpen = !allOpen;
    session.setAllExpanded(allOpen);
  }

  function openQuick(e: MouseEvent, kind: 'input' | 'output') {
    e.preventDefault();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    ui.quickAudio = { kind, x: r.left + r.width / 2, y: r.top };
  }
</script>

<footer class="me" class:toolbar class:inline>
  {#if !toolbar}
    {#if self}
      <button class="profile" title="Your profile" onclick={e => openProfile(self.session, e.currentTarget)}
        oncontextmenu={e => menu.show(e, userMenu(self))}>
        <Avatar name={self.name} size={32} speaking={voice.transmitting} src={session.avatar(self.session)} />
        <span class="who">
          <strong>{self.name}</strong>
          <span>{voice.error ? 'Voice unavailable' : voice.settings.mode === 'ptt' && !self.selfMute ? (voice.pttDown ? 'Talking' : 'Push to talk') : session.channel(self.channelId)?.name || 'Root'}</span>
        </span>
      </button>
    {:else}
      <span class="who offline-who" title="Mute and deafen apply when you connect">
        <strong>{session.status === 'connecting' ? 'Connecting...' : 'Not connected'}</strong>
        <span>{deafened ? 'Deafened' : muted ? 'Muted' : 'Microphone on'}</span>
      </span>
    {/if}
  {/if}
  <div class="tools">
    <button class="icon-btn info" title="Server information" aria-label="Server information"
      disabled={session.status !== 'connected'} onclick={() => (ui.serverInfo = true)}>
      <Icon name="info" size={18} />
    </button>
    <button class="icon-btn" class:on={muted} title={muted ? 'Unmute (right-click for microphone options)' : 'Mute (right-click for microphone options)'}
      aria-label={muted ? 'Unmute' : 'Mute'}
      onclick={() => session.setSelfMute(!muted)} oncontextmenu={e => openQuick(e, 'input')}>
      <Icon name={muted ? 'mic-off' : 'mic'} size={18} />
    </button>
    <button class="icon-btn" class:on={deafened} title={deafened ? 'Undeafen (right-click for output options)' : 'Deafen (right-click for output options)'}
      aria-label={deafened ? 'Undeafen' : 'Deafen'}
      onclick={() => session.setSelfDeaf(!deafened)} oncontextmenu={e => openQuick(e, 'output')}>
      <Icon name={deafened ? 'headphones-off' : 'headphones'} size={18} />
    </button>
    <button class="icon-btn" class:live={sharingHere} title={sharingHere ? `Stop sharing your ${share.kind}` : 'Share your screen or camera with your channel'}
      aria-label={sharingHere ? `Stop sharing your ${share.kind}` : 'Share your screen or camera'} disabled={!sharingHere && !canShare} onclick={toggleShare}>
      <Icon name={sharingHere ? share.kind : 'screen'} size={18} />
    </button>
    <span class="sep"></span>
    <button class="icon-btn" title="Change your description" aria-label="Change your description" disabled={!self} onclick={editDescription}>
      <Icon name="message" size={18} />
    </button>
    <span class="sep"></span>
    <button class="icon-btn" title="Configure" aria-label="Configure" onclick={() => (ui.settingsOpen = true)}>
      <Icon name="settings" size={18} />
    </button>
    <span class="sep"></span>
    <button class="icon-btn" title={allOpen ? 'Collapse all channels' : 'Expand all channels'} aria-label={allOpen ? 'Collapse all channels' : 'Expand all channels'}
      disabled={session.status !== 'connected'} onclick={toggleAll}>
      <Icon name="filter" size={18} />
    </button>
  </div>
</footer>

<style>
  /* You on top, the buttons in one row below, spread over the width */
  .me { flex: none; display: flex; flex-direction: column; gap: 4px; padding: 6px 8px 6px; background: var(--bg-0); border-top: 1px solid var(--line); }
  .tools { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; }
  .sep { width: 1px; height: 18px; background: var(--line); }
  /* Eight buttons and three dividers fit the default width (260px) in one row */
  .tools .icon-btn { width: 30px; }
  /* Stacked layout: the bar leads the stack, like the desktop client's toolbar */
  .me.toolbar { order: -1; min-height: var(--footer-h); justify-content: center; border-top: 0; border-bottom: 1px solid var(--line); }
  .me.toolbar .tools { justify-content: flex-start; gap: 2px; }
  .me.toolbar .sep { margin: 0 6px; }
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
