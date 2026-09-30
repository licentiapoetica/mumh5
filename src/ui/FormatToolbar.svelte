<script lang="ts">
  import Icon from './Icon.svelte';

  // Formatting controls shared by the description editor and the message input.
  // Buttons keep the text selection (mousedown is suppressed) and act through the callbacks.
  let { exec, onlink, onimage, source = false, ontogglesource }:
    { exec: (cmd: string, arg?: string) => void; onlink: () => void; onimage: () => void; source?: boolean; ontogglesource: () => void } = $props();

  let color = $state('#e8b23c');
  const keep = (e: MouseEvent) => e.preventDefault();

  const tools = [
    { cmd: 'bold', label: 'Bold (Ctrl+B)', text: 'B', cls: 'b' },
    { cmd: 'italic', label: 'Italic (Ctrl+I)', text: 'I', cls: 'i' },
    { cmd: 'underline', label: 'Underline (Ctrl+U)', text: 'U', cls: 'u' },
    { cmd: 'strikeThrough', label: 'Strikethrough', text: 'S', cls: 's' }
  ];
</script>

<div class="toolbar" role="toolbar" aria-label="Formatting">
  {#each tools as t (t.cmd)}
    <button class="tool {t.cls}" title={t.label} aria-label={t.label} disabled={source} onmousedown={keep} onclick={() => exec(t.cmd)}>{t.text}</button>
  {/each}
  <span class="sep"></span>
  <label class="tool color" title="Text color">
    <span class="swatch" style:background={color}></span>
    <input type="color" bind:value={color} disabled={source} onchange={() => exec('foreColor', color)} aria-label="Text color" />
  </label>
  <span class="sep"></span>
  <button class="tool" title="Bulleted list" aria-label="Bulleted list" disabled={source} onmousedown={keep} onclick={() => exec('insertUnorderedList')}><Icon name="list" size={16} /></button>
  <button class="tool" title="Numbered list" aria-label="Numbered list" disabled={source} onmousedown={keep} onclick={() => exec('insertOrderedList')}><Icon name="list-ordered" size={16} /></button>
  <button class="tool" title="Link" aria-label="Link" disabled={source} onmousedown={keep} onclick={onlink}><Icon name="link" size={16} /></button>
  <button class="tool" title="Insert picture" aria-label="Insert picture" disabled={source} onmousedown={keep} onclick={onimage}><Icon name="image" size={16} /></button>
  <button class="tool" title="Clear formatting" aria-label="Clear formatting" disabled={source} onmousedown={keep} onclick={() => exec('removeFormat')}><Icon name="eraser" size={16} /></button>
  <span class="grow"></span>
  <button class="tool" class:on={source} title="Edit HTML" aria-label="Edit HTML" aria-pressed={source} onclick={ontogglesource}><Icon name="code" size={16} /></button>
</div>

<style>
  .toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 2px; padding: 4px; border-bottom: 1px solid var(--line); background: var(--bg-2); }
  .tool { width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center; color: var(--text-dim); font-size: 14px; cursor: pointer; }
  .tool:hover:not(:disabled), .tool.on { background: var(--bg-hover); color: var(--text); }
  .b { font-weight: 800; }
  .i { font-style: italic; font-family: Georgia, serif; }
  .u { text-decoration: underline; }
  .s { text-decoration: line-through; }
  .sep { width: 1px; height: 18px; background: var(--line); margin: 0 4px; }
  .grow { flex: 1; }
  .color { position: relative; margin: 0; }
  .swatch { width: 14px; height: 14px; border: 1px solid var(--text-faint); }
  .color input { position: absolute; inset: 0; opacity: 0; cursor: pointer; padding: 0; }
</style>
