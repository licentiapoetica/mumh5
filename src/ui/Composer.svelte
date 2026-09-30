<script lang="ts">
  import Icon from './Icon.svelte';
  import { session } from '../lib/session.svelte.ts';
  import { store } from '../lib/settings.svelte.ts';
  import { acceptAttr } from '../lib/upload.ts';

  // target: the chat this composer sends to ("ch:<id>" or "dm:<session>")
  let { target, placeholder, autofocus = true }: { target: string; placeholder: string; autofocus?: boolean } = $props();

  let text = $state('');
  let input: HTMLTextAreaElement;
  let picker: HTMLInputElement;
  const disabled = $derived(session.status !== 'connected');
  const uploads = $derived(session.uploads.filter(u => u.key === target));

  // Know the host's allowed types before the picker opens
  $effect(() => {
    if (store.settings.uploadHost && store.settings.uploadKey) session.loadUploadInfo().catch(() => {});
  });

  function submit() {
    if (session.sendText(text, target)) text = '';
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      submit();
    }
  }

  function onpaste(e: ClipboardEvent) {
    const files = [...(e.clipboardData?.files ?? [])];
    if (files.length) {
      e.preventDefault();
      session.uploadFiles(files, target);
    }
  }

  // Grow with content up to a limit
  $effect(() => {
    void text;
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 200) + 'px';
  });

  $effect(() => {
    void target;
    if (autofocus && !disabled && matchMedia('(pointer: fine)').matches) input.focus();
  });
</script>

<div class="composer">
  {#if uploads.length}
    <ul class="uploads">
      {#each uploads as u (u.id)}
        <li class:error={u.error}>
          <Icon name="file" size={16} />
          <span class="name">{u.name}</span>
          {#if u.error}<span>{u.error}</span>{:else}<span class="bar"><span style:width="{u.progress * 100}%"></span></span>{/if}
        </li>
      {/each}
    </ul>
  {/if}
  <div class="box">
    <button class="icon-btn" title={store.settings.uploadHost ? "Upload a file" : "Send an image"} {disabled} onclick={() => picker.click()}><Icon name="paperclip" /></button>
    <input bind:this={picker} type="file" multiple hidden
      accept={store.settings.uploadHost && store.settings.uploadKey ? acceptAttr(session.uploadInfo) : 'image/*'}
      onchange={() => { session.uploadFiles([...(picker.files ?? [])], target); picker.value = ''; }} />
    <textarea bind:this={input} bind:value={text} rows="1" {placeholder} {disabled} {onkeydown} {onpaste}
      aria-label="Message"></textarea>
    <button class="icon-btn send" title="Send" disabled={disabled || !text.trim()} onclick={submit}><Icon name="send" size={18} /></button>
  </div>
</div>

<style>
  .composer { flex: none; padding: 0 16px 16px; }
  .box { display: flex; align-items: flex-end; gap: 4px; background: var(--bg-3); padding: 6px; }
  textarea { flex: 1; resize: none; border: 0; background: transparent; padding: 6px 4px; max-height: 200px; line-height: 1.4; }
  .send:not(:disabled) { color: var(--accent-hover); }
  .uploads { list-style: none; margin: 0 0 6px; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  .uploads li { display: flex; align-items: center; gap: 8px; background: var(--bg-1); border: 1px solid var(--line); padding: 6px 10px; font-size: 13px; }
  .uploads li.error { color: var(--danger); border-color: var(--danger); }
  .name { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bar { flex: 1; height: 4px; background: var(--bg-3); }
  .bar span { display: block; height: 100%; background: var(--accent); transition: width 120ms; }
</style>
