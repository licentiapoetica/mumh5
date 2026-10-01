<script lang="ts">
  import Icon from './Icon.svelte';
  import { share } from '../lib/share.svelte.ts';
  import { session } from '../lib/session.svelte.ts';
  import { store } from '../lib/settings.svelte.ts';

  // Above the chat: the stream being watched, and a note while we are sharing ourselves
  const watching = $derived(share.watching && share.watching.host.server?.id === session.server?.id ? share.watching : null);
  const sharer = $derived(watching ? session.user(watching.session) : undefined);
  const mine = $derived(share.stream && share.host?.server?.id === session.server?.id);

  let video = $state<HTMLVideoElement>();
  let frame = $state<HTMLElement>();
  $effect(() => { if (video) video.srcObject = watching?.stream ?? null; });

  function fullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else frame?.requestFullscreen().catch(() => {});
  }
</script>

{#if mine}
  <div class="bar" role="status">
    <Icon name="screen" size={16} />
    <span>You are sharing your screen{share.viewers ? `, ${share.viewers} watching` : ''}</span>
    <button class="btn" onclick={() => share.stop()}>Stop sharing</button>
  </div>
{/if}
{#if share.error}<div class="bar bad" role="alert"><span>{share.error}</span><button class="btn" onclick={() => (share.error = '')}>Dismiss</button></div>{/if}

{#if watching}
  <section class="watch" aria-label="Screen share" bind:this={frame}>
    <header>
      <Icon name="screen" size={16} />
      <span class="who">{sharer ? store.displayName(sharer) : 'Screen share'}</span>
      <button class="icon-btn" title="Full screen" aria-label="Full screen" onclick={fullscreen}><Icon name="expand" size={16} /></button>
      <button class="icon-btn" title="Stop watching" aria-label="Stop watching" onclick={() => share.unwatch()}><Icon name="x" size={16} /></button>
    </header>
    <div class="stagebox">
      <!-- svelte-ignore a11y_media_has_caption -->
      <video bind:this={video} autoplay playsinline muted ondblclick={fullscreen}></video>
      {#if watching.state === 'connecting'}<p class="note">Connecting...</p>
      {:else if watching.state === 'failed'}<p class="note">Could not connect. You and the other person may both be behind routers that block direct connections; a STUN server in Settings, Voice can help.</p>{/if}
    </div>
  </section>
{/if}

<style>
  .bar { flex: none; display: flex; align-items: center; gap: 8px; padding: 6px 12px; font-size: 13px; background: var(--bg-1); border-bottom: 1px solid var(--line); color: var(--text-dim); }
  .bar span { flex: 1; min-width: 0; }
  .bar .btn { padding: 4px 10px; font-size: 12px; }
  .bar.bad { color: var(--danger); }
  .watch { flex: none; display: flex; flex-direction: column; max-height: 62%; min-height: 160px; background: #000; border-bottom: 1px solid var(--line); }
  .watch header { flex: none; display: flex; align-items: center; gap: 8px; padding: 2px 6px 2px 12px; background: var(--bg-1); color: var(--text-dim); font-size: 13px; }
  .who { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); font-weight: 600; }
  .stagebox { position: relative; flex: 1; min-height: 0; display: flex; }
  video { width: 100%; height: 100%; min-height: 0; object-fit: contain; background: #000; display: block; }
  .note { position: absolute; inset: 0; margin: 0; display: flex; align-items: center; justify-content: center; text-align: center; padding: 16px; color: #ddd; font-size: 14px; }
  .watch:fullscreen { max-height: none; }
</style>
