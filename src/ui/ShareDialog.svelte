<script lang="ts">
  import { onDestroy } from 'svelte';
  import Modal from './Modal.svelte';
  import { share, QUALITY } from '../lib/share.svelte.ts';
  import { desktop, type ScreenSource } from '../lib/native.ts';
  import { store } from '../lib/settings.svelte.ts';

  // Everything is chosen here, with a preview, before anything is sent: what to show, which
  // sound goes with it and the quality. In a browser, and on Wayland, the system's own dialog
  // picks the screen or window.
  let { onclose }: { onclose: () => void } = $props();
  const target = share.dialog!;

  let info = $state<{ portal: boolean; audio: 'pipewire' | 'loopback' | 'browser' | 'none'; micLabel: string }>({ portal: true, audio: desktop ? 'none' : 'browser', micLabel: '' });
  let sources = $state<ScreenSource[]>([]);
  let selected = $state('');
  let preview = $state.raw<MediaStream | null>(null);
  let apps = $state<string[]>([]);
  // '' none, 'all' everything, 'app:<name>' one program
  let audio = $state('');
  let browserAudio = $state(false);
  let busy = $state(false);
  let error = $state('');
  let handedOver = false;
  let video = $state<HTMLVideoElement>();
  $effect(() => { if (video) video.srcObject = preview; });

  const fps = () => QUALITY[store.settings.shareQuality].fps;

  let listing = $state(false);
  async function loadSources() {
    if (!desktop) return;
    listing = true;
    try {
      sources = (await desktop.screenSources(false)).sources;
    } finally {
      listing = false;
    }
    // Pictures follow when they are ready
    const pictures = new Map((await desktop.screenSources(true)).sources.map(s => [s.id, s.thumbnail]));
    sources = sources.map(s => ({ ...s, thumbnail: pictures.get(s.id) ?? s.thumbnail }));
  }
  const loadApps = async () => { if (desktop && info.audio === 'pipewire') apps = await desktop.shareAudioApps(); };

  if (desktop) {
    desktop.shareInfo().then(async i => {
      info = i;
      loadApps();
      if (!i.portal) await loadSources();
    });
  }

  function dropPreview() {
    preview?.getTracks().forEach(t => t.stop());
    preview = null;
  }

  async function show(id: string) {
    error = '';
    dropPreview();
    selected = id;
    try {
      desktop!.pickScreenSource(id);
      preview = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: fps() }, audio: false });
    } catch (e) {
      error = `Could not capture this: ${(e as Error).message}`;
    }
  }

  // The system's or the browser's picker
  async function chooseElsewhere() {
    error = '';
    try {
      if (desktop) {
        const { sources: picked } = await desktop.screenSources(false);
        if (!picked.length) return;
        sources = picked;
        await show(picked[0].id);
      } else {
        dropPreview();
        preview = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: fps() }, audio: browserAudio });
      }
    } catch (e) {
      if ((e as Error).name !== 'NotAllowedError') error = `Could not capture the screen: ${(e as Error).message}`;
    }
  }

  // The virtual microphone shows up as a recording device a moment after it is created
  async function virtualMic(): Promise<MediaStreamTrack> {
    const find = async () => (await navigator.mediaDevices.enumerateDevices()).find(d => d.kind === 'audioinput' && d.label.includes(info.micLabel));
    let device = await find();
    for (let i = 0; i < 20 && !device; i++) {
      await new Promise(r => setTimeout(r, 150));
      device = await find();
    }
    if (!device) throw new Error('The audio capture device did not appear.');
    const s = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: { exact: device.deviceId }, echoCancellation: false, autoGainControl: false, noiseSuppression: false, channelCount: 2 }
    });
    return s.getAudioTracks()[0];
  }

  async function start() {
    if (!preview) return;
    busy = true;
    error = '';
    let usesVirtualMic = false;
    try {
      if (audio && info.audio === 'pipewire') {
        usesVirtualMic = true;
        await desktop!.shareAudioStart(audio === 'all' ? { kind: 'all' } : { kind: 'app', name: audio.slice(4) });
        preview.addTrack(await virtualMic());
      } else if (audio && info.audio === 'loopback') {
        // System sound comes with a capture request; only its audio track is kept
        desktop!.pickScreenSource(selected);
        const extra = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        extra.getVideoTracks().forEach(t => t.stop());
        const track = extra.getAudioTracks()[0];
        if (track) preview.addTrack(track);
      }
    } catch (e) {
      if (usesVirtualMic) desktop!.shareAudioStop();
      error = `Could not capture the sound: ${(e as Error).message}`;
      busy = false;
      return;
    }
    handedOver = true;
    share.go(target, preview, usesVirtualMic);
    onclose();
  }

  onDestroy(() => { if (!handedOver) dropPreview(); });
</script>

<Modal title="Share your screen" {onclose} width={760}>
  <p class="help">mumh5 users in your channel can watch. Nothing is sent until you press Start sharing.</p>

  {#if !desktop && info.audio === 'browser'}
    <label class="check"><input type="checkbox" bind:checked={browserAudio} disabled={!!preview} /> Include sound (the browser offers what it can share, usually a tab's sound)</label>
  {/if}

  {#if desktop && !info.portal}
    <div class="row head"><label for="sh-src">Screen or window</label><button class="link" onclick={loadSources}>Refresh</button></div>
    <ul class="sources" id="sh-src">
      {#each sources as s (s.id)}
        <li>
          <button class:active={selected === s.id} aria-pressed={selected === s.id} onclick={() => show(s.id)}>
            {#if s.thumbnail}<img src={s.thumbnail} alt="" />{:else}<span class="blank"></span>{/if}
            <span class="name">{s.name}</span>
          </button>
        </li>
      {:else}
        <li class="dim">{listing ? 'Looking for screens and windows...' : 'Nothing found. Try Refresh.'}</li>
      {/each}
    </ul>
  {:else}
    <div class="row"><button class="btn" onclick={chooseElsewhere}>{preview ? 'Choose another screen or window...' : 'Choose a screen or window...'}</button></div>
  {/if}

  <span class="label">Preview</span>
  <div class="preview">
    <!-- svelte-ignore a11y_media_has_caption -->
    <video bind:this={video} autoplay playsinline muted></video>
    {#if !preview}<p>Nothing chosen yet</p>{/if}
  </div>

  <div class="row two">
    {#if desktop}
      <div>
        <label for="sh-audio">Sound</label>
        {#if info.audio === 'pipewire'}
          <select id="sh-audio" bind:value={audio} onfocus={loadApps}>
            <option value="">No sound</option>
            <option value="all">Everything except mumh5</option>
            {#each apps as a (a)}<option value={`app:${a}`}>{a}</option>{/each}
          </select>
        {:else if info.audio === 'loopback'}
          <select id="sh-audio" bind:value={audio}>
            <option value="">No sound</option>
            <option value="all">Whole system (viewers also hear the voice chat again)</option>
          </select>
        {:else}
          <select id="sh-audio" disabled><option>Not available on this system</option></select>
        {/if}
      </div>
    {/if}
    <div>
      <label for="sh-quality">Quality</label>
      <select id="sh-quality" bind:value={store.settings.shareQuality} onchange={() => store.saveSettings()}>
        {#each Object.entries(QUALITY) as [id, q] (id)}<option value={id}>{q.label}</option>{/each}
      </select>
    </div>
  </div>

  {#if error}<p class="err">{error}</p>{/if}

  {#snippet footer()}
    <button class="btn" onclick={onclose}>Cancel</button>
    <button class="btn primary" disabled={!preview || busy} onclick={start}>{busy ? 'Starting...' : 'Start sharing'}</button>
  {/snippet}
</Modal>

<style>
  .help { margin: 8px 0 0; font-size: 13px; color: var(--text-dim); }
  .row { display: flex; align-items: center; gap: 8px; margin-top: 12px; }
  .row.head { justify-content: space-between; margin-top: 0; }
  .row.two { align-items: flex-end; gap: 12px; }
  .row.two > div { flex: 1; min-width: 0; }
  .label { display: block; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-dim); margin: 14px 0 6px; }
  .link { color: var(--link); font-size: 13px; margin-top: 8px; }
  .sources { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; max-height: 190px; overflow-y: auto; }
  .sources button { width: 100%; display: flex; flex-direction: column; gap: 4px; padding: 6px; text-align: left; border: 1px solid var(--line); background: var(--bg-0); }
  .sources button:hover { border-color: var(--text-faint); }
  .sources button.active { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
  img, .blank { width: 100%; aspect-ratio: 16 / 9; object-fit: contain; background: #000; display: block; }
  .name { font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .preview { position: relative; background: #000; aspect-ratio: 16 / 9; max-height: 240px; margin: 0 auto; width: 100%; }
  .preview video { width: 100%; height: 100%; object-fit: contain; display: block; }
  .preview p { position: absolute; inset: 0; margin: 0; display: flex; align-items: center; justify-content: center; color: #aaa; font-size: 13px; }
  .check { display: flex; align-items: center; gap: 8px; text-transform: none; font-weight: 400; letter-spacing: 0; font-size: 14px; color: var(--text); margin-top: 12px; }
  .check input { width: auto; }
  .dim { color: var(--text-dim); font-size: 13px; }
  .err { color: var(--danger); font-size: 13px; margin: 10px 0 0; }
</style>
