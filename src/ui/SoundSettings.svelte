<script lang="ts">
  import Icon from './Icon.svelte';
  import { sounds, SOUND_EVENTS, type SoundEvent } from '../lib/audio/sounds.svelte.ts';
  import { PACK_PATHS } from '../core/sound-events.ts';
  import { store } from '../lib/settings.svelte.ts';
  import { notifyPermission, askNotifyPermission } from '../lib/notify.ts';

  const s = sounds.settings;
  let picker: HTMLInputElement;
  let packPicker: HTMLInputElement;
  let folderPicker: HTMLInputElement;
  let zipPicker: HTMLInputElement;
  const groups = [...new Set(SOUND_EVENTS.map(e => e.group))];
  let target: SoundEvent | null = null;
  let report = $state<{ assigned: string[]; unmatched: string[] } | null>(null);
  let error = $state('');
  let permission = $state(notifyPermission());

  async function pokeNotify(on: boolean) {
    store.settings.pokeNotify = on;
    store.saveSettings();
    if (on) permission = await askNotifyPermission();
  }

  function choose(ev: SoundEvent) {
    target = ev;
    picker.click();
  }

  async function picked() {
    const f = picker.files?.[0];
    picker.value = '';
    if (!f || !target) return;
    await working(async () => {
      error = (await sounds.setCustom(target!, f)) ?? '';
      if (!error) void sounds.play(target!, true);
    });
  }

  async function working(action: () => Promise<void>) {
    sounds.busy = true;
    error = '';
    try { await action(); }
    catch (e) { error = (e as Error).message; }
    finally { sounds.busy = false; }
  }

  async function pack(input: HTMLInputElement) {
    const files = [...(input.files ?? [])];
    input.value = '';
    if (files.length) await working(async () => { report = await sounds.loadPack(files); });
  }

  async function zip() {
    const file = zipPicker.files?.[0];
    zipPicker.value = '';
    if (file) await working(async () => { report = await sounds.importZip(file); });
  }
</script>

<h3>System notifications</h3>
<label class="check" title="Only while the window is in the background; in front of you the popup shows it"><input type="checkbox" checked={store.settings.pokeNotify} onchange={e => pokeNotify(e.currentTarget.checked)} /> When someone pokes you</label>
{#if store.settings.pokeNotify && permission === 'denied'}<p class="help">Blocked in the browser's site settings.</p>
{:else if store.settings.pokeNotify && permission === 'unsupported'}<p class="help">Not available here.</p>{/if}

<h3 class="gap">Notification sounds</h3>
<fieldset disabled={!sounds.loaded || sounds.busy}>
<label class="check"><input type="checkbox" checked={s.enabled} onchange={e => sounds.update({ enabled: e.currentTarget.checked })} /> Play sounds for events</label>
<label for="snd-vol">Volume: {Math.round(s.volume * 100)}%</label>
<input id="snd-vol" type="range" min="0" max="1" step="0.05" value={s.volume} oninput={e => sounds.update({ volume: Number(e.currentTarget.value) })} />

<div class="packrow">
  <button class="btn" onclick={() => zipPicker.click()}>Import ZIP audio pack...</button>
  <button class="btn" onclick={() => folderPicker.click()}>Load sound pack folder...</button>
  <button class="btn" onclick={() => packPicker.click()}>Load sound pack...</button>
  <button class="btn" onclick={() => working(async () => { await sounds.resetAll(); report = null; })}>Reset all to built-in</button>
  <button class="btn" onclick={() => sounds.quietDefaults()}>Use quiet defaults</button>
  <button class="btn" onclick={() => sounds.stop()}>Stop preview</button>
  <input bind:this={zipPicker} type="file" accept=".zip,application/zip" hidden onchange={zip} />
  <input bind:this={folderPicker} type="file" webkitdirectory multiple hidden onchange={() => pack(folderPicker)} />
  <input bind:this={packPicker} type="file" accept="audio/*,.wav,.mp3,.ogg,.opus,.flac,.m4a,.ini" multiple hidden onchange={() => pack(packPicker)} />
</div>
<p class="help">Audio pack: <strong>{s.pack?.name ?? 'Chatterbox female (standard)'}</strong>. {sounds.packClips.length} clips available.</p>
<p class="help">ZIP packs use notification folders at the root, for example <code>AudioNotification/SelfMute.wav</code>. Missing clips use the standard pack. Individual files override pack clips. TeamSpeak 3 folders with <code>settings.ini</code> are also supported.</p>
<p class="help">Quiet defaults play only connection loss, direct messages and pokes. Enable other events below. Importing a pack keeps your event choices. Sounds play one at a time without a queue.</p>
{#if !sounds.loaded}<p class="help" role="status">Loading audio pack...</p>{/if}
{#if sounds.busy}<p class="help" role="status">Saving sounds...</p>{/if}
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
      {#if custom}
        <span class="file" title={custom.name}>{custom.name}</span>
      {:else}
        <select class="clip" aria-label="Clip for {e.name}" title={sounds.clipFor(e.id) ?? 'Short tone'} value={s.clips?.[e.id] ?? ''}
          onchange={x => sounds.selectClip(e.id, x.currentTarget.value)}>
          <option value="">Automatic: {PACK_PATHS[e.id]?.split('/').at(-1) ?? 'short tone'}</option>
          {#each sounds.packClips as clip (clip)}<option value={clip}>{clip}</option>{/each}
        </select>
      {/if}
      <button class="icon-btn" title="Play" aria-label="Play {e.name}" onclick={() => sounds.play(e.id, true)}><Icon name="channel" size={16} /></button>
      <button class="link" onclick={() => choose(e.id)}>Choose file</button>
      {#if custom || s.clips?.[e.id]}<button class="link" onclick={() => working(() => sounds.reset(e.id))}>Reset</button>{/if}
    </li>
  {/each}
</ul>
{/each}
</fieldset>

<style>
  h3 { margin: 8px 0 0; font-size: 15px; font-weight: 650; }
  h3.gap { margin-top: 22px; }
  fieldset { border: 0; padding: 0; margin: 0; min-width: 0; }
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
  .clip { width: 180px; min-width: 0; font-size: 12px; padding: 4px; }
  .link { color: var(--link); font-size: 13px; white-space: nowrap; }
  @media (max-width: 650px) {
    .events li { flex-wrap: wrap; }
    .ev { flex-basis: 100%; }
    .clip { flex: 1; }
  }
</style>
