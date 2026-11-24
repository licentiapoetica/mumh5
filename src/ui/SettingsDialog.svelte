<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { historyHours } from '../core/chat-retention.ts';
  import Icon from './Icon.svelte';
  import Modal from './Modal.svelte';
  import VoiceSettings from './VoiceSettings.svelte';
  import VideoSettings from './VideoSettings.svelte';
  import IdentityList from './IdentityList.svelte';
  import AppearanceSettings from './AppearanceSettings.svelte';
  import SoundSettings from './SoundSettings.svelte';
  import ResetButton from './ResetButton.svelte';
  import { voice } from '../lib/audio/voice.svelte.ts';
  import { sounds } from '../lib/audio/sounds.svelte.ts';
  import { store } from '../lib/settings.svelte.ts';
  import { native, desktop, isWeb, mumpeerSupported } from '../lib/native.ts';
  import { previewMode } from '../lib/preview.ts';
  import { files } from '../lib/files.svelte.ts';
  import { formatBytes } from '../lib/html.ts';
  import { updates, build } from '../lib/updates.svelte.ts';
  import { credits } from '../lib/credits.ts';
  import { connLog } from '../lib/conn-log.svelte.ts';
  import { formatTime } from '../core/conn-log.ts';
  const repoUrl = `https://github.com/${build.repo}`;
  import { share } from '../lib/share.svelte.ts';
  import { sessions } from '../lib/session.svelte.ts';

  type Tab = 'voice' | 'video' | 'sharing' | 'sounds' | 'appearance' | 'accessibility' | 'files' | 'identities' | 'about';
  // onpopout: moves Settings to a window of its own; false if it could not be opened
  // windowed: this is that window. jump: a section asked for while it is open
  let { onclose, tab: initialTab = 'voice', onpopout, windowed = false, jump = null }:
    { onclose: () => void; tab?: Tab; onpopout?: (tab: Tab) => boolean; windowed?: boolean; jump?: { tab: Tab } | null } = $props();

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
  $effect(() => { const j = jump; if (j) untrack(() => open(j.tab)); });

  // Most settings apply as they change; a field being typed in applies when it loses focus
  function commit() {
    (body?.ownerDocument.activeElement as HTMLElement | null)?.blur?.();
    saveFiles();
  }
  let note = $state('');
  let noteTimer: ReturnType<typeof setTimeout> | undefined;
  function saveNow() {
    commit();
    note = 'Saved';
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => (note = ''), 2000);
  }
  function popOut() {
    commit();
    if (onpopout?.(tab)) onclose();
    else note = 'The new window was blocked. Allow pop-ups for this page.';
  }
  onDestroy(() => {
    clearTimeout(noteTimer);
    // Closed by the system's button, with no Done to save what was typed
    if (windowed) saveFiles();
  });
  // How much the kept files take, once the tab is open
  $effect(() => { if (tab === 'files') files.measure(); });

  const tabs: { id: Tab; label: string }[] = [
    { id: 'voice', label: 'Voice' },
    { id: 'video', label: 'Video' },
    { id: 'sharing', label: 'Screen sharing' },
    { id: 'sounds', label: 'Sounds' },
    { id: 'appearance', label: 'Appearance' },
    { id: 'accessibility', label: 'Accessibility' },
    { id: 'files', label: 'Chat and files' },
    ...(native ? [{ id: 'identities' as Tab, label: 'Identities' }] : []),
    { id: 'about', label: 'About' }
  ];
  // The reset at the bottom of each tab; Identities has none
  const reset = $derived.by((): { what: string; changed: boolean; note?: string; run: () => void } | null => {
    switch (tab) {
      case 'voice': return {
        what: 'voice settings', changed: !voice.isDefault(), run: () => voice.reset(),
        note: 'Back to the defaults, devices included. Volumes and mutes you set for people are kept.'
      };
      case 'video': return {
        what: 'video settings', changed: !store.isDefault('video'),
        run: () => { store.resetSettings('video'); share.setCams(sessions.active, s.autoCameras); }
      };
      case 'sharing': return {
        what: 'screen sharing settings', changed: !store.isDefault('sharing'),
        run: () => { store.resetSettings('sharing'); stunCustom = false; }
      };
      case 'sounds': return {
        what: 'sound settings', changed: !store.isDefault('sounds') || !sounds.choicesAtDefaults(),
        run: () => { store.resetSettings('sounds'); sounds.resetChoices(); },
        note: 'Turns sounds and poke notifications back on, sets the volume back and plays only the quiet defaults. Packs and your own files are kept; Reset all to built-in removes those.'
      };
      case 'appearance': return {
        what: 'appearance', changed: !store.isDefault('appearance'), run: () => store.resetSettings('appearance'),
        note: 'Back to the defaults. Background images stay on this device.'
      };
      case 'accessibility': return { what: 'accessibility settings', changed: !store.isDefault('accessibility'), run: () => store.resetSettings('accessibility') };
      case 'files': return {
        what: 'chat and file settings', changed: !store.isDefault('files'),
        run: () => { store.resetSettings('files'); embedHosts = s.embedHosts.join('\n'); },
        note: s.saveChatHistory
          ? 'Saving chat history goes off, which deletes the saved history. Kept files stay.'
          : 'Back to the defaults. Kept files stay.'
      };
      case 'about': return updates.possible ? { what: 'update check', changed: !store.isDefault('about'), run: () => store.resetSettings('about') } : null;
      default: return null;
    }
  });
  let logCopied = $state(false);
  function copyLog(button: HTMLElement): void {
    const view = button.ownerDocument.defaultView ?? window;
    const header = [`mumh5 ${build.version}${build.commit ? ` ${build.commit.slice(0, 7)}` : ''}`, view.navigator.userAgent, ''];
    view.navigator.clipboard.writeText(connLog.text(header)).then(() => {
      logCopied = true;
      view.setTimeout(() => { logCopied = false; }, 1500);
    }, () => {});
  }
  const checkedAt = $derived(updates.lastCheck ? new Date(updates.lastCheck).toLocaleString() : '');

  // Narrow layout: the tab row has no scrollbar; the wheel and dragging move it sideways
  function dragScroll(node: HTMLElement) {
    let startX = 0, startLeft = 0, down = false, moved = false;
    const view = node.ownerDocument.defaultView ?? window;
    const wheel = (e: WheelEvent) => {
      if (node.scrollWidth <= node.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      node.scrollLeft += e.deltaY;
    };
    const press = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      down = true; moved = false; startX = e.clientX; startLeft = node.scrollLeft;
    };
    const move = (e: PointerEvent) => {
      if (!down) return;
      const dx = e.clientX - startX;
      if (!moved && Math.abs(dx) < 5) return;
      moved = true;
      node.scrollLeft = startLeft - dx;
    };
    const release = () => { down = false; };
    // A drag must not count as a click on the tab under the pointer
    const click = (e: MouseEvent) => { if (moved) { e.preventDefault(); e.stopPropagation(); moved = false; } };
    node.addEventListener('wheel', wheel, { passive: false });
    node.addEventListener('pointerdown', press);
    view.addEventListener('pointermove', move as EventListener);
    view.addEventListener('pointerup', release);
    node.addEventListener('click', click, true);
    return { destroy() {
      node.removeEventListener('wheel', wheel);
      node.removeEventListener('pointerdown', press);
      view.removeEventListener('pointermove', move as EventListener);
      view.removeEventListener('pointerup', release);
      node.removeEventListener('click', click, true);
    } };
  }
</script>

<Modal title="Settings" onclose={() => { saveFiles(); onclose(); }} width={880} height={760} {windowed} bind:body>
  {#snippet actions()}
    {#if onpopout}
      <button class="icon-btn pop-settings" title="Open in a new window" aria-label="Open in a new window" onclick={popOut}><Icon name="popout" /></button>
    {/if}
  {/snippet}
  <div class="layout">
  <div class="tabs" role="tablist" use:dragScroll>
    {#each tabs as t (t.id)}
      <button role="tab" aria-selected={tab === t.id} class:active={tab === t.id} onclick={() => open(t.id)}>{t.label}</button>
    {/each}
  </div>

  <div class="pane" role="tabpanel">
  {#if tab === 'voice'}
    <VoiceSettings />
  {:else if tab === 'video'}
    <VideoSettings />
  {:else if tab === 'sharing'}
    {#if mumpeerSupported()}
      <label for="s-share-route">Screen sharing connection</label>
      <select id="s-share-route" bind:value={s.screenShareRoute} onchange={() => store.saveSettings()}>
        <option value="automatic">Automatic (prefer mumpeer on the Mumble host)</option>
        <option value="standard">Configured STUN and TURN only</option>
        <option value="fallback">Direct first, with mumpeer fallback</option>
        <option value="relay-only">Mumpeer only (hide my IP from the other person)</option>
        <option value="direct-only">Direct only</option>
        <option value="off">Off</option>
      </select>
      <p class="help">When both clients use Automatic, the app prefers a relay announced on the Mumble server’s own host. If the relay fails, the app tries the usual connection. {isWeb ? 'The site you are on keeps the link to the relay for you, so the relay sees that site’s address, not yours, and the site sees the traffic between you and the relay. ' : 'The relay operator can see your IP address. '}Changing this setting ends active screen shares.</p>
    {/if}
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
    <p class="help">A direct connection shares your IP address with the other participant. STUN helps both sides find a direct route across the internet. The STUN server learns your IP address. {isWeb ? 'By default the site you are on provides it.' : 'Without STUN, direct connections generally work best on the same network.'} Networks that block direct connections, like many mobile ones, need more than STUN.</p>
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
    <p class="help">A Mumble client for desktop and browser, MIT licensed. Built by Kibi, with code, tests and documentation written using Claude in Claude Code.</p>
    <p class="links">
      <a href={repoUrl} target="_blank" rel="noopener noreferrer">Repository</a>
      <a href="{repoUrl}/graphs/contributors" target="_blank" rel="noopener noreferrer">Contributors</a>
      <a href="{repoUrl}/issues" target="_blank" rel="noopener noreferrer">Report a problem</a>
      <a href="{repoUrl}/blob/main/THIRD_PARTY_NOTICES.md" target="_blank" rel="noopener noreferrer">License notices</a>
    </p>
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
    <h3>Connection log</h3>
    <p class="help">Why connections ended and what the page and network did around it, kept in this browser only. Copy it when reporting a dropped connection.</p>
    <div class="row kept">
      <button class="btn" disabled={!connLog.entries.length} onclick={e => copyLog(e.currentTarget)}>{logCopied ? 'Copied' : 'Copy'}</button>
      <button class="btn" disabled={!connLog.entries.length} onclick={() => connLog.clear()}>Clear</button>
    </div>
    <ol class="log" aria-label="Connection log">
      {#each [...connLog.entries].reverse() as e (e.at + e.text)}
        <li><time>{formatTime(e.at)}</time> {e.text}</li>
      {:else}
        <li class="none">Nothing yet.</li>
      {/each}
    </ol>
    <h3>Credits</h3>
    <p class="help">mumh5 is not affiliated with the Mumble project. Mumble is a trademark of its respective owners. Licenses are listed in full in the license notices.</p>
    <ul class="credits">
      {#each credits as c (c.name)}
        <li><a href={c.url} target="_blank" rel="noopener noreferrer">{c.name}</a> <span class="lic">{c.license}</span><br /><span class="what">{c.what}</span></li>
      {/each}
    </ul>
  {:else}
    <p class="help">Servers recognize you by your certificate. The default is used unless a server is set to another one.{isWeb ? ' Certificates are kept in this browser and passed to the proxy when you connect.' : ''}</p>
    <IdentityList />
  {/if}
  {#if reset}
    <div class="reset"><ResetButton what={reset.what} changed={reset.changed} note={reset.note} onreset={reset.run} /></div>
  {/if}
  </div>
  </div>

  {#snippet footer()}
    <span class="foot-note" role="status">{note}</span>
    <button class="btn" onclick={saveNow}>Save</button>
    <button class="btn primary" onclick={() => { commit(); onclose(); }}>Done</button>
  {/snippet}
</Modal>

<style>
  .foot-note { align-self: center; margin-right: 4px; font-size: 13px; color: var(--text-dim); }
  /* Touch devices open a new window as a tab, which hides the app instead of showing it */
  @media (hover: none) { .pop-settings { display: none; } }
  /* Sections listed on the left, the open one beside them; a row of tabs on narrow windows */
  /* The dialog has a fixed height (Modal height), so it does not jump between sections */
  .layout { display: grid; grid-template-columns: 168px minmax(0, 1fr); gap: 28px; align-items: start; }
  .tabs { position: sticky; top: 0; display: flex; flex-direction: column; gap: 2px; padding-top: 6px; }
  .tabs button { padding: 7px 10px; text-align: left; color: var(--text-dim); font-weight: 500; white-space: nowrap; transition: background 120ms var(--ease), color 120ms var(--ease); }
  .tabs button:hover { background: var(--bg-hover); color: var(--text); }
  .tabs button.active { background: var(--bg-active); color: var(--text); font-weight: 600; box-shadow: inset 2px 0 0 var(--accent); }
  .pane { min-width: 0; }
  .reset { margin-top: 28px; padding-top: 16px; border-top: 1px solid var(--line); }
  @media (max-width: 760px) {
    .layout { grid-template-columns: minmax(0, 1fr); gap: 0; }
    /* Stays at the top while the section scrolls under it; the body's 8px top padding is covered */
    .tabs { position: sticky; top: -8px; z-index: 1; flex-direction: row; overflow-x: auto; scrollbar-width: none; user-select: none;
      margin: -8px -24px 12px; padding: 8px 24px 0; background: var(--bg-1); border-bottom: 1px solid var(--line); }
    .tabs::-webkit-scrollbar { display: none; }
    .tabs button { padding: 8px 12px; }
    /* Slightly dimmer than --text-dim so the active tab stands out; 90% keeps every scheme above 4.5:1 on --bg-1 */
    .tabs button:not(.active) { color: color-mix(in srgb, var(--text-dim) 90%, var(--bg-1)); }
    .tabs button:not(.active):hover { color: var(--text); }
    .tabs button:hover { background: none; }
    /* Same weight as the others: a bolder active tab is wider and shifts the row on click */
    .tabs button.active { background: none; font-weight: 500; box-shadow: inset 0 -2px 0 var(--accent); }
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
  .links { display: flex; flex-wrap: wrap; gap: 6px 16px; margin: 10px 0 0; font-size: 14px; }
  .log { list-style: none; margin: 10px 0 0; padding: 8px 10px; max-height: 240px; overflow: auto; border: 1px solid var(--line-strong); background: var(--bg-1); font: 12px/1.5 ui-monospace, monospace; display: flex; flex-direction: column; gap: 2px; }
  .log time { color: var(--text-faint); margin-right: 6px; }
  .log .none { color: var(--text-dim); }
  .credits { list-style: none; margin: 10px 0 0; padding: 0; display: flex; flex-direction: column; gap: 8px; font-size: 13px; }
  .credits .lic { margin-left: 6px; font-size: 12px; color: var(--text-faint); }
  .credits .what { color: var(--text-dim); }
  .link { color: var(--link); font-size: inherit; }
</style>
