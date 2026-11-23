<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';

  // fit: as wide as the picture inside, so an upright one has no empty space beside it
  let { name, detail, icon = 'file', href, file = false, failed = false, fit = false, progress, actions, children }: {
    name: string; detail: string; icon?: string; href?: string; file?: boolean; failed?: boolean; fit?: boolean;
    progress?: number; actions?: Snippet; children?: Snippet;
  } = $props();

  // Remote hosts decide whether a URL downloads; a normal link may just open the media.
  const remote = $derived(/^https?:/i.test(href ?? ''));
  const action = $derived(`${remote ? 'Open' : 'Download'} ${name}`);
</script>

<div class="media-card" class:file class:failed class:fit>
  <div class="media-heading">
    <span class="glyph"><Icon name={icon} size={20} /></span>
    <div class="info">
      <span class="name" title={name}>{name}</span>
      <span class="detail" role="status">{detail}</span>
    </div>
    <div class="actions">
      {#if href}
        <a class="save" href={href} download={remote ? undefined : name} target={remote ? '_blank' : undefined} rel="noopener noreferrer" title={action} aria-label={action}><Icon name={remote ? 'popout' : 'download'} size={18} /></a>
      {/if}
      {@render actions?.()}
    </div>
  </div>
  {#if children}<div class="media-body">{@render children()}</div>{/if}
  {#if progress !== undefined}
    <div class="progress" role="progressbar" aria-label="Downloading {name}" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}>
      <span style:width="{Math.max(0, Math.min(100, progress))}%"></span>
    </div>
  {/if}
</div>

<style>
  .media-card { min-width: 0; max-width: 100%; overflow: hidden; background: var(--bg-1); border: 1px solid var(--line); }
  .media-heading { display: flex; align-items: center; gap: 10px; padding: 8px 10px; }
  .glyph { flex: none; display: grid; place-items: center; width: 30px; height: 36px; color: var(--text-dim); }
  .info { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .name { color: var(--text); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .detail { color: var(--text-dim); font-size: 12px; overflow-wrap: anywhere; }
  .failed .detail { color: var(--danger); }
  .actions { flex: none; display: flex; align-items: center; gap: 4px; }
  .save { display: grid; place-items: center; width: 36px; height: 36px; color: var(--text-dim); }
  .save:hover { background: var(--bg-hover); color: var(--text); }
  .media-body { min-width: 0; }
  .media-body:empty { display: none; }
  .media-body :global(img), .media-body :global(video) { display: block; max-width: 100%; max-height: 360px; object-fit: contain; background: var(--bg-0); }
  .media-body :global(audio) { display: block; width: 100%; }
  /* Room for the name and buttons; a narrower picture is centered */
  .media-card.fit { width: fit-content; min-width: min(240px, 100%); }
  /* Zero width with a full minimum: a long file name does not widen the card */
  .fit .media-heading { width: 0; min-width: 100%; }
  .fit .media-body :global(img), .fit .media-body :global(.poster) { margin-inline: auto; }
  .progress { height: 3px; background: var(--bg-3); }
  .progress span { display: block; height: 100%; background: var(--accent); transition: width 200ms; }
  @media (max-width: 480px) { .media-heading { gap: 6px; padding: 6px; } .glyph { width: 22px; } }
</style>
