<script lang="ts">
  import Modal from './Modal.svelte';
  import VoiceSettings from './VoiceSettings.svelte';
  import IdentityList from './IdentityList.svelte';
  import AppearanceSettings from './AppearanceSettings.svelte';
  import SoundSettings from './SoundSettings.svelte';
  import { store } from '../lib/settings.svelte.ts';
  import { native, desktop, isWeb } from '../lib/native.ts';
  import { fetchUploadInfo } from '../lib/upload.ts';
  import { previewMode } from '../lib/preview.ts';

  let { onclose, tab: initialTab = 'voice' }: { onclose: () => void; tab?: 'voice' | 'sounds' | 'appearance' | 'accessibility' | 'files' | 'identities' } = $props();

  // svelte-ignore state_referenced_locally
  let tab = $state<'voice' | 'sounds' | 'appearance' | 'accessibility' | 'files' | 'identities'>(initialTab);
  const s = store.settings;
  let embedHosts = $state(s.embedHosts.join('\n'));
  let testResult = $state('');

  // Public STUN servers to pick from; anything else is typed in
  const STUN_PRESETS = [
    { name: 'Google', url: 'stun.l.google.com:19302' },
    { name: 'Cloudflare', url: 'stun.cloudflare.com:3478' }
  ];
  let stunCustom = $state(!!s.stunServer && !STUN_PRESETS.some(p => p.url === s.stunServer));
  const stunChoice = $derived(stunCustom ? 'custom' : s.stunServer);
  function chooseStun(value: string) {
    stunCustom = value === 'custom';
    // Keep what was typed when switching to "another server"
    if (!stunCustom) s.stunServer = value;
    else if (STUN_PRESETS.some(p => p.url === s.stunServer)) s.stunServer = '';
    store.saveSettings();
  }
  // Settings that only work through the upload host are disabled until it is set up
  const hasUpload = $derived(!!(s.uploadHost.trim() && s.uploadKey.trim()));
  const needsUpload = $derived(hasUpload ? undefined : 'Needs an upload host and key');

  // Changes apply right away
  function saveFiles() {
    s.uploadHost = s.uploadHost.trim().replace(/\/+$/, '');
    s.uploadKey = s.uploadKey.trim();
    s.embedHosts = embedHosts.split(/[\s,]+/).map(h => h.trim()).filter(Boolean);
    store.saveSettings();
  }

  async function test() {
    saveFiles();
    testResult = 'Checking...';
    try {
      const info = await fetchUploadInfo(s.uploadHost, s.uploadKey);
      testResult = `Key works. Allowed: ${info.allowed_extensions.join(', ')} (max ${Math.round(info.max_bytes / 1048576)} MB)`;
    } catch (e) {
      testResult = (e as Error).message;
    }
  }

  type Tab = 'voice' | 'sounds' | 'appearance' | 'accessibility' | 'files' | 'identities';
  const tabs: { id: Tab; label: string }[] = [
    { id: 'voice', label: 'Voice' },
    { id: 'sounds', label: 'Sounds' },
    { id: 'appearance', label: 'Appearance' },
    { id: 'accessibility', label: 'Accessibility' },
    { id: 'files', label: 'Chat and files' },
    ...(native ? [{ id: 'identities' as Tab, label: 'Identities' }] : [])
  ];
</script>

<Modal title="Settings" onclose={() => { saveFiles(); onclose(); }} width={640}>
  <div class="tabs" role="tablist">
    {#each tabs as t (t.id)}
      <button role="tab" aria-selected={tab === t.id} class:active={tab === t.id} onclick={() => (tab = t.id)}>{t.label}</button>
    {/each}
  </div>

  {#if tab === 'voice'}
    <VoiceSettings />
    <h3>Screen sharing</h3>
    <label for="s-stun">STUN server</label>
    <select id="s-stun" value={stunChoice} onchange={e => chooseStun(e.currentTarget.value)}>
      <option value="">{isWeb ? 'This site\'s own server' : 'None (same network only)'}</option>
      {#each STUN_PRESETS as p (p.url)}<option value={p.url}>{p.name} ({p.url})</option>{/each}
      <option value="custom">Another server...</option>
    </select>
    {#if stunChoice === 'custom'}
      <input class="stun-custom" bind:value={s.stunServer} onchange={() => store.saveSettings()} placeholder="stun.example.com:3478" autocomplete="off" aria-label="STUN server address" />
    {/if}
    <p class="help">Screen sharing connects you directly to the people watching. Across the internet both sides need a STUN server to find a route; it learns your IP address but never sees the stream. {isWeb ? 'By default the site you are on provides it.' : 'With none, no outside server is contacted and streams only work on the same network.'} Networks that block direct connections, like many mobile ones, need more than STUN.</p>
  {:else if tab === 'sounds'}
    <SoundSettings />
  {:else if tab === 'appearance'}
    <AppearanceSettings />
  {:else if tab === 'accessibility'}
    <label class="check"><input type="checkbox" bind:checked={s.hints} onchange={() => store.saveSettings()} /> Show hints when the pointer rests on buttons and icons</label>
    <p class="help">Hints are the small labels that appear on hover. Screen readers get the names either way.</p>
  {:else if tab === 'files'}
    <p class="help">Files go to a f0ckm instance and are posted as links. Other mumh5 users see them inline; regular Mumble users get a link and a small preview. Without an upload host you can still send images, inline and scaled to the server's limit.</p>
    <label for="s-host">Upload host</label>
    <input id="s-host" bind:value={s.uploadHost} onchange={saveFiles} placeholder="https://f0ck.dev" />
    <label for="s-key">Upload key</label>
    <input id="s-key" type="password" bind:value={s.uploadKey} onchange={saveFiles} placeholder="cu_..." autocomplete="off" />
    <div class="row">
      <div title={needsUpload}>
        <label for="s-exp" class:off={!hasUpload}>Files expire after</label>
        <select id="s-exp" bind:value={s.uploadExpiry} onchange={saveFiles} disabled={!hasUpload}>
          <option value="1h">1 hour</option>
          <option value="24h">24 hours</option>
          <option value="7d">7 days</option>
          <option value="30d">30 days</option>
        </select>
      </div>
      <button class="btn" disabled={!hasUpload} title={needsUpload} onclick={test}>Test key</button>
    </div>
    {#if testResult}<p class="help">{testResult}</p>{/if}
    <label class="check" class:off={!hasUpload} title={needsUpload}><input type="checkbox" bind:checked={s.sendThumbnails} onchange={saveFiles} disabled={!hasUpload} /> Send image previews for regular Mumble clients</label>

    <h3>Embeds</h3>
    <label for="s-embed">Also show media inline from these hosts</label>
    <textarea id="s-embed" bind:value={embedHosts} onchange={saveFiles} rows="3" placeholder="one host per line, e.g. i.example.com"></textarea>
    <p class="help">Links from other hosts stay plain links, so opening a chat never contacts servers you did not choose.</p>
    <label for="s-lp">Link previews</label>
    <!-- Shows the mode in effect; a stored "upload host" choice comes back once the key is set -->
    <select id="s-lp" value={previewMode()} onchange={e => { s.linkPreviews = e.currentTarget.value as typeof s.linkPreviews; saveFiles(); }}>
      <option value="host" disabled={!hasUpload}>Fetched by the upload host (keeps your IP private){hasUpload ? '' : ' - needs an upload host and key'}</option>
      <option value="direct" disabled={!desktop}>Fetched by this computer (linked sites see your IP){desktop ? '' : ' - needs the desktop app'}</option>
      <option value="off">Off</option>
    </select>
    <label for="s-yt">YouTube links</label>
    <select id="s-yt" bind:value={s.youtube} onchange={saveFiles}>
      <option value="off">Plain links</option>
      <option value="click">Player card, loads from YouTube when clicked</option>
      <option value="thumbnail">Player card with thumbnail (loads the thumbnail from YouTube)</option>
    </select>
  {:else}
    <p class="help">Servers recognize you by your certificate. The default is used unless a server is set to another one.{isWeb ? ' Certificates are kept in this browser and passed to the proxy when you connect.' : ''}</p>
    <IdentityList />
  {/if}

  {#snippet footer()}
    <button class="btn primary" onclick={() => { saveFiles(); onclose(); }}>Done</button>
  {/snippet}
</Modal>

<style>
  .tabs { display: flex; gap: 2px; margin: 8px 0 4px; border-bottom: 1px solid var(--line); overflow-x: auto; }
  .tabs button { padding: 8px 14px; color: var(--text-dim); font-weight: 600; white-space: nowrap; }
  .tabs button.active { color: var(--text); box-shadow: inset 0 -2px 0 var(--accent); }
  h3 { margin: 22px 0 0; font-size: 14px; }
  .stun-custom { margin-top: 6px; }
  .help { margin: 10px 0 0; font-size: 13px; color: var(--text-dim); }
  .row { display: flex; align-items: flex-end; gap: 8px; }
  .row > div { flex: 1; }
  .check { display: flex; align-items: center; gap: 8px; text-transform: none; font-weight: 400; letter-spacing: 0; font-size: 14px; color: var(--text); margin-top: 14px; }
  .check input { width: auto; }
  .off { color: var(--text-faint); }
  select:disabled, input:disabled { opacity: 0.5; }
  textarea { resize: vertical; }
</style>
