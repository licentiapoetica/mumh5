<script lang="ts">
  import { tick, type Snippet } from 'svelte';
  import Icon from './Icon.svelte';
  import Message from './Message.svelte';
  import { session } from '../lib/session.svelte.ts';

  // Message list for one chat (channel or DM), with drag and drop of files into that chat
  let { key, empty }: { key: string; empty: Snippet } = $props();

  const entries = $derived(session.logs[key] ?? []);
  const title = $derived(session.viewTitle(key));

  let list: HTMLDivElement;
  let pinned = true; // stick to the bottom unless the user scrolled up
  let dragging = $state(0);

  $effect(() => {
    void entries.length;
    void key;
    if (pinned) tick().then(() => list && (list.scrollTop = list.scrollHeight));
  });

  // Media loads after insertion and grows the list; keep the bottom pinned
  function onload() { if (pinned) list.scrollTop = list.scrollHeight; }

  function ondrop(e: DragEvent) {
    e.preventDefault();
    dragging = 0;
    const files = [...(e.dataTransfer?.files ?? [])];
    if (files.length && session.status === 'connected') session.sendFiles(files, key);
  }

  const grouped = (i: number) => {
    const a = entries[i - 1], b = entries[i];
    return !!a && a.kind === 'text' && b.kind === 'text' && a.authorSession === b.authorSession && a.author === b.author && a.self === b.self && b.time - a.time < 5 * 60000;
  };
</script>

<div class="wrap" role="log"
  ondragenter={e => { if (e.dataTransfer?.types.includes('Files')) dragging++; }}
  ondragleave={() => (dragging = Math.max(0, dragging - 1))}
  ondragover={e => e.preventDefault()} {ondrop}>
  <div class="list" bind:this={list} onscroll={() => (pinned = list.scrollHeight - list.scrollTop - list.clientHeight < 40)}
    onloadcapture={onload} onloadedmetadatacapture={onload}>
    {#if !entries.length}{@render empty()}{/if}
    {#each entries as entry, i (entry.id)}
      <Message {entry} grouped={grouped(i)} />
    {/each}
    <div class="end"></div>
  </div>
  {#if dragging}
    <div class="drop"><div><Icon name="download" size={40} /><p>Drop to send to {key.startsWith('dm:') ? '@' : '#'}{title}</p></div></div>
  {/if}
</div>

<style>
  .wrap { position: relative; flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .list { flex: 1; overflow-y: auto; overflow-x: hidden; padding-bottom: 12px; }
  .end { height: 4px; }
  .drop { position: absolute; inset: 0; z-index: 10; background: rgb(13 14 16 / 0.8); display: flex; align-items: center; justify-content: center; padding: 16px; pointer-events: none; }
  .drop div { border: 2px dashed var(--accent); padding: 32px 48px; text-align: center; color: var(--text); }
  .drop p { margin: 8px 0 0; font-weight: 600; }
</style>
