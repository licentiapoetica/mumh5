<script lang="ts">
  import Avatar from '../ui/Avatar.svelte';
  import VoiceControls from './VoiceControls.svelte';
  import { session, sessions } from '../lib/session.svelte.ts';
  import { voice } from '../lib/audio/voice.svelte.ts';
  import { store } from '../lib/settings.svelte.ts';

  // Always in reach: the room you are in, who is talking, and the two buttons that matter
  let { onopen }: { onopen: () => void } = $props();

  const self = $derived(session.self);
  const elsewhere = $derived(!!self && !!sessions.voiceSession && sessions.voiceSession !== sessions.active);
  const room = $derived(self ? session.channel(self.channelId)?.name || 'Root' : '');
  const speakers = $derived(self ? session.usersIn(self.channelId).filter(u => u.session !== self.session && voice.talking[u.session]) : []);
  const line = $derived.by(() => {
    if (!self) return session.status === 'connecting' ? 'Connecting...' : 'Not connected';
    if (voice.error) return 'Voice unavailable';
    if (elsewhere) return `Voice is on ${sessions.voiceSession?.server?.label}`;
    if (speakers.length) return `${speakers.slice(0, 2).map(u => store.displayName(u)).join(', ')}${speakers.length > 2 ? ` +${speakers.length - 2}` : ''} talking`;
    if (voice.settings.mode === 'ptt' && !self.selfMute) return voice.pttDown ? 'Talking' : 'Push to talk';
    const n = session.usersIn(self.channelId).length;
    return n === 1 ? 'Only you here' : `${n} people here`;
  });
</script>

<div class="dock" class:talking={voice.transmitting}>
  <button class="where" onclick={onopen} disabled={!self} title="Open the voice screen">
    {#if self}<Avatar name={self.name} size={36} speaking={voice.transmitting} src={session.avatar(self.session)} />{/if}
    <span class="text">
      <strong>{self ? room : 'mumh5'}</strong>
      <span>{line}</span>
    </span>
  </button>
  {#if elsewhere}
    <button class="btn" onclick={() => sessions.setVoice(sessions.active)}>Talk here</button>
  {:else}
    <VoiceControls />
  {/if}
</div>

<style>
  .dock { flex: none; display: flex; align-items: center; gap: 8px; min-height: 60px; padding: 8px 12px; background: var(--bg-0); border-top: 1px solid var(--line); box-shadow: inset 0 2px 0 transparent; }
  .dock.talking { box-shadow: inset 0 2px 0 var(--speaking); }
  .where { flex: 1; min-width: 0; display: flex; align-items: center; gap: 12px; text-align: left; }
  .where:disabled { opacity: 1; }
  .text { min-width: 0; display: flex; flex-direction: column; line-height: 1.25; }
  .text strong, .text span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .text span { font-size: 13px; color: var(--text-dim); }
  .btn { flex: none; }
</style>
