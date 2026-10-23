<script lang="ts">
  import Icon from './Icon.svelte';
  import { sounds, SOUND_EVENTS, type SoundEvent } from '../lib/audio/sounds.svelte.ts';

  const s = sounds.settings;
  let picker: HTMLInputElement;
  let packPicker: HTMLInputElement;
  let folderPicker: HTMLInputElement;
  const groups = [...new Set(SOUND_EVENTS.map(e => e.group))];
  let target: SoundEvent | null = null;
  let report = $state<{ assigned: string[]; unmatched: string[] } | null>(null);
  let error = $state('');

  function choose(ev: SoundEvent) {
    target = ev;
    picker.click();
  }

  async function picked() {
    const f = picker.files?.[0];
    picker.value = '';
    if (!f || !target) return;
    error = (await sounds.setCustom(target, f)) ?? '';
    if (!error) sounds.play(target, true);
  }

  async function pack(input: HTMLInputElement) {
    const files = [...(input.files ?? [])];
    input.value = '';
    if (files.length) report = await sounds.loadPack(files);
  }
</script>

<h3>Notification sounds</h3>
<label class="check"><input type="checkbox" checked={s.enabled} onchange={e => sounds.update({ enabled: e.currentTarget.checked })} /> Play sounds for events</label>
<label for="snd-vol">Volume: {Math.round(s.volume * 100)}%</label>
<input id="snd-vol" type="range" min="0" max="1" step="0.05" value={s.volume} oninput={e => sounds.update({ volume: Number(e.currentTarget.value) })} />

<div class="packrow">
  <button class="btn" onclick={() => folderPicker.click()}>Load sound pack folder...</button>
  <button class="btn" onclick={() => packPicker.click()}>Load sound pack...</button>
  <button class="btn" onclick={() => { sounds.resetAll(); report = null; }}>Reset all to built-in</button>
  <input bind:this={folderPicker} type="file" webkitdirectory multiple hidden onchange={() => pack(folderPicker)} />
  <input bind:this={packPicker} type="file" accept="audio/*,.wav,.mp3,.ogg,.opus,.flac,.m4a,.ini" multiple hidden onchange={() => pack(packPicker)} />
</div>
<p class="help">A TeamSpeak 3 sound pack folder (with its <code>settings.ini</code>) is mapped exactly. Other files are matched by name, e.g. <code>user_joined.wav</code>. Any sound can also be set one by one below.</p>
{#if report}
  <div class="report">
    {#if report.assigned.length}<p>Assigned: {report.assigned.join('; ')}</p>{/if}
    {#if report.unmatched.length}<p class="warn">Not matched (set these by hand): {report.unmatched.join(', ')}</p>{/if}
  </div>
{/if}
{#if error}<p class="error">{error}</p>{/if}
{#each sounds.errors as err (err)}<p class="error">Could not play {err}</p>{/each}

<input bind:this={picker} type="file" accept="audio/*,.wav,.mp3,.ogg,.opus,.flac,.m4a" hidden onchange={picked} />
{#each groups as g (g)}
<h4>{g}</h4>
<ul class="events" class:disabled={!s.enabled}>
  {#each SOUND_EVENTS.filter(e => e.group === g) as e (e.id)}
    {@const custom = s.custom[e.id]}
    <li>
      <label class="check ev"><input type="checkbox" checked={sounds.isOn(e.id)} onchange={x => sounds.setOn(e.id, x.currentTarget.checked)} /> {e.name}</label>
      <span class="file" title={custom?.name ?? 'Built-in sound'}>{custom?.name ?? 'Built-in'}</span>
      <button class="icon-btn" title="Play" aria-label="Play {e.name}" onclick={() => sounds.play(e.id, true)}><Icon name="channel" size={16} /></button>
      <button class="link" onclick={() => choose(e.id)}>Choose file</button>
      {#if custom}<button class="link" onclick={() => sounds.reset(e.id)}>Reset</button>{/if}
    </li>
  {/each}
</ul>
{/each}

<style>
  h3 { margin: 8px 0 0; font-size: 15px; font-weight: 650; }
  .check { display: flex; align-items: center; gap: 8px; text-transform: none; font-weight: 400; letter-spacing: 0; font-size: 14px; color: var(--text); margin-top: 10px; }
  input[type=range] { padding: 0; border: 0; background: transparent; accent-color: var(--accent); }
  .packrow { display: flex; align-items: center; gap: 8px; margin-top: 14px; flex-wrap: wrap; }
  .packrow .btn { flex: none; }
  h4 { margin: 16px 0 0; font-size: 11px; font-weight: 650; text-transform: uppercase; letter-spacing: 0.07em; color: var(--text-dim); }
  .help { font-size: 12px; color: var(--text-dim); }
  code { font: 12px var(--mono); }
  .report { margin-top: 8px; font-size: 13px; color: var(--text-dim); }
  .report p { margin: 4px 0 0; }
  .warn { color: var(--warn); }
  .error { color: var(--danger); font-size: 13px; }
  .events { list-style: none; margin: 6px 0 0; padding: 0; border-top: 1px solid var(--line); }
  .events.disabled { opacity: 0.5; }
  .events li { display: flex; align-items: center; gap: 8px; padding: 4px 0; border-bottom: 1px solid var(--line); }
  .ev { flex: 1; margin: 0; min-width: 0; }
  .file { max-width: 160px; font-size: 12px; color: var(--text-faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .link { color: var(--link); font-size: 13px; white-space: nowrap; }
</style>
