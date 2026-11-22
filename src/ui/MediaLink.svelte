<script lang="ts">
  import MediaCard from './MediaCard.svelte';
  import MediaPlayer from './MediaPlayer.svelte';
  import { store } from '../lib/settings.svelte.ts';

  let { kind, url, name }: { kind: 'image' | 'video' | 'audio'; url: string; name: string } = $props();

  const local = $derived(/^data:image\/(png|jpe?g|gif|webp);/i.test(url));
  const host = $derived(new URL(url).host.toLowerCase());
  // Inline pictures stay local; other hosts wait for a click unless the user listed them.
  const trusted = $derived(local || store.trustedHosts.includes(host));
  let clicked = $state(false);
  let failed = $state(false);
  const shown = $derived(trusted || clicked);
  const noun = $derived(kind === 'image' ? 'Picture' : kind === 'video' ? 'Video' : 'Sound');
  const icon = $derived(kind === 'image' ? 'image' : kind === 'video' ? 'screen' : 'headphones');
</script>

<MediaCard name={name || host} detail={failed ? 'Could not load preview' : local ? noun : `${noun} from ${host}`} {icon} href={shown ? url : undefined} {failed}>
  {#if !shown}
    <div class="ask">
      <button class="load" onclick={() => (clicked = true)} title="Loads from {host}, which sees your IP address">
        {noun} from {host}, click to {kind === 'image' ? 'show' : 'play'}
      </button>
      <button class="always" onclick={() => store.trustHost(host)} title="Adds {host} to the hosts in Settings, Chat and files">Always from this host</button>
    </div>
  {:else if !failed && kind === 'image'}
    <img src={url} alt={name} referrerpolicy="no-referrer" onerror={() => (failed = true)} />
  {:else if !failed}
    <MediaPlayer kind={kind === 'video' ? 'video' : 'audio'} {url} {name} autoplay={clicked} onerror={() => (failed = true)} />
  {/if}
</MediaCard>

<style>
  .ask { display: flex; flex-wrap: wrap; align-items: stretch; border-top: 1px solid var(--line); }
  .load { flex: 1; min-width: 0; padding: 10px 12px; text-align: left; font-size: 12px; color: var(--text-dim); overflow-wrap: anywhere; }
  .load:hover, .always:hover { background: var(--bg-hover); color: var(--text); }
  .always { flex: none; padding: 10px 12px; font-size: 12px; color: var(--text-dim); border-left: 1px solid var(--line); }
</style>
