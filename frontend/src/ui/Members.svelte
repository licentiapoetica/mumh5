<script lang="ts">
  import UserSelectMark from './UserSelectMark.svelte';
  import Avatar from './Avatar.svelte';
  import Icon from './Icon.svelte';
  import RoleBadges from './RoleBadges.svelte';
  import { session } from '../lib/session.svelte.ts';
  import { menu } from '../lib/menu.svelte.ts';
  import { userMenu, openProfile } from '../lib/actions.ts';
  import { voice } from '../lib/audio/voice.svelte.ts';
  import { store } from '../lib/settings.svelte.ts';
  import { selectUser, SELECT_HINT } from '../lib/user-selection.svelte.ts';
  import UserSelection from './UserSelection.svelte';

  let { onnavigate }: { onnavigate: () => void } = $props();

  const here = $derived(session.self ? session.usersIn(session.self.channelId) : []);
  const elsewhere = $derived(session.allUsers().filter(u => u.channelId !== session.self?.channelId));
</script>

<aside class="members" aria-label="Members" data-user-list="members">
  {#snippet group(title: string, users: typeof here)}
    {#if users.length}
      <h3>{title} ({users.length})</h3>
      <ul>
        {#each users as u (u.session)}
          {@const isSelf = u.session === session.self?.session}
          <li>
            <button data-menu-row use:selectUser={{ id: u.session }} draggable="true" aria-pressed={session.selectedUsers.includes(u.session)}
              onclick={e => openProfile(u.session, e.currentTarget)} title={isSelf ? `You. ${SELECT_HINT}` : `${store.displayName(u)}. Double-click to message, ${SELECT_HINT.toLowerCase()}`}
              ondblclick={() => { if (!isSelf) { session.selectView(`dm:${u.session}`); onnavigate(); } }}
              oncontextmenu={e => menu.show(e, userMenu(u))}>
              <UserSelectMark id={u.session} />
              <Avatar name={store.displayName(u)} size={32} speaking={voice.talking[u.session] || (isSelf && voice.transmitting)} src={session.avatar(u.session)} keep />
              <span class="who">
                <span class="name" style:color={session.roleColor(u)}>{store.displayName(u)}</span>
                <span class="sub">{session.roleLabel(u)}{title !== 'In channel' ? ` in ${session.channel(u.channelId)?.name || 'Root'}` : ''}</span>
              </span>
              <RoleBadges user={u} />
              {#if u.selfDeaf || u.deaf}<Icon name="headphones-off" size={14} />{:else if u.selfMute || u.mute}<Icon name="mic-off" size={14} />{/if}
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  {/snippet}
  {@render group('In channel', here)}
  {@render group('Elsewhere', elsewhere)}
  <UserSelection list="members" />
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
