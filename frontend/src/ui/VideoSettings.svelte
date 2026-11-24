<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte';
  import { store } from '../lib/settings.svelte.ts';
  import { share } from '../lib/share.svelte.ts';
  import { sessions } from '../lib/session.svelte.ts';
  import { CAMERA_RATES, CAMERA_SIZES, cameraBitrate, cameraError, openCamera } from '../lib/camera.ts';

  const s = store.settings;
  const available = !!navigator.mediaDevices?.getUserMedia;

  // Names and ids are only given out once a camera was allowed
  let devices = $state.raw<MediaDeviceInfo[]>([]);
  let found = $state<boolean | null>(null);
  async function list() {
    if (!available) return;
    const all = (await navigator.mediaDevices.enumerateDevices().catch(() => [])).filter(d => d.kind === 'videoinput');
    found = all.length > 0;
    devices = all.filter(d => d.deviceId);
  }

  // The camera only comes on when asked; while it is on for the channel, that stream is shown
  let own = $state.raw<MediaStream | null>(null);
  let opening = $state(false);
  let error = $state('');
  let run = 0;
  const shown = $derived(share.cameraOn ? share.stream : own);

  function dropOwn() {
    own?.getTracks().forEach(t => t.stop());
    own = null;
  }
  function stopPreview() {
    run++;
    dropOwn();
    opening = false;
  }
  async function startPreview() {
    const mine = ++run;
    dropOwn();
    error = '';
    opening = true;
    try {
      const stream = await openCamera();
      if (mine !== run) return stream.getTracks().forEach(t => t.stop());
      own = stream;
      await list();
    } catch (e) {
      if (mine === run) error = cameraError(e);
    } finally {
      if (mine === run) opening = false;
    }
  }

  // Any change, a reset included, reaches what is running
  let last = { device: s.cameraDevice, size: s.cameraSize, fps: s.cameraFps };
  $effect(() => {
    const now = { device: s.cameraDevice, size: s.cameraSize, fps: s.cameraFps };
    untrack(() => {
      if (now.device === last.device && now.size === last.size && now.fps === last.fps) return;
      const deviceChanged = now.device !== last.device;
      last = now;
      if (share.cameraOn) share.applyCamera(deviceChanged);
      else if (own || opening) startPreview();
    });
  });
  $effect(() => { if (share.cameraOn && untrack(() => own || opening)) untrack(stopPreview); });

  let video = $state<HTMLVideoElement>();
  let actual = $state('');
  function measure() {
    const rate = shown?.getVideoTracks()[0]?.getSettings().frameRate;
    actual = video?.videoWidth ? `${video.videoWidth} x ${video.videoHeight}${rate ? ` at ${Math.round(rate)} fps` : ''}` : '';
  }
  $effect(() => {
    if (!video) return;
    video.srcObject = shown;
    if (!shown) actual = '';
  });
  const mirrored = $derived(s.cameraMirror && shown?.getVideoTracks()[0]?.getSettings().facingMode !== 'environment');

  onMount(() => {
    list();
    navigator.mediaDevices?.addEventListener('devicechange', list);
    return () => navigator.mediaDevices?.removeEventListener('devicechange', list);
  });
  onDestroy(stopPreview);

  const save = () => store.saveSettings();
  const missing = $derived(!!s.cameraDevice && !devices.some(d => d.deviceId === s.cameraDevice));
  const mbit = (n: number) => `${(n / 1_000_000).toFixed(1)} Mbit/s`;
</script>

<div class="video">
  <h3>Camera</h3>
  {#if !available}
    <p class="error">This page cannot use a camera. Browsers only allow it on https.</p>
  {:else if found === false}
    <p class="error">No camera was found.</p>
  {/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}

  <label for="c-device">Device</label>
  <select id="c-device" bind:value={s.cameraDevice} onchange={save} disabled={!available}>
    <option value="">System default</option>
    {#each devices as d, i (d.deviceId)}<option value={d.deviceId}>{d.label || `Camera ${i + 1}`}</option>{/each}
    {#if missing}<option value={s.cameraDevice}>{devices.length ? 'Saved camera (not connected)' : 'Saved camera'}</option>{/if}
  </select>

  <div class="preview">
    <!-- svelte-ignore a11y_media_has_caption -->
    <video bind:this={video} class:mirror={mirrored} autoplay playsinline muted aria-label="Camera preview" onresize={measure} onloadedmetadata={measure}></video>
    {#if !shown}<p>{opening ? 'Opening the camera...' : 'Camera is off'}</p>{/if}
  </div>
  <div class="row">
    {#if share.cameraOn}
      <span class="note">Your channel can see this. Changes apply right away.</span>
    {:else if own || opening}
      <button class="btn" onclick={stopPreview}>Stop preview</button>
    {:else}
      <button class="btn" disabled={!available || found === false} onclick={startPreview}>Preview camera</button>
    {/if}
    {#if actual}<span class="note actual" role="status">{actual}</span>{/if}
  </div>

  <div class="grid">
    <div>
      <label for="c-size">Resolution</label>
      <select id="c-size" bind:value={s.cameraSize} onchange={save}>
        {#each Object.entries(CAMERA_SIZES) as [id, c] (id)}<option value={id}>{c.label}</option>{/each}
      </select>
    </div>
    <div>
      <label for="c-fps">Frame rate</label>
      <select id="c-fps" value={String(s.cameraFps)} onchange={e => { s.cameraFps = Number(e.currentTarget.value); save(); }}>
        {#each CAMERA_RATES as r (r)}<option value={String(r)}>{r} fps</option>{/each}
      </select>
    </div>
  </div>
  <p class="help">Sends up to {mbit(cameraBitrate())} to each person watching. A camera that cannot do this uses the nearest it has.</p>

  <label class="check"><input type="checkbox" bind:checked={s.cameraMirror} onchange={save} /> Mirror my own picture</label>
  <p class="help">Only for you. Others always see it the right way around.</p>

  <h3>Other people</h3>
  <label class="check"><input type="checkbox" checked={s.autoCameras}
    onchange={async e => { const box = e.currentTarget; await share.setCams(sessions.active, box.checked); box.checked = s.autoCameras; }} /> Show cameras when people turn them on</label>
  <p class="help">Cameras connect you directly to the people in your channel, so you see each other's IP address. The routes are set in Screen sharing.</p>
</div>

<style>
  h3 { margin: 24px 0 0; font-size: 15px; font-weight: 650; }
  h3:first-of-type { margin-top: 8px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 12px; }
  .preview { position: relative; margin-top: 12px; aspect-ratio: 16 / 9; max-height: 300px; width: 100%; background: #000; border: 1px solid var(--line); }
  .preview video { width: 100%; height: 100%; object-fit: contain; display: block; }
  .preview video.mirror { transform: scaleX(-1); }
  .preview p { position: absolute; inset: 0; margin: 0; display: flex; align-items: center; justify-content: center; color: #aaa; font-size: 13px; }
  .row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin-top: 8px; min-height: var(--control-h); }
  .note { font-size: 13px; color: var(--text-dim); }
  .actual { margin-left: auto; font-variant-numeric: tabular-nums; }
  .help { margin: 6px 0 0; font-size: 13px; color: var(--text-dim); }
  .error { color: var(--danger); margin: 8px 0 0; font-size: 13px; }
  .check { display: flex; align-items: center; gap: 8px; text-transform: none; font-weight: 400; letter-spacing: 0; font-size: 14px; color: var(--text); margin-top: 14px; }
  select:disabled { opacity: 0.5; }
  @media (max-width: 480px) { .grid { grid-template-columns: minmax(0, 1fr); } }
</style>
