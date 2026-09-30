<script lang="ts">
  import Icon from './Icon.svelte';
  import { store } from '../lib/settings.svelte.ts';

  let { videoId, start = 0, url }: { videoId: string; start?: number; url: string } = $props();

  // Nothing is loaded from YouTube until the user clicks (unless thumbnails are enabled)
  let playing = $state(false);
  const src = $derived(`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0${start ? `&start=${start}` : ''}`);
  const thumb = $derived(store.settings.youtube === 'thumbnail' ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : '');
</script>

<div class="yt">
  {#if playing}
    <iframe {src} title="YouTube video" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen
      referrerpolicy="strict-origin-when-cross-origin" sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"></iframe>
  {:else}
    <button class="facade" style:background-image={thumb ? `url(${thumb})` : undefined} onclick={() => (playing = true)}
      title="Play here (loads from YouTube)">
      <span class="play"><svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4l14 8-14 8z" fill="currentColor" /></svg></span>
      <span class="label">
        <strong>YouTube</strong>
        <span>{start ? `from ${Math.floor(start / 60)}:${String(start % 60).padStart(2, '0')}, ` : ''}click to play</span>
      </span>
    </button>
  {/if}
  <a class="open" href={url} target="_blank" rel="noopener noreferrer" title="Open on YouTube"><Icon name="link" size={14} /></a>
</div>

<style>
  .yt { position: relative; width: min(480px, 100%); aspect-ratio: 16 / 9; background: #000; border: 1px solid var(--line); }
  iframe { display: block; width: 100%; height: 100%; border: 0; }
  .facade { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px;
    background: #111 center / cover no-repeat; color: #fff; }
  .facade::before { content: ''; position: absolute; inset: 0; background: linear-gradient(transparent 40%, rgb(0 0 0 / 0.7)); }
  .play { position: relative; width: 64px; height: 44px; display: flex; align-items: center; justify-content: center; background: #e0443e; transition: transform 100ms; }
  .facade:hover .play { transform: scale(1.08); }
  .label { position: relative; display: flex; flex-direction: column; align-items: center; font-size: 13px; text-shadow: 0 1px 2px #000; }
  .label span { color: #ddd; }
  .open { position: absolute; top: 6px; right: 6px; width: 26px; height: 26px; display: flex; align-items: center; justify-content: center; background: rgb(0 0 0 / 0.6); color: #fff; }
  .open:hover { background: rgb(0 0 0 / 0.85); text-decoration: none; }
</style>
