<script lang="ts">
  import Modal from './Modal.svelte';
  import { session } from '../lib/session.svelte.ts';
  import { LANGUAGES, languageId, languageName, highlightCode, detectLanguage, codeBlockHtml } from '../core/code.ts';

  // A code snippet for the chat at `target`: language, a highlighted editor, sent as <pre> (src/core/code.ts)
  let { target, onclose }: { target: string; onclose: () => void } = $props();

  let code = $state('');
  // '' detects the language; the last choice is remembered
  let lang = $state(load());
  let detected = $state<string | null>(null);
  let area: HTMLTextAreaElement;
  let shown: HTMLPreElement;

  function load(): string {
    try { return languageId(localStorage.getItem('mumh5.codeLang')) ?? ''; } catch { return ''; }
  }

  // Detecting tries every language (tens of ms on a long snippet): only after a pause in typing
  $effect(() => {
    if (lang) return;
    const text = code;
    const t = setTimeout(() => { detected = detectLanguage(text); }, 250);
    return () => clearTimeout(t);
  });

  const used = $derived(lang || detected);
  // The trailing line break keeps an empty last line as tall as the textarea's
  const lit = $derived(highlightCode(code, used ?? 'plaintext').html + '\n');
  // Without detecting again on every key; send() does it once
  const html = $derived(codeBlockHtml(code, used, false));
  const limit = $derived(session.messageLimit(target));
  const over = $derived(limit > 0 && html.length > limit);
  const blank = $derived(!code.trim());

  function send() {
    if (blank || over || !session.sendHtml(codeBlockHtml(code, lang || detectLanguage(code), false), target)) return;
    try { localStorage.setItem('mumh5.codeLang', lang); } catch { /* storage unavailable */ }
    onclose();
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      send();
    } else if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.altKey) {
      // A tab character, through the editing commands so undo still works
      e.preventDefault();
      document.execCommand('insertText', false, '\t');
    }
  }

  const follow = () => { shown.scrollTop = area.scrollTop; shown.scrollLeft = area.scrollLeft; };
</script>

<Modal title="Code snippet" {onclose} width={760}>
  <label for="code-lang">Language</label>
  <select id="code-lang" bind:value={lang}>
    <option value="">{detected && !lang ? `Detect (${languageName(detected)})` : 'Detect'}</option>
    {#each LANGUAGES as l (l.id)}<option value={l.id}>{l.name}</option>{/each}
  </select>
  <label for="code-text">Code</label>
  <div class="editor" class:over>
    <pre class="hl shown" bind:this={shown} aria-hidden="true">{@html lit}</pre>
    <!-- svelte-ignore a11y_autofocus -->
    <textarea id="code-text" bind:this={area} bind:value={code} {onkeydown} onscroll={follow} oninput={follow} autofocus
      spellcheck="false" autocomplete="off" autocapitalize="off" wrap="off" placeholder="Paste or type code"></textarea>
  </div>
  {#snippet footer()}
    <span class="count" class:over title="Size of the message as the server counts it; Tab inserts a tab, Ctrl+Enter sends">
      {html.length}{limit ? ` / ${limit}` : ''} characters
    </span>
    <button class="btn" onclick={onclose}>Cancel</button>
    <button class="btn primary" disabled={blank || over} onclick={send}>Send</button>
  {/snippet}
</Modal>

<style>
  select { width: auto; min-width: 220px; max-width: 100%; }
  .editor { position: relative; height: min(50vh, 380px); background: var(--bg-0); border: 1px solid var(--line-strong); }
  .editor:focus-within { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
  .editor.over { border-color: var(--danger); box-shadow: none; }
  /* The highlighted copy sits exactly under the transparent text of the textarea */
  .shown, .editor textarea { position: absolute; inset: 0; margin: 0; padding: 8px 10px; font: 13px/1.5 var(--mono); tab-size: 4; white-space: pre; overflow: auto; }
  .shown { overflow: hidden; pointer-events: none; }
  .editor textarea { width: 100%; height: 100%; border: 0; background: transparent; color: transparent; caret-color: var(--text); resize: none; box-shadow: none; }
  /* The frame shows focus */
  .editor textarea:focus-visible { outline: none; }
  .editor textarea::selection { color: transparent; background: color-mix(in srgb, var(--accent) 40%, transparent); }
  .count { margin-right: auto; align-self: center; font-size: 12px; color: var(--text-faint); font-variant-numeric: tabular-nums; }
  .count.over { color: var(--danger); font-weight: 600; }
</style>
