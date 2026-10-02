<script lang="ts">
  import VoiceStage from '../ui/VoiceStage.svelte';
  import VoiceControls from './VoiceControls.svelte';
  import { session, sessions } from '../lib/session.svelte.ts';
  import { voice } from '../lib/audio/voice.svelte.ts';

  // The room you are in as a call: everyone as tiles, streams large, the controls underneath
  let { onrooms, onchat }: { onrooms: () => void; onchat: () => void } = $props();

  const self = $derived(session.self);
  const room = $derived(self ? session.channel(self.channelId) : undefined);
  const elsewhere = $derived(!!self && !!sessions.voiceSession && sessions.voiceSession !== sessions.active);
  const transport = $derived(session.voiceTransport);
</script>

<section class="voice" aria-label="Voice">
  {#if self}
    <header>
      <div class="title">
        <h1>{room?.name || 'Root'}</h1>
        <span>{session.usersIn(self.channelId).length} here, voice over {transport.udp ? 'UDP' : 'TCP'}{#if voice.error}, voice unavailable{/if}</span>
      </div>
      <button class="btn" onclick={() => { session.selectView(`ch:${self.channelId}`); onchat(); }}>Chat</button>
    </header>
    {#if voice.error}<p class="note bad">{voice.error}</p>{/if}
    {#if elsewhere}
      <p class="note">Voice is on {sessions.voiceSession?.server?.label}; you are deafened here.
        <button class="btn" onclick={() => sessions.setVoice(sessions.active)}>Talk here</button></p>
    {/if}
    <div class="stage"><VoiceStage always fill /></div>
    <footer><VoiceControls large /></footer>
  {:else}
    <div class="blank">
      <h1>Voice</h1>
      <p>Connect to a server and join a room to talk.</p>
      <button class="btn primary" onclick={onrooms}>Go to rooms</button>
    </div>
  {/if}
</section>

<style>
  .voice { height: 100%; min-height: 0; display: flex; flex-direction: column; background: var(--bg-2); }
  header { flex: none; display: flex; align-items: center; gap: 12px; padding: 14px 16px 10px; }
  .title { flex: 1; min-width: 0; }
  h1 { margin: 0; font-size: 24px; line-height: 1.2; letter-spacing: -0.01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .title span { font-size: 13px; color: var(--text-dim); }
  .note { flex: none; display: flex; align-items: center; gap: 12px; margin: 0 16px 8px; padding: 8px 12px; font-size: 14px; color: var(--text-dim); background: var(--bg-0); border: 1px solid var(--line); }
  .note.bad { color: var(--danger); }
  .stage { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  footer { flex: none; padding: 12px 16px 16px; border-top: 1px solid var(--line); background: var(--bg-1); }
  .blank { padding: 32px 16px; color: var(--text-dim); }
  .blank h1 { color: var(--text); }
  .blank p { margin: 6px 0 14px; }
</style>
