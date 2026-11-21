<script lang="ts">
  import AdminBadge from './AdminBadge.svelte';
  import RoleIcon from './RoleIcon.svelte';
  import { session } from '../lib/session.svelte.ts';
  import { store } from '../lib/settings.svelte.ts';
  import { roleTint } from '../core/roles.ts';

  let { user, size = 14 }: { user: { userId: number | null }; size?: number } = $props();

  const mode = $derived(store.settings.roleIcons ?? 'all');
  const roles = $derived(session.rolesFor(user));
  // Admins without a role entry, and SuperUser, keep the plain crown
  const crown = $derived(mode !== 'off' && session.isAdmin(user) && !roles.some(r => r.g === 'admin'));
  const shown = $derived(mode === 'off' ? [] : roles.filter(r => r.s).slice(0, mode === 'top' ? (crown ? 0 : 1) : 4));
  const label = (g: string, name: string) => (g === 'admin' && name === 'Admin' ? 'Server admin' : name);
</script>

{#if crown}<AdminBadge {size} />{/if}
{#each shown as r (r.g)}
  <span class="role-badge" role="img" aria-label={label(r.g, r.n)} title={label(r.g, r.n)} style:color={roleTint(r.c)}><RoleIcon role={r} {size} /></span>
{/each}

<style>
  .role-badge { flex: none; display: inline-flex; vertical-align: -2px; color: var(--text-dim); }
</style>
