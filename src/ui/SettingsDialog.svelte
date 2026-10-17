<script lang="ts">
  import Modal from './Modal.svelte';
  import VoiceSettings from './VoiceSettings.svelte';
  import IdentityList from './IdentityList.svelte';
  import AppearanceSettings from './AppearanceSettings.svelte';
  import SoundSettings from './SoundSettings.svelte';
  import { store } from '../lib/settings.svelte.ts';
  import { native, desktop, isWeb } from '../lib/native.ts';
  import { previewMode } from '../lib/preview.ts';
  import { files } from '../lib/files.svelte.ts';
  import { formatBytes } from '../lib/html.ts';

  let { onclose, tab: initialTab = 'voice' }: { onclose: () => void; tab?: 'voice' | 'sounds' | 'appearance' | 'accessibility' | 'files' | 'identities' } = $props();

  // svelte-ignore state_referenced_locally
  let tab = $state<'voice' | 'sounds' | 'appearance' | 'accessibility' | 'files' | 'identities'>(initialTab);
  const s = store.settings;
  let embedHosts = $state(s.embedHosts.join('\n'));

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
  // Changes apply right away
  function saveFiles() {
    s.embedHosts = embedHosts.split(/[\s,]+/).map(h => h.trim()).filter(Boolean);
    store.saveSettings();
  }
  // How much the kept files take, once the tab is open
  $effect(() => { if (tab === 'files') files.measure(); });

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
    <label for="s-relay">Relay <span class="opt">(optional)</span></label>
    <input id="s-relay" bind:value={s.relayServer} onchange={() => { s.relayServer = s.relayServer.trim(); store.saveSettings(); }}
      placeholder={isWeb ? 'this site (automatic)' : 'https://voice.example.com'} autocomplete="off" />
    <p class="help">The address of a mumh5 web version. When a direct connection is not possible (mobile data, strict company networks), the stream goes through that server instead, by itself. {isWeb ? 'Empty uses the site you are on.' : 'Its operator sees your IP address and carries the stream, but cannot watch it.'}</p>
    <p class="help">Screen sharing connects you directly to the people watching. Across the internet both sides need a STUN server to find a route; it learns your IP address but never sees the stream. {isWeb ? 'By default the site you are on provides it.' : 'With none, no outside server is contacted and streams only work on the same network.'} Networks that block direct connections, like many mobile ones, need more than STUN.</p>
  {:else if tab === 'sounds'}
    <SoundSettings />
  {:else if tab === 'appearance'}
    <AppearanceSettings />
  {:else if tab === 'accessibility'}
    <label class="check"><input type="checkbox" bind:checked={s.hints} onchange={() => store.saveSettings()} /> Show hints when the pointer rests on buttons and icons</label>
    <p class="help">Hints are the small labels that appear on hover. Screen readers get the names either way.</p>
  {:else if tab === 'files'}
    <p class="help">Files go through the Mumble server to other mumh5 users, about 12 MB a minute from each person who has the file on a server with default limits. Regular Mumble users see the name and the preview picture. Small pictures go inline for everyone.</p>
    <label for="s-auto">Download files by themselves up to</label>
    <select id="s-auto" value={String(s.autoDownload)} onchange={e => { s.autoDownload = Number(e.currentTarget.value); saveFiles(); }}>
      <option value="0">Never, only when clicked</option>
      <option value="5">5 MB</option>
      <option value="20">20 MB</option>
      <option value="100">100 MB</option>
      <option value="500">500 MB</option>
    </select>
    <label class="check"><input type="checkbox" bind:checked={s.sendThumbnails} onchange={saveFiles} /> Send a preview picture with pictures and videos</label>
    <div class="row kept">
      <p class="help">Files sent and received are kept on this computer, up to 2 GB, so others can get them from you later. {files.usage != null ? `In use: ${formatBytes(files.usage)}.` : ''}</p>
      <button class="btn" disabled={!files.usage} onclick={() => files.clear()}>Delete kept files</button>
    </div>

    <h3>Embeds</h3>
    <label for="s-embed">Also show media inline from these hosts</label>
    <textarea id="s-embed" bind:value={embedHosts} onchange={saveFiles} rows="3" placeholder="one host per line, e.g. i.example.com"></textarea>
    <p class="help">Links from other hosts stay plain links, so opening a chat never contacts servers you did not choose.</p>
    <label for="s-lp">Link previews</label>
    <select id="s-lp" value={previewMode()} onchange={e => { s.linkPreviews = e.currentTarget.value as typeof s.linkPreviews; saveFiles(); }}>
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
  .opt { text-transform: none; font-weight: 400; letter-spacing: 0; color: var(--text-faint); }
  .help { margin: 10px 0 0; font-size: 13px; color: var(--text-dim); }
  .row { display: flex; align-items: flex-end; gap: 8px; }
  .row.kept { align-items: center; margin-top: 10px; }
  .row.kept .help { flex: 1; margin: 0; }
  .check { display: flex; align-items: center; gap: 8px; text-transform: none; font-weight: 400; letter-spacing: 0; font-size: 14px; color: var(--text); margin-top: 14px; }
  .check input { width: auto; }
  select:disabled, input:disabled { opacity: 0.5; }
  textarea { resize: vertical; }
</style>
