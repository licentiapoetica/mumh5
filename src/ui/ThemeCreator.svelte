<script lang="ts">
  import Icon from './Icon.svelte';
  import PickColor from './PickColor.svelte';
  import PromptDialog from './PromptDialog.svelte';
  import SpeakOrb from './SpeakOrb.svelte';
  import { THEMES } from '../lib/settings.svelte.ts';
  import { studio, type MainColor } from '../lib/theme-studio.svelte.ts';
  import {
    CHAT_SIZE, COLOR_GROUPS, ORB_GLOW_MAX, ORB_SHAPES, ORB_SIZE, THEME_FONTS, THEME_NAME_MAX, colorProblems, normalizeHex,
    type ColorKey, type OrbShape, type ThemeFont, type ThemeIndicator
  } from '../lib/custom-themes.ts';

  // docked: over the app's edge, where no window of its own could open
  let { docked = false }: { docked?: boolean } = $props();

  const MAIN: { key: MainColor; name: string; note: string }[] = [
    { key: 'bg-2', name: 'Background', note: 'Panels, fields, hover and lines follow it' },
    { key: 'text', name: 'Text', note: 'Secondary and faint text follow it' },
    { key: 'accent', name: 'Accent', note: 'Links and button labels follow it' }
  ];

  let mode = $state<'quick' | 'all' | 'indicator'>('quick');
  const problems = $derived(studio.draft ? colorProblems(studio.draft.colors) : []);
  const colorNames = new Map<string, string>(COLOR_GROUPS.flatMap(g => g.colors.map(c => [c.key, c.name] as [string, string])));
  const colorName = (key: ColorKey) => colorNames.get(key) ?? key;
  const problemNames = $derived(problems.map(p => `${colorName(p.key)}: ${p.ratio.toFixed(1)}, needs ${p.min}`).join('\n'));

  function typed(input: HTMLInputElement, current: string, set: (hex: string) => void) {
    const hex = normalizeHex(input.value);
    if (hex) set(hex);
    input.value = hex ?? current;
  }
</script>

{#snippet colorRow(id: string, key: ColorKey, name: string, note: string, set: (hex: string) => void)}
  {@const value = studio.draft!.colors[key]}
  {@const problem = problems.find(p => p.key === key)}
  <div class="color">
    <label for={id} title={note}>{name}</label>
    {#if problem}<span class="low" title="Contrast {problem.ratio.toFixed(1)}, needs {problem.min}">Low {problem.ratio.toFixed(1)}</span>{/if}
    <input {id} type="color" {value} oninput={e => set(e.currentTarget.value)} />
    <input class="hex" aria-label="{name} code" spellcheck="false" maxlength="7" {value}
      onchange={e => typed(e.currentTarget, value, set)} />
    <PickColor label="Pick {name} from the screen" size={16} onpick={set} />
  </div>
{/snippet}

{#snippet orbState(state: keyof ThemeIndicator, title: string)}
  {@const look = studio.draft!.indicator[state]}
  {@const set = (hex: string) => studio.setOrb(state, 'color', hex)}
  <div class="orb-head">
    <h3>{title}</h3>
    <span class="orb-box"><SpeakOrb speaking={state === 'talking'} box={30} /></span>
  </div>
  <div class="orb-row">
    <label for="tc-{state}-shape">Shape</label>
    <select id="tc-{state}-shape" aria-label="{title} shape" value={look.shape}
      onchange={e => studio.setOrb(state, 'shape', e.currentTarget.value as OrbShape)}>
      {#each ORB_SHAPES.filter(s => state === 'idle' || s.id !== 'none') as s (s.id)}<option value={s.id}>{s.name}</option>{/each}
    </select>
  </div>
  {#if look.shape !== 'none'}
    <div class="color">
      <label for="tc-{state}-color">Color</label>
      <input id="tc-{state}-color" aria-label="{title} color" type="color" value={look.color} oninput={e => set(e.currentTarget.value)} />
      <input class="hex" aria-label="{title} color code" spellcheck="false" maxlength="7" value={look.color}
        onchange={e => typed(e.currentTarget, look.color, set)} />
      <PickColor label="Pick the {title.toLowerCase()} color from the screen" size={16} onpick={set} />
    </div>
    {#if look.shape === 'sphere'}
      <div class="orb-row">
        <label for="tc-{state}-border">Border</label>
        <input id="tc-{state}-border" aria-label="{title} border" type="checkbox" checked={look.border}
          onchange={e => studio.setOrb(state, 'border', e.currentTarget.checked)} />
      </div>
    {/if}
    <div class="orb-row">
      <label for="tc-{state}-size">Size</label>
      <input id="tc-{state}-size" aria-label="{title} size" type="range" min={ORB_SIZE.min} max={ORB_SIZE.max} step="5" value={look.size}
        oninput={e => studio.setOrb(state, 'size', e.currentTarget.valueAsNumber)} />
      <output for="tc-{state}-size">{look.size}%</output>
    </div>
    <div class="orb-row">
      <label for="tc-{state}-glow">Glow</label>
      <input id="tc-{state}-glow" aria-label="{title} glow" type="range" min="0" max={ORB_GLOW_MAX} step="1" value={look.glow}
        oninput={e => studio.setOrb(state, 'glow', e.currentTarget.valueAsNumber)} />
      <output for="tc-{state}-glow">{look.glow ? `${look.glow}px` : 'Off'}</output>
    </div>
  {/if}
{/snippet}

{#if studio.draft}
  {@const d = studio.draft}
  <section class="creator" class:docked aria-label="Theme creator">
    <header>
      <h2>Theme creator</h2>
      <button class="btn" disabled={!studio.canUndo} onclick={() => studio.undo()}>Undo</button>
      <button class="icon-btn" aria-label="Close theme creator" onclick={() => studio.discard()}><Icon name="x" /></button>
    </header>

    <div class="body">
      <label for="tc-name">Name</label>
      <input id="tc-name" maxlength={THEME_NAME_MAX} bind:value={d.name} />

      <div class="sample" aria-hidden="true">
        <div class="people">
          <span><span class="orb-slot"><SpeakOrb box={20} /></span>Idle</span>
          <span><span class="orb-slot"><SpeakOrb speaking box={20} /></span>Talking</span>
        </div>
        <div><strong>Sam</strong> <span class="time">12:04</span></div>
        <p>A message with a <span class="a">link</span> in it.</p>
        <div class="chips">
          <span class="primary">Button</span>
          <span class="s">Connected</span><span class="w">Warning</span><span class="e">Error</span>
          <span class="f">Hint</span>
        </div>
      </div>

      <div class="shades" role="group" aria-label="Section">
        <button class:on={mode === 'quick'} aria-pressed={mode === 'quick'} onclick={() => (mode = 'quick')}>Quick</button>
        <button class:on={mode === 'all'} aria-pressed={mode === 'all'} onclick={() => (mode = 'all')}>All colors</button>
        <button class:on={mode === 'indicator'} aria-pressed={mode === 'indicator'} title="The speaking indicator beside people"
          onclick={() => (mode = 'indicator')}>Indicator</button>
      </div>

      {#if mode === 'indicator'}
        <p class="help">The mark beside people in the lists. The other colors do not change it.</p>
        {@render orbState('idle', 'Idle')}
        {@render orbState('talking', 'Talking')}
      {:else}
        <label for="tc-from">Copy colors from</label>
        <select id="tc-from" value="" onchange={e => { if (e.currentTarget.value) studio.copyColors(e.currentTarget.value); e.currentTarget.value = ''; }}>
          <option value="">Choose a theme</option>
          {#if studio.list.length}
            <optgroup label="Your themes">
              {#each studio.list as t (t.id)}<option value={t.id}>{t.name}</option>{/each}
            </optgroup>
          {/if}
          <optgroup label="Color schemes">
            {#each THEMES as t (t.id)}<option value={t.id}>{t.name}</option>{/each}
          </optgroup>
        </select>

        {#if mode === 'quick'}
          <p class="help">The other colors follow these three.</p>
          {#each MAIN as c (c.key)}
            {@render colorRow(`tc-main-${c.key}`, c.key, c.name, c.note, hex => studio.setMain(c.key, hex))}
          {/each}
        {:else}
          {#each COLOR_GROUPS as group (group.name)}
            <h3>{group.name}</h3>
            {#each group.colors as c (c.key)}
              {@render colorRow(`tc-${c.key}`, c.key, c.name, c.note, hex => studio.setColor(c.key, hex))}
            {/each}
          {/each}
        {/if}

        <h3>Font and size</h3>
        <label for="tc-font">Font</label>
        <select id="tc-font" value={d.font} onchange={e => { d.font = e.currentTarget.value as ThemeFont; }}>
          {#each THEME_FONTS as f (f.id)}<option value={f.id}>{f.name}</option>{/each}
        </select>
        <label for="tc-size">Chat text size <span class="value">{d.chatSize}px</span></label>
        <input id="tc-size" type="range" min={CHAT_SIZE.min} max={CHAT_SIZE.max} step="1" bind:value={d.chatSize} />
      {/if}
    </div>

    <footer>
      <div class="check" role="status" title={problemNames}>
        {#if problems.length}
          <span class="bad">{problems.length === 1 ? '1 color' : `${problems.length} colors`} hard to read</span>
          <button class="link" onclick={() => studio.fix()}>Fix</button>
        {:else}
          <span>Contrast is fine</span>
        {/if}
      </div>
      <button class="btn" onclick={() => studio.discard()}>Cancel</button>
      <button class="btn primary" disabled={!d.name.trim()} onclick={() => studio.save()}>Save</button>
    </footer>
  </section>
  {#if studio.question}
    <PromptDialog {...studio.question} onclose={() => (studio.question = null)} />
  {/if}
{/if}

<style>
  .creator {
    position: fixed; z-index: 50; inset: 0; display: flex; flex-direction: column;
    background: var(--bg-1); color: var(--text); font-size: 14px;
  }
  .creator.docked { left: auto; width: min(420px, 100%); border-left: 1px solid var(--line-strong); }
  header { flex: none; height: var(--header-h); display: flex; align-items: center; gap: 8px; padding: 0 10px 0 16px; border-bottom: 1px solid var(--line); }
  h2 { flex: 1; margin: 0; font-size: 15px; font-weight: 650; }
  header .btn { padding-block: 4px; }
  .body { flex: 1; min-height: 0; overflow-y: auto; padding: 4px 16px 18px; }
  h3 { margin: 18px 0 4px; font-size: 11px; font-weight: 650; letter-spacing: 0.07em; text-transform: uppercase; color: var(--text-faint); }
  .help { margin: 8px 0 2px; font-size: 13px; color: var(--text-dim); }
  .value { float: right; font-weight: 400; font-variant-numeric: tabular-nums; }

  .sample { margin-top: 14px; padding: 10px 12px; background: var(--bg-2); border: 1px solid var(--line); font-size: var(--fs-chat); line-height: 1.4; }
  .sample strong { color: var(--text); }
  .sample .time { font-size: 12px; color: var(--text-dim); }
  .sample p { margin: 2px 0 8px; }
  .sample .a { color: var(--link); }
  .chips { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; font-size: 12px; }
  .chips .primary { padding: 3px 8px; background: var(--accent); color: var(--accent-text); font-weight: 600; }
  .chips .s { color: var(--speaking); }
  .chips .w { color: var(--warn); }
  .chips .e { color: var(--danger); }
  .chips .f { color: var(--text-faint); }

  .shades { display: flex; margin-top: 14px; border: 1px solid var(--line-strong); }
  .shades button { flex: 1; min-height: 32px; font-size: 13px; color: var(--text-dim); }
  .shades button:hover { background: var(--bg-hover); color: var(--text); }
  .shades button.on { background: var(--accent); color: var(--accent-text); }

  .color { display: flex; align-items: center; gap: 6px; min-height: 36px; margin-top: 2px; }
  .color label { flex: 1; min-width: 0; margin: 0; font-size: 13px; font-weight: 500; color: var(--text); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .low { flex: none; font-size: 11px; font-weight: 600; color: var(--danger); font-variant-numeric: tabular-nums; }
  .color input[type="color"] { flex: none; width: 34px; height: 28px; padding: 2px; }
  .color .hex { flex: none; width: 82px; height: 28px; padding: 3px 6px; font: 12px/18px var(--mono); }

  footer { flex: none; display: flex; align-items: center; gap: 8px; padding: 10px 16px; background: var(--bg-0); border-top: 1px solid var(--line); }
  .check { flex: 1; min-width: 0; font-size: 12px; color: var(--text-dim); }
  .check .bad { color: var(--danger); }
  .link { margin-left: 6px; color: var(--link); font-weight: 600; }

  .people { display: flex; gap: 16px; margin-bottom: 8px; font-size: 13px; color: var(--text-dim); }
  .people > span { display: inline-flex; align-items: center; gap: 6px; }
  .orb-slot { width: 22px; height: 22px; display: inline-flex; align-items: center; justify-content: center; }
  .orb-head { display: flex; align-items: center; justify-content: space-between; margin-top: 16px; }
  .orb-head h3 { margin: 0; }
  .orb-box { width: 34px; height: 34px; display: inline-flex; align-items: center; justify-content: center; background: var(--bg-2); border: 1px solid var(--line); }
  .orb-row { display: grid; grid-template-columns: 64px minmax(0, 1fr) auto; align-items: center; gap: 8px; min-height: 36px; margin-top: 2px; }
  .orb-row label { margin: 0; font-size: 13px; font-weight: 500; color: var(--text); }
  .orb-row select { grid-column: 2 / -1; height: 30px; padding-block: 3px; }
  .orb-row output { min-width: 34px; text-align: right; font-size: 12px; color: var(--text-dim); font-variant-numeric: tabular-nums; }
</style>
