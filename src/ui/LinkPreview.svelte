<script lang="ts">
  import { linkPreview } from '../lib/preview.ts';
  import type { LinkPreviewData } from '../lib/native.ts';

  let { url }: { url: string } = $props();

  let data = $state<LinkPreviewData | null>(null);
  let imageOk = $state(true);

  $effect(() => {
    let alive = true;
    linkPreview(url).then(d => { if (alive) data = d; });
    return () => { alive = false; };
  });
</script>

{#if data}
  <article class="card" class:large={data.large && data.image && imageOk} style:--bar={data.color || 'var(--accent)'}>
    <div class="text">
      <span class="site">{data.site}</span>
      <a class="title" href={url} target="_blank" rel="noopener noreferrer">{data.title || data.url}</a>
      {#if data.description}<p class="desc">{data.description}</p>{/if}
    </div>
    {#if data.image && imageOk}
      <a class="thumb" href={url} target="_blank" rel="noopener noreferrer" tabindex="-1" aria-hidden="true">
        <img src={data.image} alt="" loading="lazy" referrerpolicy="no-referrer" onerror={() => (imageOk = false)} />
      </a>
    {/if}
  </article>
{/if}

<style>
  .card { display: flex; gap: 12px; max-width: min(520px, 100%); padding: 10px 12px; background: var(--bg-1); border: 1px solid var(--line); border-left: 4px solid var(--bar); }
  .card.large { flex-direction: column; }
  .text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
  .site { font-size: 12px; color: var(--text-dim); }
  .title { font-weight: 600; color: var(--link); overflow-wrap: anywhere; }
  .desc { margin: 0; font-size: 13px; color: var(--text-dim); display: -webkit-box; -webkit-line-clamp: 3; line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
  .thumb { flex: none; width: 80px; height: 80px; }
  .large .thumb { width: 100%; height: auto; }
  .thumb img { width: 100%; height: 100%; object-fit: cover; display: block; background: var(--bg-0); }
  .large .thumb img { height: auto; max-height: 280px; }
</style>
