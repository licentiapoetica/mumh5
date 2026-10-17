<script lang="ts">
  import Icon from './Icon.svelte';
  import FormatToolbar from './FormatToolbar.svelte';
  import { session } from '../lib/session.svelte.ts';
  import { ui } from '../lib/ui.svelte.ts';
  import { toMumbleHtml } from '../lib/html.ts';

  // target: the chat this composer sends to ("ch:<id>" or "dm:<session>")
  let { target, placeholder, autofocus = true }: { target: string; placeholder: string; autofocus?: boolean } = $props();

  let input: HTMLDivElement;
  let picker: HTMLInputElement;
  let imagePicker: HTMLInputElement;
  let empty = $state(true);
  // The formatting toolbar is opt-in and remembered
  let formatting = $state(loadFormatting());
  const disabled = $derived(session.status !== 'connected');
  const preparing = $derived(session.preparing.filter(u => u.key === target));

  function loadFormatting(): boolean {
    try { return localStorage.getItem('mumh5.formatBar') === '1'; } catch { return false; }
  }
  function toggleFormatting() {
    formatting = !formatting;
    try { localStorage.setItem('mumh5.formatBar', formatting ? '1' : '0'); } catch { /* storage unavailable */ }
    input.focus();
  }

  const sync = () => { empty = !input.textContent?.trim() && !input.querySelector('img'); };

  function exec(cmd: string, arg?: string) {
    input.focus();
    document.execCommand(cmd, false, arg);
    sync();
  }

  function submit() {
    const html = input.innerHTML;
    // Plain text goes out the usual way; anything formatted as sanitized XHTML
    const formatted = !!input.querySelector('b, strong, i, em, u, s, strike, span[style], font, ul, ol, a, img');
    const ok = formatted
      ? session.sendHtml(toMumbleHtml(html, { linkify: true }), target)
      : session.sendText(input.innerText, target);
    if (!ok) return;
    input.innerHTML = '';
    sync();
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      if (e.shiftKey) exec('insertLineBreak');
      else submit();
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      const cmd = ({ b: 'bold', i: 'italic', u: 'underline' } as Record<string, string>)[e.key.toLowerCase()];
      if (cmd) { e.preventDefault(); exec(cmd); }
    }
  }

  function onpaste(e: ClipboardEvent) {
    const files = [...(e.clipboardData?.files ?? [])];
    e.preventDefault();
    if (files.length) return session.sendFiles(files, target);
    const html = e.clipboardData?.getData('text/html');
    if (html && formatting) exec('insertHTML', toMumbleHtml(html));
    else exec('insertText', e.clipboardData?.getData('text/plain') ?? '');
  }

  // window.prompt does not exist in Electron; the app's dialog, then restore the selection
  function link() {
    const sel = window.getSelection();
    const range = sel && sel.rangeCount && input.contains(sel.anchorNode) ? sel.getRangeAt(0).cloneRange() : null;
    ui.prompt = {
      title: 'Insert link', label: 'Address (https://...)', confirm: 'Insert link', initial: 'https://',
      onsubmit: raw => {
        const url = raw.trim();
        if (!/^https?:\/\/\S+$/i.test(url)) return;
        input.focus();
        if (range) { sel!.removeAllRanges(); sel!.addRange(range); }
        if (range && !range.collapsed) exec('createLink', url);
        else exec('insertHTML', `<a href="${url.replace(/"/g, '&quot;')}">${url.replace(/</g, '&lt;')}</a>`);
      }
    };
  }

  $effect(() => {
    void target;
    if (autofocus && !disabled && matchMedia('(pointer: fine)').matches) input.focus();
  });
</script>

<div class="composer">
  {#if preparing.length}
    <ul class="preparing">
      {#each preparing as u (u.id)}
        <li title="Reading the file before it is announced">
          <Icon name="file" size={16} />
          <span class="name">{u.name}</span>
          <span class="bar"><span style:width="{u.progress * 100}%"></span></span>
        </li>
      {/each}
    </ul>
  {/if}
  <div class="frame">
    {#if formatting}
      <FormatToolbar {exec} onlink={link} onimage={() => imagePicker.click()} />
    {/if}
    <div class="box">
      <button class="icon-btn" title="Send a file" {disabled} onclick={() => picker.click()}><Icon name="paperclip" /></button>
      <input bind:this={picker} type="file" multiple hidden
        onchange={() => { session.sendFiles([...(picker.files ?? [])], target); picker.value = ''; }} />
      <input bind:this={imagePicker} type="file" accept="image/*" hidden
        onchange={() => { session.sendFiles([...(imagePicker.files ?? [])], target); imagePicker.value = ''; }} />
      <div class="input" class:blank={empty} bind:this={input} contenteditable={!disabled}
        role="textbox" aria-multiline="true" aria-label="Message" tabindex="0" data-placeholder={placeholder}
        oninput={sync} {onkeydown} {onpaste}></div>
      <button class="icon-btn fmt" class:on={formatting} title="Text formatting" aria-label="Text formatting" aria-pressed={formatting}
        {disabled} onmousedown={e => e.preventDefault()} onclick={toggleFormatting}>Aa</button>
      <button class="icon-btn send" title="Send" disabled={disabled || empty} onclick={submit}><Icon name="send" size={18} /></button>
    </div>
  </div>
</div>

<style>
  /* Same height as the bar at the bottom of the sidebar, buttons centered like there; grows for longer messages */
  .composer { flex: none; min-height: var(--footer-h); display: flex; flex-direction: column; justify-content: flex-end; padding: 0; background: var(--bg-0); border: 1px solid var(--line); }
  .frame { flex: 1; display: flex; flex-direction: column; background: var(--bg-3); }
  .frame :global(.toolbar) { background: var(--bg-2); }
  .box { flex: 1; display: flex; align-items: center; gap: 4px; padding: 0 8px; }
  .input { position: relative; flex: 1; min-width: 0; padding: 8px 4px; max-height: 200px; overflow-y: auto; line-height: 1.4; outline: none; overflow-wrap: anywhere; white-space: pre-wrap; }
  .input.blank::before { content: attr(data-placeholder); position: absolute; left: 4px; top: 8px; color: var(--text-faint); pointer-events: none; }
  .input :global(img) { max-height: 120px; }
  .input :global(ul), .input :global(ol) { margin: 0; padding-left: 20px; }
  .input[contenteditable='false'] { color: var(--text-faint); }
  .fmt { font-weight: 700; font-size: 13px; }
  .fmt.on { color: var(--accent-hover); }
  .send:not(:disabled) { color: var(--accent-hover); }
  .preparing { list-style: none; margin: 0 0 6px; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  .preparing li { display: flex; align-items: center; gap: 8px; background: var(--bg-1); border: 1px solid var(--line); padding: 6px 10px; font-size: 13px; }
  .name { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bar { flex: 1; height: 4px; background: var(--bg-3); }
  .bar span { display: block; height: 100%; background: var(--accent); transition: width 120ms; }
</style>
