<script lang="ts">
  import Icon from '../ui/Icon.svelte';
  import Avatar from '../ui/Avatar.svelte';
  import { session } from '../lib/session.svelte.ts';
  import { store } from '../lib/settings.svelte.ts';
  import { menu } from '../lib/menu.svelte.ts';
  import { ui } from '../lib/ui.svelte.ts';
  import { userMenu, openProfile } from '../lib/actions.ts';
  import { voice } from '../lib/audio/voice.svelte.ts';

  // Everyone on the server, by room; yours first
  let { onchat }: { onchat: () => void } = $props();

  let query = $state('');
  const q = $derived(query.trim().toLowerCase());
  const self = $derived(session.self);
  const groups = $derived.by(() => {
    const byRoom = new Map<number, ReturnType<typeof session.allUsers>>();
    for (const u of session.allUsers()) {
      if (q && !store.displayName(u).toLowerCase().includes(q) && !u.name.toLowerCase().includes(q)) continue;
      if (!byRoom.has(u.channelId)) byRoom.set(u.channelId, []);
      byRoom.get(u.channelId)!.push(u);
    }
    return [...byRoom].map(([id, users]) => ({ id, name: session.channel(id)?.name || 'Root', users }))
      .sort((a, b) => Number(b.id === self?.channelId) - Number(a.id === self?.channelId) || a.name.localeCompare(b.name));
  });
  const total = $derived(session.allUsers().length);
  const talking = (s: number) => !!voice.talking[s] || (s === self?.session && voice.transmitting);
</script>

<section class="people" aria-label="People">
  <header>
    <h1>People</h1>
    <span>{session.status === 'connected' ? `${total} online` : 'Not connected'}</span>
  </header>
  {#if session.status === 'connected'}
    <label class="find">
      <Icon name="search" size={16} />
      <input type="search" placeholder="Find a person" aria-label="Find a person" bind:value={query} />
    </label>
    <div class="scroll">
      {#each groups as g (g.id)}
        <h2>{g.name}{#if g.id === self?.channelId} <em>your room</em>{/if} <span>{g.users.length}</span></h2>
        <ul>
          {#each g.users as u (u.session)}
            {@const me = u.session === self?.session}
            <li class="entry" role="presentation" oncontextmenu={e => menu.show(e, userMenu(u))}>
              <button class="main" onclick={e => openProfile(u.session, e.currentTarget)}>
                <Avatar name={u.name} size={40} speaking={talking(u.session)} src={session.avatar(u.session)} />
                <span class="text">
                  <span class="name" class:talking={talking(u.session)}>{store.displayName(u)}</span>
                  <span class="sub">{me ? 'You' : u.userId != null ? 'Registered' : 'Guest'}{u.deaf || u.selfDeaf ? ', deafened' : u.mute || u.selfMute || u.suppress ? ', muted' : ''}{session.sharing[u.session] ? `, sharing ${session.sharing[u.session]}` : ''}{u.recording ? ', recording' : ''}</span>
                </span>
              </button>
              {#if !me}
                <button class="icon-btn" aria-label="Message {store.displayName(u)}" title="Send a message" onclick={() => { session.selectView(`dm:${u.session}`); onchat(); }}><Icon name="message" size={18} /></button>
              {/if}
              <button class="icon-btn" aria-label="More for {store.displayName(u)}" onclick={e => menu.show(e, userMenu(u))}><Icon name="more" size={18} /></button>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="none">Nobody matches "{query}".</p>
      {/each}
    </div>
  {/if}
</section>

<style>
  .people { height: 100%; min-height: 0; display: flex; flex-direction: column; background: var(--bg-1); }
  header { flex: none; padding: 14px 16px 8px; }
  h1 { margin: 0; font-size: 24px; line-height: 1.2; letter-spacing: -0.01em; }
  header span { font-size: 13px; color: var(--text-dim); }
  .find { flex: none; display: flex; align-items: center; gap: 8px; margin: 4px 16px 8px; padding: 0 12px; height: 44px; background: var(--bg-0); border: 1px solid var(--line-strong); color: var(--text-faint); text-transform: none; letter-spacing: 0; font-weight: 400; }
  .find:focus-within { border-color: var(--accent); }
  .find input { border: 0; background: none; padding: 0; height: 100%; font-size: 15px; box-shadow: none; }
  .scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 0 8px 16px; }
  ul { list-style: none; margin: 0; padding: 0; }
  h2 { margin: 18px 8px 6px; font-size: 11px; font-weight: 650; text-transform: uppercase; letter-spacing: 0.07em; color: var(--text-faint); }
  h2 em { font-style: normal; color: var(--speaking); margin-left: 6px; }
  h2 span { margin-left: 6px; font-weight: 400; }
  .entry { display: flex; align-items: center; gap: 4px; min-height: 56px; padding-right: 4px; }
  .entry:hover { background: var(--bg-hover); }
  .main { flex: 1; min-width: 0; align-self: stretch; display: flex; align-items: center; gap: 12px; padding: 8px; text-align: left; }
  .text { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .name { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .name.talking { color: var(--speaking); }
  .sub { font-size: 13px; color: var(--text-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .icon-btn { flex: none; width: 40px; height: 40px; }
  .none { padding: 12px 8px; color: var(--text-dim); }
</style>
