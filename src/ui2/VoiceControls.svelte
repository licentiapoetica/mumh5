<script lang="ts">
  import Icon from '../ui/Icon.svelte';
  import { session, sessions } from '../lib/session.svelte.ts';
  import { ui } from '../lib/ui.svelte.ts';
  import { share } from '../lib/share.svelte.ts';

  // Mute, deafen and share. large: the voice screen's row of big buttons with labels.
  let { large = false }: { large?: boolean } = $props();

  const self = $derived(session.self);
  // Without a connection the buttons show the remembered choice, applied at the next connect
  const muted = $derived(self ? self.selfMute : sessions.mute);
  const deafened = $derived(self ? self.selfDeaf : sessions.deaf);
  const sharing = $derived(!!share.stream);
  const canShare = $derived(session.status === 'connected' && share.supported(sessions.active));

  function quick(e: MouseEvent, kind: 'input' | 'output') {
    e.preventDefault();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    ui.quickAudio = { kind, x: r.left + r.width / 2, y: r.top };
  }
</script>

<div class="controls" class:large>
  <button class:on={muted} aria-label={muted ? 'Unmute' : 'Mute'} title={muted ? 'Unmute (hold or right-click for microphone options)' : 'Mute (hold or right-click for microphone options)'}
    onclick={() => session.setSelfMute(!muted)} oncontextmenu={e => quick(e, 'input')}>
    <Icon name={muted ? 'mic-off' : 'mic'} size={large ? 24 : 20} />
    {#if large}<span>{muted ? 'Muted' : 'Mute'}</span>{/if}
  </button>
  <button class:on={deafened} aria-label={deafened ? 'Undeafen' : 'Deafen'} title={deafened ? 'Undeafen (hold or right-click for output options)' : 'Deafen (hold or right-click for output options)'}
    onclick={() => session.setSelfDeaf(!deafened)} oncontextmenu={e => quick(e, 'output')}>
    <Icon name={deafened ? 'headphones-off' : 'headphones'} size={large ? 24 : 20} />
    {#if large}<span>{deafened ? 'Deafened' : 'Deafen'}</span>{/if}
  </button>
  {#if large}
    <button class:live={sharing} disabled={!sharing && !canShare} aria-label={sharing ? `Stop sharing your ${share.kind}` : 'Share your screen or camera'}
      title={sharing ? `Stop sharing your ${share.kind}` : 'Share your screen or camera with your channel'}
      onclick={() => (sharing ? share.stop() : share.start(sessions.active))}>
      <Icon name={sharing ? share.kind : 'screen'} size={24} />
      <span>{sharing ? 'Stop sharing' : 'Share'}</span>
    </button>
  {/if}
</div>

<style>
  .controls { display: flex; gap: 4px; }
  button { width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; color: var(--text); background: var(--bg-3); }
  button:hover:not(:disabled) { background: var(--bg-active); }
  button.on { background: var(--danger); color: #fff; }
  button.live { background: var(--speaking); color: var(--bg-0); }
  .large { gap: 10px; justify-content: center; }
  .large button { width: 96px; height: 72px; flex-direction: column; gap: 6px; font-size: 13px; font-weight: 600; }
</style>
