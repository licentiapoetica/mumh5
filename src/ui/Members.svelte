<script lang="ts">
  import Avatar from './Avatar.svelte';
  import Icon from './Icon.svelte';
  import { session } from '../lib/session.svelte.ts';
  import { menu } from '../lib/menu.svelte.ts';
  import { userMenu, openProfile } from '../lib/actions.ts';
  import { voice } from '../lib/audio/voice.svelte.ts';
  import { store } from '../lib/settings.svelte.ts';

  let { onnavigate }: { onnavigate: () => void } = $props();

  const here = $derived(session.self ? session.usersIn(session.self.channelId) : []);
  const elsewhere = $derived(session.allUsers().filter(u => u.channelId !== session.self?.channelId));
</script>

<aside class="members" aria-label="Members">
  {#snippet group(title: string, users: typeof here)}
    {#if users.length}
      <h3>{title} ({users.length})</h3>
      <ul>
        {#each users as u (u.session)}
          {@const isSelf = u.session === session.self?.session}
          <li>
            <button onclick={e => openProfile(u.session, e.currentTarget)} title={isSelf ? 'You' : `${u.name} (double-click to message)`}
              ondblclick={() => { if (!isSelf) { session.selectView(`dm:${u.session}`); onnavigate(); } }}
              oncontextmenu={e => menu.show(e, userMenu(u))}>
              <Avatar name={u.name} size={32} speaking={voice.talking[u.session] || (isSelf && voice.transmitting)} src={session.avatar(u.session)} />
              <span class="who">
                <span class="name">{store.displayName(u)}</span>
                <span class="sub">{u.userId != null ? 'Registered' : 'Guest'}{title !== 'In channel' ? ` in ${session.channel(u.channelId)?.name || 'Root'}` : ''}</span>
              </span>
              {#if u.selfDeaf || u.deaf}<Icon name="headphones-off" size={14} />{:else if u.selfMute || u.mute}<Icon name="mic-off" size={14} />{/if}
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  {/snippet}
  {@render group('In channel', here)}
  {@render group('Elsewhere', elsewhere)}
</aside>

<style>
  .members { flex: 1; min-height: 0; overflow-y: auto; padding: 4px 8px 8px; }
  h3 { font-size: 11px; font-weight: 650; text-transform: uppercase; letter-spacing: 0.07em; color: var(--text-faint); margin: 14px 8px 6px; }
  ul { list-style: none; margin: 0; padding: 0; }
  button { display: flex; align-items: center; gap: 10px; width: 100%; padding: 5px 8px; text-align: left; color: var(--text-dim); transition: background 100ms var(--ease), color 100ms var(--ease); }
  button:hover { background: var(--bg-hover); color: var(--text); }
  .who { flex: 1; min-width: 0; display: flex; flex-direction: column; line-height: 1.2; }
  .name { color: var(--text); font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sub { font-size: 12px; color: var(--text-faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
