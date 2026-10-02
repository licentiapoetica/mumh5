<script lang="ts">
  import Icon from '../ui/Icon.svelte';
  import Avatar from '../ui/Avatar.svelte';
  import { session, sessions } from '../lib/session.svelte.ts';
  import { store, type SavedServer } from '../lib/settings.svelte.ts';
  import { ui } from '../lib/ui.svelte.ts';
  import { changeNamePrompt } from '../lib/actions.ts';
  import { voice } from '../lib/audio/voice.svelte.ts';
  import { desktop } from '../lib/native.ts';

  // Yourself, your servers and the settings, in one place
  let { onadd, onedit, onbrowse }: { onadd: () => void; onedit: (s: SavedServer) => void; onbrowse: () => void } = $props();

  const self = $derived(session.self);
  const stateOf = (id: string) => sessions.byServer(id)?.status ?? 'idle';
  type Tab = typeof ui.settingsTab;
  const SETTINGS: { tab: Tab; name: string; note: string }[] = [
    { tab: 'voice', name: 'Voice', note: 'Microphone, speakers, how you transmit' },
    { tab: 'sounds', name: 'Sounds', note: 'Notification sounds' },
    { tab: 'appearance', name: 'Appearance', note: 'Colors and interface' },
    { tab: 'accessibility', name: 'Accessibility', note: '' },
    { tab: 'files', name: 'Chat and files', note: 'Uploads, previews, embeds' },
    { tab: 'identities', name: 'Identities', note: 'Your certificates' }
  ];
  const openSettings = (tab: Tab) => { ui.settingsTab = tab; ui.settingsOpen = true; };
  function profile(edit: boolean) {
    if (!self) return;
    session.showUser(self.session);
    if (edit) ui.editDescription = true;
    ui.panelOpen = true;
  }
</script>

<section class="you" aria-label="You">
  <div class="scroll">
    <div class="card">
      {#if self}
        <Avatar name={self.name} size={64} speaking={voice.transmitting} />
        <div class="who">
          <h1>{self.name}</h1>
          <span>{self.userId != null ? 'Registered' : 'Guest'} on {session.server?.label}, in {session.channel(self.channelId)?.name || 'Root'}</span>
        </div>
      {:else}
        <div class="who">
          <h1>You</h1>
          <span>{session.status === 'connecting' ? 'Connecting...' : 'Not connected'}</span>
        </div>
      {/if}
    </div>
    {#if self}
      <div class="acts">
        <button class="btn" onclick={() => profile(false)}>Your profile</button>
        <button class="btn" onclick={() => profile(true)}>Change your description</button>
        <button class="btn" onclick={() => changeNamePrompt(self)}>Change name</button>
        {#if self.userId == null}<button class="btn" onclick={() => session.register(self.session)}>Register on this server</button>{/if}
        <button class="btn" onclick={() => (ui.userInfo = self.session)}>Connection information</button>
      </div>
    {/if}

    <h2>Servers</h2>
    <ul>
      {#each store.servers as s (s.id)}
        {@const state = stateOf(s.id)}
        <li class="entry">
          <button class="main" onclick={() => sessions.open(s)}>
            <span class="text">
              <span class="name">{s.label}{#if state !== 'idle'}<em>{state === 'connecting' ? 'connecting' : sessions.voiceId === s.id ? 'connected, voice' : 'connected'}</em>{/if}</span>
              <span class="sub">{s.host}:{s.port} as {s.username}</span>
            </span>
          </button>
          {#if state !== 'idle'}<button class="btn small" onclick={() => sessions.close(s.id)}>Disconnect</button>{/if}
          <button class="btn small" onclick={() => onedit(s)}>Edit</button>
        </li>
      {/each}
    </ul>
    <div class="acts">
      <button class="btn" onclick={onadd}>Add a server</button>
      {#if desktop}<button class="btn" onclick={onbrowse}>Browse public servers</button>{/if}
      {#if session.status === 'connected'}<button class="btn" onclick={() => (ui.serverInfo = true)}>Server information</button>{/if}
    </div>

    <h2>Settings</h2>
    <ul>
      {#each SETTINGS as item (item.tab)}
        <li class="entry">
          <button class="main" onclick={() => openSettings(item.tab)}>
            <span class="text">
              <span class="name">{item.name}</span>
              {#if item.note}<span class="sub">{item.note}</span>{/if}
            </span>
            <Icon name="arrow-right" size={16} />
          </button>
        </li>
      {/each}
    </ul>
  </div>
</section>

<style>
  .you { height: 100%; min-height: 0; display: flex; flex-direction: column; background: var(--bg-1); }
  .scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 0 8px 24px; }
  .card { display: flex; align-items: center; gap: 16px; padding: 20px 8px 12px; }
  .who { min-width: 0; }
  h1 { margin: 0; font-size: 24px; line-height: 1.2; letter-spacing: -0.01em; overflow-wrap: anywhere; }
  .who span { font-size: 13px; color: var(--text-dim); }
  .acts { display: flex; flex-wrap: wrap; gap: 8px; padding: 4px 8px; }
  ul { list-style: none; margin: 0; padding: 0; }
  h2 { margin: 24px 8px 6px; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-faint); }
  .entry { display: flex; align-items: center; gap: 8px; min-height: 56px; padding-right: 8px; }
  .entry:hover { background: var(--bg-hover); }
  .main { flex: 1; min-width: 0; align-self: stretch; display: flex; align-items: center; gap: 12px; padding: 8px; text-align: left; color: var(--text-dim); }
  .text { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .name { font-weight: 600; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .name em { margin-left: 8px; font-style: normal; font-size: 12px; font-weight: 600; color: var(--speaking); }
  .sub { font-size: 13px; color: var(--text-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .small { flex: none; padding: 6px 12px; font-size: 13px; }
</style>
