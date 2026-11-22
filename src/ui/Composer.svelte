<script lang="ts" module>
  // Sent messages for the Up arrow, newest last; in memory only, so a reload clears them
  const history: string[] = [];
</script>

<script lang="ts">
  import Icon from './Icon.svelte';
  import FormatToolbar from './FormatToolbar.svelte';
  import CodeDialog from './CodeDialog.svelte';
  import EmojiPicker from './EmojiPicker.svelte';
  import { session } from '../lib/session.svelte.ts';
  import { ui } from '../lib/ui.svelte.ts';
  import { toMumbleHtml } from '../lib/html.ts';
  import { inOpenFence } from '../core/code.ts';

  // target: the chat this composer sends to ("ch:<id>" or "dm:<session>")
  let { target, placeholder, autofocus = true }: { target: string; placeholder: string; autofocus?: boolean } = $props();

  let input: HTMLDivElement;
  let picker: HTMLInputElement;
  let imagePicker: HTMLInputElement;
  let empty = $state(true);
  let snippet = $state(false);
  // The formatting toolbar is opt-in and remembered
  let formatting = $state(loadFormatting());
  const disabled = $derived(session.status !== 'connected' || (target.startsWith('dm:') && !session.user(Number(target.slice(3)))));
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
    if (history.at(-1) !== html) history.push(html);
    if (history.length > 50) history.shift();
    recalled = -1;
    input.innerHTML = '';
    sync();
  }

  // Index into history of what the field shows, -1 when it shows something else
  let recalled = -1;

  // Up and Down walk the history while the field is empty or shows an entry unchanged
  function recall(step: number): boolean {
    const browsing = recalled >= 0 && input.innerHTML === history[recalled];
    if (!browsing) recalled = -1;
    if (!browsing && (step > 0 || !empty || !history.length)) return false;
    const next = browsing ? recalled + step : history.length - 1;
    if (next < 0) return true;
    recalled = next < history.length ? next : -1;
    input.innerHTML = recalled >= 0 ? history[recalled] : '';
    sync();
    const sel = window.getSelection();
    sel?.selectAllChildren(input);
    sel?.collapseToEnd();
    return true;
  }

  // The text from the start of the message to the caret
  function textBeforeCaret(): string {
    const sel = window.getSelection();
    if (!sel?.rangeCount || !input.contains(sel.anchorNode)) return '';
    const r = document.createRange();
    r.selectNodeContents(input);
    r.setEnd(sel.getRangeAt(0).startContainer, sel.getRangeAt(0).startOffset);
    return r.toString();
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      // Inside an open ``` fence Enter starts a new line of code, as Shift+Enter does
      if (e.shiftKey || inOpenFence(textBeforeCaret())) exec('insertLineBreak');
      else submit();
      return;
    }
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey && !e.isComposing) {
      if (recall(e.key === 'ArrowUp' ? -1 : 1)) e.preventDefault();
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

  // The picker's search field takes the focus, so the caret is kept for the insert
  let emojiButton = $state<HTMLButtonElement>();
  let emojiOpen = $state(false);
  let caret: Range | null = null;

  function toggleEmoji() {
    if (emojiOpen) return closeEmoji(true);
    const sel = window.getSelection();
    caret = sel?.rangeCount && input.contains(sel.anchorNode) ? sel.getRangeAt(0).cloneRange() : null;
    emojiOpen = true;
  }

  function restoreCaret() {
    input.focus();
    const sel = window.getSelection();
    if (!sel) return;
    if (caret && input.contains(caret.startContainer)) {
      sel.removeAllRanges();
      sel.addRange(caret);
    } else {
      sel.selectAllChildren(input);
      sel.collapseToEnd();
    }
  }

  function closeEmoji(refocus: boolean) {
    emojiOpen = false;
    if (refocus) restoreCaret();
  }

  function insertEmoji(emoji: string, keepOpen: boolean) {
    restoreCaret();
    exec('insertText', emoji);
    const sel = window.getSelection();
    caret = sel?.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
    if (!keepOpen) emojiOpen = false;
  }

  $effect(() => {
    void target;
    emojiOpen = false;
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
      <button class="icon-btn" title="Code snippet (or ```language in the message)" aria-label="Code snippet" {disabled} onclick={() => (snippet = true)}><Icon name="code" /></button>
      <div class="input" class:blank={empty} bind:this={input} contenteditable={!disabled}
        role="textbox" aria-multiline="true" aria-label="Message" tabindex="0" data-placeholder={placeholder}
        oninput={sync} {onkeydown} {onpaste}></div>
      <button class="icon-btn" class:emoji-on={emojiOpen} title="Emoji (Shift+click in the list keeps it open)" aria-label="Emoji" aria-haspopup="dialog" aria-expanded={emojiOpen}
        {disabled} bind:this={emojiButton} onmousedown={e => e.preventDefault()} onclick={toggleEmoji}><Icon name="smile" size={18} /></button>
      <button class="icon-btn fmt" class:on={formatting} title="Text formatting" aria-label="Text formatting" aria-pressed={formatting}
        {disabled} onmousedown={e => e.preventDefault()} onclick={toggleFormatting}>Aa</button>
      <button class="icon-btn send" title="Send" disabled={disabled || empty} onclick={submit}><Icon name="send" size={18} /></button>
    </div>
  </div>
</div>

{#if snippet}<CodeDialog {target} onclose={() => { snippet = false; input.focus(); }} />{/if}
{#if emojiOpen && !disabled && emojiButton}<EmojiPicker anchor={emojiButton} onpick={insertEmoji} onclose={closeEmoji} />{/if}

<style>
  /* A framed field set in from the edges; grows for longer messages */
  .composer { flex: none; display: flex; flex-direction: column; justify-content: flex-end; padding: 0 16px 16px; }
  .frame { display: flex; flex-direction: column; background: var(--bg-3); border: 1px solid var(--line-strong); transition: border-color 120ms var(--ease); }
  .frame:focus-within { border-color: color-mix(in srgb, var(--accent) 55%, var(--line-strong)); }
  /* The formatting row is part of the same field: same background, its buttons over the paperclip and send */
  .composer .frame :global(.toolbar) { background: transparent; padding: 4px 8px; border-bottom-color: var(--line); }
  .composer .frame :global(.tool:hover:not(:disabled)), .composer .frame :global(.tool.on) { background: var(--bg-active); }
  .box { min-height: 46px; display: flex; align-items: center; gap: 2px; padding: 0 6px; }
  /* min-height: an empty field has no line box, and the placeholder below it would overflow into a scrollbar */
  .input { position: relative; flex: 1; min-width: 0; padding: 12px 6px; min-height: calc(1.4em + 24px); max-height: 200px; overflow-y: auto; font-size: var(--fs-chat); line-height: 1.4; outline: none; overflow-wrap: anywhere; white-space: pre-wrap; }
  .input.blank::before { content: attr(data-placeholder); position: absolute; left: 6px; right: 6px; top: 12px; color: var(--text-faint); pointer-events: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .input :global(img) { max-height: 120px; }
  .input :global(ul), .input :global(ol) { margin: 0; padding-left: 20px; }
  .input[contenteditable='false'] { color: var(--text-faint); }
  .fmt { font-weight: 700; font-size: 13px; }
  .fmt.on, .emoji-on { color: var(--accent-hover); }
  .send:not(:disabled) { color: var(--accent-hover); }
  .preparing { list-style: none; margin: 0 0 8px; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  .preparing li { display: flex; align-items: center; gap: 8px; background: var(--bg-1); border: 1px solid var(--line); padding: 6px 10px; font-size: 13px; }
  .name { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bar { flex: 1; height: 4px; background: var(--bg-3); }
  .bar span { display: block; height: 100%; background: var(--accent); transition: width 120ms; }
</style>
