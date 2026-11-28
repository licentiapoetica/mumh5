<script lang="ts">
  import Icon from './Icon.svelte';
  import { t } from '../lib/i18n.svelte.ts';
  import { menu, type MenuItem } from '../lib/menu.svelte.ts';
  import { messageItems } from '../lib/text-menu.ts';
  import { store } from '../lib/settings.svelte.ts';

  let { kind, url, name, autoplay = false, onerror }: {
    kind: 'audio' | 'video'; url: string; name: string; autoplay?: boolean; onerror?: () => void;
  } = $props();
  let media = $state<HTMLMediaElement>();
  let player = $state<HTMLDivElement>();
  let paused = $state(true), currentTime = $state(0), duration = $state(0);
  let muted = $state(false), loop = $state(false), error = $state('');
  // One volume for every player, kept for the next one; muting and looping are per player
  // A saved value out of range would make every player throw
  const volume = $derived(Math.min(1, Math.max(0, Number(store.settings.mediaVolume) || 0)));
  $effect(() => { if (media) media.volume = volume; });
  const length = $derived(Number.isFinite(duration) ? duration : 0);

  function time(seconds: number): string {
    const n = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
    return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
  }
  async function toggle() {
    if (!media) return;
    if (!media.paused) { media.pause(); return; }
    try { await media.play(); error = ''; } catch { error = 'Could not play this file.'; }
  }
  function setVolume(v: number) { store.settings.mediaVolume = v; muted = false; }
  // Its own menu replaces the one the message would have, so the message's items come along
  function contextMenu(e: MouseEvent) {
    const items: MenuItem[] = [{ label: t('player.loop'), checked: loop, action: () => (loop = !loop) }];
    const video = kind === 'video' ? media as HTMLVideoElement | undefined : undefined;
    if (video && document.pictureInPictureEnabled) items.push({ label: 'Picture in picture', action: () => { video.requestPictureInPicture().catch(() => {}); } });
    if (/^https?:/i.test(url)) items.push({ separator: true, label: '' }, { label: 'Copy link address', action: () => navigator.clipboard.writeText(url) });
    const message = messageItems(e.currentTarget as Element);
    if (message.length) items.push({ separator: true, label: '' }, ...message);
    menu.show(e, items);
  }
  // A double click goes full screen; its second click must not toggle playback back
  function surfaceClick(e: MouseEvent) { if (e.detail <= 1) toggle(); }
  function failed() { error = 'Could not play this file.'; onerror?.(); }
  async function fullscreen() {
    try {
      if (document.fullscreenElement === player) await document.exitFullscreen();
      else await player?.requestFullscreen();
    } catch { /* fullscreen may be unavailable in an embedded browser */ }
  }
</script>

<div class="media-player" class:video={kind === 'video'} role="group" aria-label={name} bind:this={player} oncontextmenu={contextMenu}>
  {#if kind === 'video'}
    <div class="stage">
      <video src={url} aria-label={name} bind:this={media} bind:paused bind:currentTime bind:duration bind:muted
        {autoplay} {loop} preload="metadata" playsinline onerror={failed}><track kind="captions" /></video>
      <!-- For the pointer only: keyboards and screen readers have the button below -->
      <button class="surface" tabindex="-1" aria-hidden="true" onmousedown={e => e.preventDefault()} onclick={surfaceClick} ondblclick={fullscreen}>
        {#if paused}<span><Icon name="play" size={22} /></span>{/if}
      </button>
    </div>
  {:else}
    <audio src={url} aria-label={name} bind:this={media} bind:paused bind:currentTime bind:duration bind:muted
      {autoplay} {loop} preload="metadata" onerror={failed}></audio>
  {/if}
  <div class="player-controls" role="group" aria-label="Player for {name}">
    <input class="seek" type="range" min="0" max={length || 1} step="0.01" value={Math.min(currentTime, length)} disabled={!length}
      aria-label="Seek in {name}" aria-valuetext="{time(currentTime)} of {time(length)}"
      oninput={e => { if (media) media.currentTime = Number(e.currentTarget.value); }} />
    <div class="buttons">
      <button class="control" onclick={toggle} aria-label="{paused ? 'Play' : 'Pause'} {name}" title={paused ? 'Play' : 'Pause'}>
        <Icon name={paused ? 'play' : 'pause'} size={18} />
      </button>
      <span class="time">{time(currentTime)} <span>/ {time(length)}</span></span>
      <button class="control" onclick={() => (muted = !muted)} aria-label="{muted ? 'Unmute' : 'Mute'} {name}" title={muted ? 'Unmute' : 'Mute'}>
        <Icon name={muted || !volume ? 'volume-off' : 'volume'} size={16} />
      </button>
      <input class="volume" type="range" min="0" max="1" step="0.01" value={volume} aria-label="Volume for {name}"
        oninput={e => setVolume(Number(e.currentTarget.value))} onchange={() => store.saveSettings()} />
      {#if kind === 'video'}<button class="control" onclick={fullscreen} aria-label="Fullscreen {name}" title="Fullscreen"><Icon name="expand" size={16} /></button>{/if}
    </div>
    {#if error}<p role="status">{error}</p>{/if}
  </div>
</div>

<style>
  .media-player { min-width: 0; background: var(--bg-1); }
  audio { display: none; }
  video { display: block; width: 100%; max-height: 360px; object-fit: contain; background: var(--bg-0); }
  .stage { position: relative; }
  .surface { position: absolute; inset: 0; display: grid; place-items: center; cursor: pointer; }
  .surface span { display: grid; place-items: center; width: 52px; height: 52px; color: var(--text); background: var(--bg-1); border: 1px solid var(--line-strong); }
  .player-controls { padding: 4px 10px 8px; border-top: 1px solid var(--line); }
  input[type='range'] { display: block; height: 16px; padding: 0; appearance: none; background: transparent; border: 0; box-shadow: none; cursor: pointer; }
  input[type='range']::-webkit-slider-runnable-track { height: 3px; background: var(--line-strong); }
  input[type='range']::-webkit-slider-thumb { appearance: none; width: 12px; height: 12px; margin-top: -4.5px; border-radius: 50% !important; background: var(--accent); }
  input[type='range']::-moz-range-track { height: 3px; background: var(--line-strong); }
  input[type='range']::-moz-range-thumb { width: 12px; height: 12px; border: 0; border-radius: 50% !important; background: var(--accent); }
  input:disabled { cursor: default; }
  .seek { width: 100%; margin: 2px 0 4px; }
  .buttons { display: flex; align-items: center; gap: 4px; }
  .control { flex: none; width: 32px; height: 32px; display: grid; place-items: center; color: var(--text-dim); }
  .control:hover { color: var(--text); background: var(--bg-hover); }
  .time { flex: 1; min-width: 0; white-space: nowrap; font-size: 12px; font-variant-numeric: tabular-nums; color: var(--text); }
  .time span { color: var(--text-faint); }
  .volume { flex: none; width: 60px; margin: 0 4px; }
  p { margin: 4px 0 0; font-size: 12px; color: var(--danger); }
  .media-player:fullscreen { width: 100%; height: 100%; display: flex; flex-direction: column; justify-content: center; }
  .media-player:fullscreen .stage { flex: 1; min-height: 0; }
  .media-player:fullscreen video { height: 100%; max-height: none; }
  .media-player:fullscreen .player-controls { flex: none; }
  @media (max-width: 480px) { .player-controls { padding-inline: 6px; } .volume { width: 42px; margin-inline: 0; } }
</style>
