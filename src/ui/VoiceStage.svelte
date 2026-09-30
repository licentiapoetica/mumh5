<script lang="ts">
  import Icon from './Icon.svelte';
  import Avatar from './Avatar.svelte';
  import { session } from '../lib/session.svelte.ts';
  import { store } from '../lib/settings.svelte.ts';
  import { menu } from '../lib/menu.svelte.ts';
  import { ui } from '../lib/ui.svelte.ts';
  import { userMenu } from '../lib/actions.ts';
  import { voice } from '../lib/audio/voice.svelte.ts';

  // People in your voice channel as tiles, for windows too narrow for the member list
  const self = $derived(session.self);
  const channel = $derived(self ? session.channel(self.channelId) : undefined);
  const people = $derived(self ? session.usersIn(self.channelId) : []);

  let collapsed = $state(load());
  function load(): boolean {
    try { return localStorage.getItem('mumh5.stageCollapsed') === '1'; } catch { return false; }
  }
  function toggle() {
    collapsed = !collapsed;
    try { localStorage.setItem('mumh5.stageCollapsed', collapsed ? '1' : '0'); } catch { /* storage unavailable */ }
  }

  const talking = (s: number) => !!voice.talking[s] || (s === self?.session && voice.transmitting);
</script>

{#if self}
  <section class="stage" aria-label="Voice channel">
    <header>
      <button class="title" onclick={toggle} aria-expanded={!collapsed}>
        <svg class="caret" class:collapsed width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3l3 4 3-4" fill="none" stroke="currentColor" stroke-width="1.6" /></svg>
        <span class="name">{channel?.name || 'Root'}</span>
        <span class="count">{people.length}</span>
        {#if collapsed}
          <span class="mini" aria-hidden="true">
            {#each people.slice(0, 8) as u (u.session)}<Avatar name={u.name} size={18} speaking={talking(u.session)} />{/each}
          </span>
        {/if}
      </button>
      <button class="icon-btn" class:on={self.selfMute} aria-label={self.selfMute ? 'Unmute' : 'Mute'} title={self.selfMute ? 'Unmute' : 'Mute'}
        onclick={() => session.setSelfMute(!self.selfMute)}>
        <Icon name={self.selfMute ? 'mic-off' : 'mic'} size={18} />
      </button>
      <button class="icon-btn" class:on={self.selfDeaf} aria-label={self.selfDeaf ? 'Undeafen' : 'Deafen'} title={self.selfDeaf ? 'Undeafen' : 'Deafen'}
        onclick={() => session.setSelfDeaf(!self.selfDeaf)}>
        <Icon name={self.selfDeaf ? 'headphones-off' : 'headphones'} size={18} />
      </button>
    </header>
    {#if !collapsed}
      <ul class="tiles">
        {#each people as u (u.session)}
          <li>
            <button class="tile" class:talking={talking(u.session)} class:self={u.session === self.session}
              onclick={() => { session.showUser(u.session); ui.panelOpen = true; }}
              oncontextmenu={e => menu.show(e, userMenu(u))} title={store.displayName(u)}>
              <Avatar name={u.name} size={44} speaking={talking(u.session)} />
              <span class="who">{store.displayName(u)}</span>
              {#if u.deaf || u.selfDeaf}
                <span class="badge" class:admin={u.deaf}><Icon name="headphones-off" size={13} /></span>
              {:else if u.mute || u.selfMute || u.suppress}
                <span class="badge" class:admin={u.mute || u.suppress}><Icon name="mic-off" size={13} /></span>
              {/if}
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
{/if}

<style>
  .stage { flex: none; border-bottom: 1px solid var(--line); background: var(--bg-1); }
  header { display: flex; align-items: center; gap: 2px; padding: 4px 8px 4px 4px; }
  .title { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; padding: 6px 8px; text-align: left; }
  .title:hover { background: var(--bg-hover); }
  .caret { flex: none; color: var(--text-faint); }
  .caret.collapsed { transform: rotate(-90deg); }
  .name { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .count { font-size: 12px; color: var(--text-faint); }
  .mini { display: flex; gap: 3px; min-width: 0; overflow: hidden; margin-left: 4px; }
  .tiles { list-style: none; margin: 0; padding: 0 10px 10px; display: grid; grid-template-columns: repeat(auto-fill, minmax(84px, 1fr)); gap: 6px;
    max-height: 40vh; overflow-y: auto; }
  .tile { position: relative; width: 100%; display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 10px 4px 8px;
    background: var(--bg-2); border: 1px solid var(--line); transition: border-color 80ms, box-shadow 80ms; }
  .tile:hover { background: var(--bg-hover); }
  .tile.talking { border-color: var(--speaking); box-shadow: inset 0 0 0 1px var(--speaking); }
  .who { max-width: 100%; font-size: 12px; color: var(--text-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tile.self .who { color: var(--text); font-weight: 600; }
  .badge { position: absolute; top: 4px; right: 4px; display: inline-flex; color: var(--text-faint); }
  .badge.admin { color: var(--danger); }
</style>
