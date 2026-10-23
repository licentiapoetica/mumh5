<script lang="ts">
  import { onMount } from 'svelte';
  import FormatToolbar from './FormatToolbar.svelte';
  import { toMumbleHtml, formatBytes } from '../lib/html.ts';
  import { makeInlineImage } from '../lib/images.ts';
  import { ui } from '../lib/ui.svelte.ts';

  // Rich text in the subset Mumble clients render (Qt rich text): bold, italic, underline,
  // strikethrough, colors, lists, links and inline data: images. `limit` is the server's
  // size limit for the whole HTML, pictures included.
  let { value = '', limit, placeholder = '', onchange }:
    { value?: string; limit: number; placeholder?: string; onchange: (html: string) => void } = $props();

  let editor: HTMLDivElement;
  let picker: HTMLInputElement;
  let source = $state(false);
  let sourceText = $state('');
  let html = $state('');
  let error = $state('');

  const size = $derived(html.length);
  const over = $derived(limit > 0 && size > limit);

  onMount(() => {
    document.execCommand('defaultParagraphSeparator', false, 'p');
    document.execCommand('styleWithCSS', false, 'true');
    editor.innerHTML = toMumbleHtml(value) || '<p><br></p>';
    sync();
  });

  function sync() {
    html = toMumbleHtml(editor.innerHTML);
    onchange(html);
  }

  function exec(cmd: string, arg?: string) {
    editor.focus();
    document.execCommand(cmd, false, arg);
    sync();
  }

  // window.prompt does not exist in Electron; use the app's dialog and restore the selection after
  function link() {
    const sel = window.getSelection();
    const range = sel && sel.rangeCount && editor.contains(sel.anchorNode) ? sel.getRangeAt(0).cloneRange() : null;
    ui.prompt = {
      title: 'Insert link', label: 'Address (https://...)', confirm: 'Insert link', initial: 'https://',
      onsubmit: raw => {
        const url = raw.trim();
        if (!/^https?:\/\/\S+$/i.test(url)) return;
        editor.focus();
        if (range) { sel!.removeAllRanges(); sel!.addRange(range); }
        if (range && !range.collapsed) exec('createLink', url);
        else exec('insertHTML', `<a href="${url.replace(/"/g, '&quot;')}">${url.replace(/</g, '&lt;')}</a>`);
      }
    };
  }

  async function insertImage(file: File) {
    error = '';
    // Room left for the picture inside the server's limit
    const room = (limit || 131072) - size - 64;
    const uri = await makeInlineImage(file, room, [640, 480, 320, 200, 120]);
    if (!uri) {
      error = room < 2000 ? 'No room left for a picture within the server limit.' : 'Could not make this picture small enough.';
      return;
    }
    exec('insertImage', uri);
  }

  function onpaste(e: ClipboardEvent) {
    const img = [...(e.clipboardData?.files ?? [])].find(f => f.type.startsWith('image/'));
    e.preventDefault();
    if (img) return insertImage(img);
    const pasted = e.clipboardData?.getData('text/html');
    if (pasted) exec('insertHTML', toMumbleHtml(pasted));
    else exec('insertText', e.clipboardData?.getData('text/plain') ?? '');
  }

  function toggleSource() {
    if (!source) {
      sourceText = html;
      source = true;
    } else {
      editor.innerHTML = toMumbleHtml(sourceText) || '<p><br></p>';
      source = false;
      sync();
    }
  }

  function onkeydown(e: KeyboardEvent) {
    if (!(e.ctrlKey || e.metaKey)) return;
    const map: Record<string, string> = { b: 'bold', i: 'italic', u: 'underline' };
    const cmd = map[e.key.toLowerCase()];
    if (cmd) { e.preventDefault(); exec(cmd); }
  }

</script>

<div class="rich" class:over>
  <FormatToolbar {exec} onlink={link} onimage={() => picker.click()} {source} ontogglesource={toggleSource} />
  <input bind:this={picker} type="file" accept="image/*" hidden onchange={() => { const f = picker.files?.[0]; picker.value = ''; if (f) insertImage(f); }} />

  <div class="area" class:hidden={source} class:blank={!html} bind:this={editor} contenteditable="true" role="textbox" aria-multiline="true"
    aria-label="Description" tabindex="0" data-placeholder={placeholder} oninput={sync} {onpaste} {onkeydown}></div>
  {#if source}
    <textarea class="area src" bind:value={sourceText} oninput={() => onchange(toMumbleHtml(sourceText))} aria-label="HTML source" spellcheck="false"></textarea>
  {/if}

  <div class="foot">
    {#if error}<span class="err">{error}</span>{/if}
    <span class="grow"></span>
    <span class="count" title="Size of the description as the server counts it">{formatBytes(source ? sourceText.length : size)}{limit ? ` / ${formatBytes(limit)}` : ''}</span>
  </div>
</div>

<style>
  .rich { border: 1px solid var(--line); background: var(--bg-0); }
  .rich:focus-within { border-color: var(--accent); }
  .rich.over { border-color: var(--danger); }
  .grow { flex: 1; }
  .area { position: relative; min-height: 140px; max-height: 360px; overflow-y: auto; padding: 8px 10px; outline: none; overflow-wrap: anywhere; line-height: 1.45; }
  .area.hidden { display: none; }
  .area :global(p) { margin: 0 0 6px; }
  .area :global(img) { max-width: 100%; }
  .area.blank::before { content: attr(data-placeholder); color: var(--text-faint); position: absolute; left: 10px; top: 8px; pointer-events: none; }
  .src { width: 100%; border: 0; resize: vertical; font: 12px var(--mono); background: transparent; box-shadow: none; }
  .foot { display: flex; align-items: center; gap: 8px; padding: 4px 8px; border-top: 1px solid var(--line); font-size: 12px; color: var(--text-faint); }
  .over .count { color: var(--danger); font-weight: 600; }
  .err { color: var(--danger); }
</style>
