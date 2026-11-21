<script lang="ts">
  import Icon from './Icon.svelte';
  import { store } from '../lib/settings.svelte.ts';

  let { kind, url, name }: { kind: 'image' | 'video' | 'audio'; url: string; name: string } = $props();

  const host = $derived(new URL(url).host.toLowerCase());
  // Listed hosts load at once; anything else waits for a click, so opening a chat contacts nobody new
  const trusted = $derived(store.trustedHosts.includes(host));
  let clicked = $state(false);
  let failed = $state(false);
  const shown = $derived(trusted || clicked);
  const noun = $derived(kind === 'image' ? 'Picture' : kind === 'video' ? 'Video' : 'Sound');
  const icon = $derived(kind === 'image' ? 'image' : kind === 'video' ? 'screen' : 'headphones');
</script>

{#if !shown}
  <div class="ask">
    <button class="load" onclick={() => (clicked = true)} title="Loads from {host}, which sees your IP address">
      <span class="icon"><Icon name={icon} size={18} /></span>
      <span class="text"><strong>{name || host}</strong><span>{noun} from {host}, click to {kind === 'image' ? 'show' : 'play'}</span></span>
    </button>
    <button class="always" onclick={() => store.trustHost(host)} title="Adds {host} to the hosts in Settings, Chat and files">Always from this host</button>
  </div>
{:else if failed}
  <p class="failed">Could not load {name || url}</p>
{:else if kind === 'image'}
  <a href={url} target="_blank" rel="noopener noreferrer"><img src={url} alt={name} referrerpolicy="no-referrer" onerror={() => (failed = true)} /></a>
{:else if kind === 'video'}
  <!-- Started right away when it was clicked for -->
  <video src={url} controls preload="metadata" autoplay={clicked} onerror={() => (failed = true)}><track kind="captions" /></video>
{:else}
  <audio src={url} controls preload="metadata" autoplay={clicked} onerror={() => (failed = true)}></audio>
{/if}

<style>
  img, video { display: block; max-width: 100%; max-height: 360px; background: var(--bg-0); border: 1px solid var(--line); }
  img { object-fit: contain; }
  audio { display: block; width: 100%; }
  .ask { display: flex; flex-wrap: wrap; align-items: stretch; background: var(--bg-1); border: 1px solid var(--line); }
  .load { flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; padding: 10px 12px; text-align: left; }
  .load:hover { background: var(--bg-hover); }
  .icon { flex: none; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; background: var(--bg-0); color: var(--text-dim); }
  .load:hover .icon { color: var(--text); }
  .text { min-width: 0; display: flex; flex-direction: column; }
  .text strong { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .text span { font-size: 12px; color: var(--text-dim); overflow-wrap: anywhere; }
  .always { flex: none; padding: 0 12px; font-size: 12px; color: var(--text-dim); border-left: 1px solid var(--line); }
  .always:hover { color: var(--text); background: var(--bg-hover); }
  .failed { margin: 0; font-size: 13px; color: var(--text-dim); }
</style>
