<script lang="ts">
  import { voice, type TransmitMode } from '../lib/audio/voice.svelte.ts';
  import { ui } from '../lib/ui.svelte.ts';

  const q = $derived(ui.quickAudio!);
  const s = voice.settings;
  let el: HTMLDivElement | undefined = $state();
  let pos = $state({ x: 0, y: 0 });

  voice.refreshDevices();

  // Open above the button it came from, kept on screen
  $effect(() => {
    if (!el) return;
    const r = el.getBoundingClientRect();
    pos = {
      x: Math.max(8, Math.min(q.x - r.width / 2, window.innerWidth - r.width - 8)),
      y: Math.max(8, q.y - r.height - 8)
    };
  });

  const close = () => (ui.quickAudio = null);
  const METER_MIN = -80;
  const pct = (db: number) => Math.max(0, Math.min(100, ((db - METER_MIN) / -METER_MIN) * 100));
  const modes: { id: TransmitMode; label: string }[] = [
    { id: 'vad', label: 'Activity' }, { id: 'ptt', label: 'Push to talk' }, { id: 'continuous', label: 'Always on' }
  ];
</script>

<svelte:window onkeydown={e => { if (e.key === 'Escape') close(); }} onresize={close} />

<div class="catcher" role="presentation" onmousedown={close} oncontextmenu={e => { e.preventDefault(); close(); }}></div>
<div class="pop" role="dialog" aria-label={q.kind === 'input' ? 'Microphone' : 'Output'} bind:this={el} style:left="{pos.x}px" style:top="{pos.y}px">
  {#if q.kind === 'input'}
    <label for="qa-in">Microphone</label>
    <select id="qa-in" value={s.inputDevice} onchange={e => voice.update({ inputDevice: e.currentTarget.value })}>
      {#each voice.inputDevices as d (d.id)}<option value={d.id}>{d.label}</option>{:else}<option value="default">System default</option>{/each}
    </select>
    <label for="qa-gain">Input volume: {Math.round(s.inputGain * 100)}%</label>
    <input id="qa-gain" type="range" min="0" max="3" step="0.05" value={s.inputGain}
      oninput={e => voice.update({ inputGain: Number(e.currentTarget.value) })} />
    <div class="meter" aria-hidden="true"><div class="fill" class:open={s.mode !== 'vad' || voice.level > s.vadThreshold} style:width="{pct(voice.level)}%"></div></div>
    <div class="modes" role="radiogroup" aria-label="Transmit mode">
      {#each modes as m (m.id)}
        <button role="radio" aria-checked={s.mode === m.id} class:active={s.mode === m.id} onclick={() => voice.update({ mode: m.id })}>{m.label}</button>
      {/each}
    </div>
    <label class="check"><input type="checkbox" checked={s.noiseSuppression} onchange={e => voice.update({ noiseSuppression: e.currentTarget.checked })} /> Noise suppression</label>
  {:else}
    <label for="qa-out">Output device</label>
    <select id="qa-out" value={s.outputDevice} onchange={e => voice.update({ outputDevice: e.currentTarget.value })}>
      {#each voice.outputDevices as d (d.id)}<option value={d.id}>{d.label}</option>{:else}<option value="default">System default</option>{/each}
    </select>
    <label for="qa-vol">Output volume: {Math.round(s.outputVolume * 100)}%</label>
    <input id="qa-vol" type="range" min="0" max="2" step="0.05" value={s.outputVolume}
      oninput={e => voice.update({ outputVolume: Number(e.currentTarget.value) })} />
  {/if}
  <button class="more" onclick={() => { close(); ui.settingsTab = 'voice'; ui.settingsOpen = true; }}>Voice settings...</button>
</div>

<style>
  .catcher { position: fixed; inset: 0; z-index: 200; }
  .pop { position: fixed; z-index: 201; width: 260px; padding: 12px 14px 10px; background: var(--bg-1); border: 1px solid var(--line-strong); box-shadow: var(--shadow-pop); }
  label { margin-top: 10px; }
  label:first-child { margin-top: 0; }
  select { font-size: 13px; padding: 6px 8px; }
  input[type=range] { padding: 0; border: 0; background: transparent; accent-color: var(--accent); }
  .meter { height: 6px; background: var(--bg-3); margin-top: 4px; overflow: hidden; }
  .fill { height: 100%; background: var(--text-faint); transition: width 50ms linear; }
  .fill.open { background: var(--speaking); }
  .modes { display: flex; gap: 2px; margin-top: 10px; }
  .modes button { flex: 1; padding: 5px 4px; font-size: 12px; background: var(--bg-3); color: var(--text-dim); }
  .modes button.active { background: var(--accent); color: var(--accent-text); }
  .check { display: flex; align-items: center; gap: 8px; text-transform: none; font-weight: 400; letter-spacing: 0; font-size: 13px; color: var(--text); margin-top: 10px; }
  .more { display: block; width: 100%; margin-top: 10px; padding: 6px 0 0; border-top: 1px solid var(--line); text-align: left; font-size: 13px; color: var(--link); }
</style>
