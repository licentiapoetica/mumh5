<script lang="ts">
  import Background from './Background.svelte';
  import Icon from './Icon.svelte';
  import AppNavigation from './AppNavigation.svelte';
  import { t, tn } from '../lib/i18n.svelte.ts';
  import ServerButton from './ServerButton.svelte';
  import UserBar from './UserBar.svelte';
  import { session, sessions } from '../lib/session.svelte.ts';
  import { serverInitials as initials, store, type SavedServer } from '../lib/settings.svelte.ts';
  import { ui } from '../lib/ui.svelte.ts';
  import { desktop, isWeb } from '../lib/native.ts';
  import { serverStatus, peopleOn } from '../lib/server-status.svelte.ts';

  // The start screen while not connected: your saved servers with who is on them, ready to join.
  // top: your buttons along the top, where the stacked layout keeps them
  let { onadd, onedit, onbrowse, top = false, showNavigation = false }: { onadd: () => void; onedit: (s: SavedServer) => void; onbrowse: () => void; top?: boolean; showNavigation?: boolean } = $props();

  const stateOf = (id: string) => sessions.byServer(id)?.status ?? 'idle';

  function line(s: SavedServer): string {
    const state = stateOf(s.id);
    if (state === 'connecting') return 'Connecting...';
    if (sessions.byServer(s.id)?.reconnectDelay != null) return 'Waiting to reconnect...';
    const people = peopleOn(s.id);
    if (people) {
      const count = `${people.users}${people.maxUsers ? ` of ${people.maxUsers}` : ''} online`;
      const ms = serverStatus.counts[s.id]?.ping;
      const ping = state === 'connected' ? 'connected' : ms != null ? (ms < 1 ? 'under 1 ms' : `${ms} ms`) : '';
      return ping ? `${count}, ${ping}` : count;
    }
    if (!(s.id in serverStatus.counts)) return 'Checking...';
    return isWeb ? 'No count from this site' : 'No answer';
  }

  const d = $derived(session.disconnectInfo);
</script>

<section data-background class="home" aria-label={t('home.servers')}>
  <Background />
  {#if top}<UserBar toolbar />{/if}
  <div class="scroll">
    <header>
      {#if (!top && store.settings.railHidden) || showNavigation}<div class="navigation">
        {#if !top && store.settings.railHidden}<ServerButton />{/if}
        {#if showNavigation}<AppNavigation />{/if}
      </div>{/if}
      <div class="title">
        <h1>{t('home.servers')}</h1>
        <p>{store.servers.length ? t('home.pickOne') : t('home.addToStart')}</p>
      </div>
      <div class="acts">
        <button class="btn primary" onclick={onadd}><Icon name="plus" size={16} />{t('home.addServer')}</button>
        {#if desktop}<button class="btn" onclick={onbrowse}><Icon name="globe" size={16} />{t('home.browsePublic')}</button>{/if}
        <button class="btn" onclick={() => { ui.settingsTab = 'identities'; ui.settingsOpen = true; }}>{t('home.manageIdentities')}</button>
      </div>
    </header>

    {#if d}
      <div class="ended" class:bad={d.kind === 'kicked' || d.kind === 'banned'}>
        <h2>
          {#if d.kind === 'kicked'}{d.by ? t('home.kickedBy', { name: d.by }) : t('home.kicked')}
          {:else if d.kind === 'banned'}{d.by ? t('home.bannedBy', { name: d.by }) : t('home.banned')}
          {:else if d.kind === 'rejected'}{t('home.refused')}
          {:else}{t('home.lost')}{/if}
        </h2>
        {#if d.reason}<p class="reason">{d.reason}</p>{/if}
        <p class="where">{session.server?.label}</p>
        <div class="row"><button class="btn primary" onclick={() => session.reconnect()}>{t('home.reconnect')}</button></div>
      </div>
    {:else if session.error}
      <div class="ended bad">
        <h2>{t('home.couldNotConnect')}</h2>
        <p class="reason">{session.error}</p>
        {#if session.server}<p class="where">{session.server.label}</p>{/if}
      </div>
    {/if}

    {#if session.reconnectDelay != null}
      <p role="status">{tn('home.retrying', session.reconnectDelay)}</p>
      <button class="btn" onclick={() => session.cancelReconnect()}>{t('home.cancelReconnect')}</button>
    {/if}

    {#if store.servers.length}
      <ul class="list">
        {#each store.servers as s (s.id)}
          {@const state = stateOf(s.id)}
          {@const people = peopleOn(s.id)}
          <li class="server" class:live={state === 'connected'}>
            <button class="main" onclick={() => sessions.open(s)} title="{s.label} ({s.host})">
              <span class="pic">{#if s.icon}<img src={s.icon} alt="" draggable="false" />{:else}{initials(s.label)}{/if}</span>
              <span class="text">
                <strong>{s.label}</strong>
                <span class="host">{s.host}{s.port !== 64738 ? `:${s.port}` : ''}</span>
                <span class="state" class:on={!!people?.users}>{#if people?.users}<span class="dot"></span>{/if}{line(s)}</span>
              </span>
            </button>
            <button class="btn" class:primary={state !== 'connected'} onclick={() => sessions.open(s)}>{state === 'connected' ? t('home.open') : t('home.connect')}</button>
            <button class="icon-btn" title={t('home.editServer', { name: s.label })} aria-label={t('home.editServer', { name: s.label })} onclick={() => onedit(s)}><Icon name="settings" size={16} /></button>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="none">{t('home.noServers')}</p>
    {/if}
  </div>
  {#if !top}<UserBar inline />{/if}
</section>

<style>
  .home { flex: 1; min-width: 0; display: flex; flex-direction: column; background: var(--bg-2); }
  .scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 32px clamp(16px, 4vw, 48px) 24px; }
  .navigation { display: flex; gap: 8px; align-items: center; }
  header { display: flex; flex-direction: column; align-items: flex-start; gap: 16px; max-width: 960px; }
  h1 { margin: 0; font-size: 26px; font-weight: 700; letter-spacing: -0.02em; }
  .title p { margin: 4px 0 0; color: var(--text-dim); }
  .acts { display: flex; flex-wrap: wrap; gap: 8px; }
  .acts :global(svg) { flex: none; }

  .list { list-style: none; margin: 24px 0 0; padding: 0; max-width: 960px; display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 420px), 1fr)); gap: 10px; }
  .server { display: flex; align-items: center; gap: 8px; padding: 0 12px 0 0; background: var(--bg-1); border: 1px solid var(--line); transition: border-color 120ms var(--ease), background 120ms var(--ease); }
  .server:hover { border-color: var(--line-strong); background: color-mix(in srgb, var(--bg-1), var(--bg-hover) 50%); }
  .server.live { box-shadow: inset 3px 0 0 var(--speaking); }
  .main { flex: 1; min-width: 0; display: flex; align-items: center; gap: 14px; padding: 14px 4px 14px 14px; text-align: left; }
  .pic { width: 48px; height: 48px; flex: none; display: flex; align-items: center; justify-content: center; overflow: hidden; background: var(--bg-3); font-weight: 650; font-size: 15px; }
  .pic img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .text { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .text strong { font-size: 15px; font-weight: 650; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .host { font-size: 13px; color: var(--text-faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .state { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--text-dim); }
  .state.on { color: var(--text); }
  .dot { width: 7px; height: 7px; flex: none; background: var(--speaking); }
  .server .btn { flex: none; }
  .none { margin: 24px 0 0; color: var(--text-dim); }
  /* Phones: the buttons under the server instead of beside it */
  @media (max-width: 560px) {
    .server { flex-wrap: wrap; padding: 0 12px 12px 14px; }
    .main { flex-basis: 100%; padding-left: 0; }
    .server .btn { flex: 1; }
  }

  .ended { max-width: 520px; margin: 24px 0 0; padding: 16px 18px; background: var(--bg-1); border: 1px solid var(--line); border-left: 3px solid var(--warn); }
  .ended.bad { border-left-color: var(--danger); }
  .ended h2 { margin: 0; font-size: 18px; font-weight: 650; }
  .ended .reason { margin: 8px 0 0; overflow-wrap: anywhere; }
  .ended .where { margin: 4px 0 0; font-size: 13px; color: var(--text-faint); }
  .ended .row { margin-top: 14px; }
</style>
