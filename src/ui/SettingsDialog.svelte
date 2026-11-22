<script lang="ts">
  import { historyHours } from '../core/chat-retention.ts';
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
  import { updates, build } from '../lib/updates.svelte.ts';

  type Tab = 'voice' | 'sharing' | 'sounds' | 'appearance' | 'accessibility' | 'files' | 'identities' | 'about';
  let { onclose, tab: initialTab = 'voice' }: { onclose: () => void; tab?: Tab } = $props();

  // svelte-ignore state_referenced_locally
  let tab = $state<Tab>(initialTab);
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
  // Each section opens at its top, not at the scroll position of the previous one
  let body = $state<HTMLDivElement>();
  function open(id: Tab) {
    tab = id;
    body?.scrollTo(0, 0);
  }
  // How much the kept files take, once the tab is open
  $effect(() => { if (tab === 'files') files.measure(); });

  const tabs: { id: Tab; label: string }[] = [
    { id: 'voice', label: 'Voice' },
    { id: 'sharing', label: 'Screen sharing' },
    { id: 'sounds', label: 'Sounds' },
    { id: 'appearance', label: 'Appearance' },
    { id: 'accessibility', label: 'Accessibility' },
    { id: 'files', label: 'Chat and files' },
    ...(native ? [{ id: 'identities' as Tab, label: 'Identities' }] : []),
    { id: 'about', label: 'About' }
  ];
  const checkedAt = $derived(updates.lastCheck ? new Date(updates.lastCheck).toLocaleString() : '');
</script>

<Modal title="Settings" onclose={() => { saveFiles(); onclose(); }} width={880} height={760} bind:body>
  <div class="layout">
  <div class="tabs" role="tablist">
    {#each tabs as t (t.id)}
      <button role="tab" aria-selected={tab === t.id} class:active={tab === t.id} onclick={() => open(t.id)}>{t.label}</button>
    {/each}
  </div>

  <div class="pane" role="tabpanel">
  {#if tab === 'voice'}
    <VoiceSettings />
  {:else if tab === 'sharing'}
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
    <h3>Chat history</h3>
    <label class="check"><input type="checkbox" bind:checked={s.saveChatHistory} onchange={() => store.saveSettings()} /> Save chat history on this device</label>
    <p class="help">Off by default. Saved messages stay on this device and are never stored on the server. Turning this off deletes saved history and keeps the current chat visible.</p>
    <label for="s-history-hours">Delete messages older than (hours)</label>
    <input id="s-history-hours" type="number" min="1" max="8760" step="1" disabled={!s.saveChatHistory} bind:value={s.chatHistoryHours}
      onchange={() => { s.chatHistoryHours = historyHours(s.chatHistoryHours); store.saveSettings(); }} />
    <p class="help">Default: 24 hours. Closing a private conversation hides it; Delete history removes its saved messages.</p>
    <h3>Files</h3>
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
    <label for="s-media">Links to pictures, videos and sounds</label>
    <select id="s-media" bind:value={s.mediaLinks} onchange={saveFiles}>
      <option value="click">Player card, loads from the linked site when clicked</option>
      <option value="off">Plain links</option>
    </select>
    <label for="s-embed">Load media at once from these hosts</label>
    <textarea id="s-embed" bind:value={embedHosts} onchange={saveFiles} rows="3" placeholder="one host per line, e.g. i.example.com"></textarea>
    <p class="help">Media from other hosts waits for a click, so opening a chat never contacts servers you did not choose.</p>
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
  {:else if tab === 'about'}
    <p class="about">mumh5 {build.version}{#if build.commit}, build <code>{build.commit.slice(0, 7)}</code>{/if}</p>
    {#if updates.possible}
      <label class="check"><input type="checkbox" bind:checked={s.updateCheck} onchange={() => store.saveSettings()} /> Check for updates</label>
      <p class="help">{updates.web
        ? 'Asks this site now and then whether it serves a newer version than the one open here. Nothing else is contacted.'
        : 'Asks GitHub every few hours whether a newer build is out. GitHub sees your IP address. Nothing is downloaded by itself.'}</p>
      <div class="row kept">
        <p class="help" role="status">
          {#if updates.checking}Checking...
          {:else if updates.error}Could not check: {updates.error}
          {:else if updates.info?.newer && updates.web}This site has a newer version. <button class="link" onclick={() => updates.reload()}>Reload</button>
          {:else if updates.info?.newer}A newer build is available ({updates.info.changes} {updates.info.changes === 1 ? 'change' : 'changes'}). <a href={updates.info.url} target="_blank" rel="noreferrer">Download</a>
          {:else if updates.info}Up to date{checkedAt ? ` (checked ${checkedAt})` : ''}.
          {:else}Not checked yet.{/if}
        </p>
        <button class="btn" disabled={updates.checking} onclick={() => updates.check()}>Check now</button>
      </div>
    {:else}
      <p class="help">{isWeb ? 'This site is updated by whoever runs it.' : 'This build does not know its commit, so it cannot check for updates.'}</p>
    {/if}
  {:else}
    <p class="help">Servers recognize you by your certificate. The default is used unless a server is set to another one.{isWeb ? ' Certificates are kept in this browser and passed to the proxy when you connect.' : ''}</p>
    <IdentityList />
  {/if}
  </div>
  </div>

  {#snippet footer()}
    <button class="btn primary" onclick={() => { saveFiles(); onclose(); }}>Done</button>
  {/snippet}
</Modal>

<style>
  /* Sections listed on the left, the open one beside them; a row of tabs on narrow windows */
  /* The dialog has a fixed height (Modal height), so it does not jump between sections */
  .layout { display: grid; grid-template-columns: 168px minmax(0, 1fr); gap: 28px; align-items: start; }
  .tabs { position: sticky; top: 0; display: flex; flex-direction: column; gap: 2px; padding-top: 6px; }
  .tabs button { padding: 7px 10px; text-align: left; color: var(--text-dim); font-weight: 500; white-space: nowrap; transition: background 120ms var(--ease), color 120ms var(--ease); }
  .tabs button:hover { background: var(--bg-hover); color: var(--text); }
  .tabs button.active { background: var(--bg-active); color: var(--text); font-weight: 600; box-shadow: inset 2px 0 0 var(--accent); }
  .pane { min-width: 0; }
  @media (max-width: 760px) {
    .layout { grid-template-columns: minmax(0, 1fr); gap: 0; }
    .tabs { position: static; flex-direction: row; overflow-x: auto; margin: 8px 0 4px; padding-top: 0; border-bottom: 1px solid var(--line); }
    .tabs button { padding: 8px 12px; }
    .tabs button:hover { background: none; }
    .tabs button.active { background: none; box-shadow: inset 0 -2px 0 var(--accent); }
  }
  h3 { margin: 24px 0 0; font-size: 15px; font-weight: 650; }
  .stun-custom { margin-top: 6px; }
  .opt { text-transform: none; font-weight: 400; letter-spacing: 0; color: var(--text-faint); }
  .help { margin: 10px 0 0; font-size: 13px; color: var(--text-dim); }
  .row { display: flex; align-items: flex-end; gap: 8px; }
  .row.kept { align-items: center; margin-top: 10px; }
  .row.kept .help { flex: 1; margin: 0; }
  .check { display: flex; align-items: center; gap: 8px; text-transform: none; font-weight: 400; letter-spacing: 0; font-size: 14px; color: var(--text); margin-top: 14px; }
  select:disabled, input:disabled { opacity: 0.5; }
  textarea { resize: vertical; }
  .about { margin: 6px 0 0; font-size: 14px; }
  .link { color: var(--link); font-size: inherit; }
</style>
