<script lang="ts">
  import Modal from './Modal.svelte';
  import Icon from './Icon.svelte';
  import RoleIcon from './RoleIcon.svelte';
  import { session } from '../lib/session.svelte.ts';
  import { makeRoleIcon } from '../lib/images.ts';
  import { PERM, type ChannelAcl } from '../core/client.ts';
  import { PERMISSION_GROUPS, VOICE_BITS, adminsSilenced, cellValue, effectivePermissions, keepAdminVoice, setCell, type Cell } from '../core/access.ts';
  import { MAX_ROLES, MAX_ROLE_NAME, ROLE_COLORS, ROLE_ICONS, accessKeys, addKey, canHaveKeys, createRole, deleteRole, docFromRoles, isBuiltinRole, isFixedRole, newKeyCode, prepareRoles, removeKey, roleMembers, rolesFromAcl, roleTarget, roleTint, setMember, type RoleInfo } from '../core/roles.ts';

  type Tab = 'roles' | 'members' | 'keys';
  let { tab: firstTab = 'roles', userId = null, onclose }: { tab?: Tab; userId?: number | null; onclose: () => void } = $props();

  const client = session.client;
  // svelte-ignore state_referenced_locally
  let tab = $state<Tab>(firstTab);
  let section = $state<'permissions' | 'display' | 'members'>('permissions');
  let fetched = $state.raw<ChannelAcl | null>(null);
  let acl = $state.raw<ChannelAcl | null>(null);
  let roles = $state.raw<RoleInfo[]>([]);
  let selected = $state('');
  let registered = $state.raw<{ id: number; name: string }[]>([]);
  let dirty = $state(false);
  let error = $state('');
  let newName = $state('');
  let addName = $state('');
  let query = $state('');
  // svelte-ignore state_referenced_locally
  let person = $state<number | null>(userId);
  let keyRole = $state('');
  let copied = $state('');
  let picker = $state<HTMLInputElement>();

  const offs: (() => void)[] = [];
  if (client) {
    offs.push(client.on('acl', a => { if (a.channelId === 0 && !fetched) fetched = a; }));
    offs.push(client.on('userList', list => { registered = list.filter(u => u.id !== 0).sort((a, b) => a.name.localeCompare(b.name)); }));
    client.queryAcl(0);
    client.queryUserList();
  }
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => () => { offs.forEach(off => off()); clearTimeout(refreshTimer); });

  // The saved names and icons are in the root description, which may still be on its way
  const root = $derived(session.channel(0));
  const rootReady = $derived(!!root && (!root.descriptionHash || !!root.description));
  $effect(() => { if (root?.descriptionHash && !root.description) session.loadDescription(0); });
  $effect(() => {
    if (!fetched || !rootReady || acl) return;
    acl = fetched;
    roles = rolesFromAcl(fetched, session.roleDoc);
    selected = roles[0]?.g ?? '';
    keyRole = roles.find(r => canHaveKeys(fetched!, r.g))?.g ?? '';
  });

  const role = $derived(roles.find(r => r.g === selected) ?? null);
  const custom = $derived(roles.filter(r => !isBuiltinRole(r.g)));
  const nameOf = (id: number) => registered.find(u => u.id === id)?.name ?? client?.registeredNames.get(id) ?? `user #${id}`;

  function change(next: ChannelAcl) {
    acl = next;
    roles = roles.map(r => ({ ...r, m: isBuiltinRole(r.g) ? [] : roleMembers(next, r.g) }));
    dirty = true;
    error = '';
  }

  function patch(values: Partial<RoleInfo>) {
    roles = roles.map(r => (r.g === selected ? { ...r, ...values } : r));
    dirty = true;
  }

  function setPermission(bit: number, value: Cell) {
    if (!acl || !role) return;
    const t = roleTarget(role.g);
    let next = setCell(acl, t, bit, value);
    // Administrator does not include voice; these keep admins from being silenced by accident
    if (isBuiltinRole(role.g) && value === 'deny' && VOICE_BITS.includes(bit) && adminsSilenced(next).includes(bit)) next = keepAdminVoice(next, [bit]);
    if (bit === PERM.Write && value === 'allow') {
      for (const v of VOICE_BITS) if (!cellValue(next, t, v)) next = setCell(next, t, v, 'allow');
    }
    change(next);
  }

  function move(g: string, by: -1 | 1) {
    const list = [...roles];
    const from = list.findIndex(r => r.g === g);
    const to = from + by;
    if (to < 0 || to >= custom.length) return;
    [list[from], list[to]] = [list[to], list[from]];
    roles = list;
    dirty = true;
  }

  function addRole() {
    const name = newName.trim().slice(0, MAX_ROLE_NAME);
    if (!acl || !name) return;
    if (custom.length >= MAX_ROLES) { error = `A server can have up to ${MAX_ROLES} roles.`; return; }
    const suffix = newKeyCode().slice(0, 4).toLowerCase();
    const made = createRole(acl, name, suffix);
    const entry: RoleInfo = { g: made.group, n: name, c: ROLE_COLORS[custom.length % ROLE_COLORS.length], i: 'shield', s: true, m: [] };
    roles = [...custom, entry, ...roles.filter(r => isBuiltinRole(r.g))];
    acl = made.acl;
    selected = made.group;
    section = 'permissions';
    newName = '';
    dirty = true;
    if (!keyRole) keyRole = made.group;
  }

  function removeRole() {
    if (!acl || !role || isFixedRole(role.g)) return;
    const gone = role.g;
    const next = deleteRole(acl, gone);
    roles = roles.filter(r => r.g !== gone);
    selected = roles[0]?.g ?? '';
    if (keyRole === gone) keyRole = roles.find(r => canHaveKeys(next, r.g))?.g ?? '';
    change(next);
  }

  async function pickIcon() {
    const file = picker?.files?.[0];
    if (picker) picker.value = '';
    if (!file) return;
    const icon = await makeRoleIcon(file);
    if (icon) { patch({ i: icon }); error = ''; } else error = 'That picture could not be used. Try a simpler PNG, WebP or JPEG.';
  }

  function addMember() {
    if (!acl || !role) return;
    const wanted = addName.trim().toLowerCase();
    const user = registered.find(u => u.name.toLowerCase() === wanted);
    if (!user) { error = `"${addName.trim()}" is not a registered user on this server.`; return; }
    change(setMember(acl, role.g, user.id, true));
    addName = '';
  }

  const shownPeople = $derived(registered.filter(u => u.name.toLowerCase().includes(query.trim().toLowerCase())));
  const guests = $derived(session.allUsers().filter(u => u.userId == null && u.name.toLowerCase().includes(query.trim().toLowerCase())));
  const personRoles = (id: number) => custom.filter(r => r.m.includes(id));
  const chosen = $derived(person != null ? registered.find(u => u.id === person) ?? null : null);

  function registerGuest(sessionId: number) {
    session.register(sessionId);
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => client?.queryUserList(), 900);
  }

  const keys = $derived(acl ? accessKeys(acl) : []);
  const keyRoles = $derived(acl ? custom.filter(r => canHaveKeys(acl!, r.g)) : []);
  const roleName = (g: string) => roles.find(r => r.g === g)?.n ?? g;

  async function copyKey(token: string) {
    await navigator.clipboard.writeText(token).catch(() => {});
    copied = token;
  }

  const losesAdmin = $derived.by(() => {
    const me = client?.self;
    if (!dirty || !acl || !me || me.userId === 0 || !client?.can(0, PERM.Write)) return false;
    const ready = prepareRoles(acl, roles);
    const level = { channelId: 0, name: 'Root', inheritAcls: ready.inheritAcls, rules: ready.acls, groups: ready.groups };
    const who = { userId: me.userId, hash: me.hash, channelId: me.channelId, tokens: session.ownTokens(), strong: false };
    return !(effectivePermissions([level], who, () => null) & PERM.Write);
  });

  function save() {
    if (!acl) return;
    const ready = prepareRoles(acl, roles);
    const problem = session.saveRoles(ready, docFromRoles(roles.map(r => ({ ...r, m: isBuiltinRole(r.g) ? [] : roleMembers(ready, r.g) }))));
    if (problem) { error = problem; return; }
    onclose();
  }
</script>

<Modal title="Roles and members" {onclose} width={940} height={700}>
  <div class="top" role="tablist">
    <button role="tab" aria-selected={tab === 'roles'} class:on={tab === 'roles'} onclick={() => (tab = 'roles')}>Roles</button>
    <button role="tab" aria-selected={tab === 'members'} class:on={tab === 'members'} onclick={() => (tab = 'members')}>Members</button>
    <button role="tab" aria-selected={tab === 'keys'} class:on={tab === 'keys'} onclick={() => (tab = 'keys')}>Access keys</button>
  </div>

  {#if !acl}
    <p class="dim">Loading roles...</p>
  {:else if tab === 'roles'}
    <div class="split">
      <div class="list">
        <p class="small" title="When two roles disagree about a permission, the one higher in this list decides.">Higher roles win.</p>
        <ul aria-label="Roles">
          {#each roles as r, i (r.g)}
            <li class:sel={r.g === selected}>
              <button class="pick" aria-pressed={r.g === selected} onclick={() => (selected = r.g)}>
                <span class="ri" style:color={roleTint(r.c)}><RoleIcon role={r} size={16} /></span>
                <span class="rn" style:color={roleTint(r.c)}>{r.n}</span>
                {#if !isBuiltinRole(r.g)}<span class="count">{r.m.length}</span>{/if}
              </button>
              {#if !isBuiltinRole(r.g)}
                <button class="mv" aria-label="Move {r.n} up" disabled={i === 0} onclick={() => move(r.g, -1)}><Icon name="arrow-up" size={13} /></button>
                <button class="mv" aria-label="Move {r.n} down" disabled={i === custom.length - 1} onclick={() => move(r.g, 1)}><Icon name="arrow-down" size={13} /></button>
              {/if}
            </li>
          {/each}
        </ul>
        <div class="row">
          <input bind:value={newName} maxlength={MAX_ROLE_NAME} placeholder="New role" aria-label="New role name" onkeydown={e => { if (e.key === 'Enter') addRole(); }} />
          <button class="btn" disabled={!newName.trim()} onclick={addRole}>Add</button>
        </div>
      </div>

      {#if role}
        <div class="detail">
          <div class="head">
            <span class="big" style:color={roleTint(role.c)}><RoleIcon {role} size={24} /></span>
            <div class="title">
              <h3 style:color={roleTint(role.c)}>{role.n}</h3>
              <span class="small">{isBuiltinRole(role.g) ? 'Everyone in this group, automatically' : `${role.m.length} ${role.m.length === 1 ? 'member' : 'members'}`}</span>
            </div>
            {#if !isFixedRole(role.g)}<button class="btn danger" onclick={removeRole}>Delete role</button>{/if}
          </div>
          <div class="sub" role="tablist" aria-label="Role sections">
            <button role="tab" aria-selected={section === 'permissions'} class:on={section === 'permissions'} onclick={() => (section = 'permissions')}>Permissions</button>
            <button role="tab" aria-selected={section === 'display'} class:on={section === 'display'} onclick={() => (section = 'display')}>Display</button>
            {#if !isBuiltinRole(role.g)}<button role="tab" aria-selected={section === 'members'} class:on={section === 'members'} onclick={() => (section = 'members')}>Members</button>{/if}
          </div>

          {#if section === 'permissions' || (section === 'members' && isBuiltinRole(role.g))}
            <div class="perms">
              {#each PERMISSION_GROUPS as g (g.name)}
                <section>
                  <h4>{g.name}</h4>
                  {#each g.items as p (p.bit)}
                    {@const v = cellValue(acl, roleTarget(role.g), p.bit)}
                    <div class="perm">
                      <span title={p.help}>{p.name}</span>
                      <span class="seg" role="group" aria-label={p.name}>
                        <button class:deny={v === 'deny'} aria-pressed={v === 'deny'} aria-label="{p.name}: Deny" onclick={() => setPermission(p.bit, 'deny')}><Icon name="x" size={13} /></button>
                        <button class:none={v === null} aria-pressed={v === null} aria-label="{p.name}: Not set" onclick={() => setPermission(p.bit, null)}><span class="dash"></span></button>
                        <button class:allow={v === 'allow'} aria-pressed={v === 'allow'} aria-label="{p.name}: Allow" onclick={() => setPermission(p.bit, 'allow')}><Icon name="check" size={13} /></button>
                      </span>
                    </div>
                  {/each}
                </section>
              {/each}
            </div>
            {#if cellValue(acl, roleTarget(role.g), PERM.Write) === 'allow'}
              <p class="warn">Administrator can change every role, including higher ones. It does not include Speak or Whisper.</p>
            {/if}
          {:else if section === 'display'}
            <div class="look">
              <div>
                <label for="role-name">Name</label>
                <input id="role-name" value={role.n} maxlength={MAX_ROLE_NAME} oninput={e => patch({ n: e.currentTarget.value })} />
                <div class="lab">Color</div>
                <div class="swatches" role="group" aria-label="Color">
                  <button class="swatch none" class:on={!role.c} aria-label="No color" aria-pressed={!role.c} onclick={() => patch({ c: '' })}></button>
                  {#each ROLE_COLORS as c (c)}
                    <button class="swatch" class:on={role.c === c} style:background={c} aria-label="Color {c}" aria-pressed={role.c === c} onclick={() => patch({ c })}></button>
                  {/each}
                </div>
              </div>
              <div>
                <div class="lab first">Icon</div>
                <div class="icons" role="group" aria-label="Icon">
                  {#each ROLE_ICONS as i (i)}
                    <button class:on={role.i === i} style:color={roleTint(role.c)} aria-label="Icon {i}" aria-pressed={role.i === i} onclick={() => patch({ i })}><Icon name={i} size={18} /></button>
                  {/each}
                  {#if role.i.startsWith('data:')}<button class="on" aria-label="Your picture" aria-pressed="true"><RoleIcon {role} size={20} /></button>{/if}
                </div>
                <button class="btn upload" onclick={() => picker?.click()}>Upload icon</button>
                <input bind:this={picker} type="file" accept="image/png,image/webp,image/jpeg,image/svg+xml,image/gif" hidden aria-label="Icon file" onchange={pickIcon} />
                <p class="small">Scaled to 32 px.</p>
                <label class="check"><input type="checkbox" checked={role.s} onchange={e => patch({ s: e.currentTarget.checked })} /> Show icon next to names</label>
              </div>
            </div>
          {:else}
            <div class="row">
              <input bind:value={addName} list="role-people" placeholder="Registered user" aria-label="Add a member" onkeydown={e => { if (e.key === 'Enter') addMember(); }} />
              <datalist id="role-people">{#each registered.filter(u => !role?.m.includes(u.id)) as u (u.id)}<option value={u.name}></option>{/each}</datalist>
              <button class="btn" disabled={!addName.trim()} onclick={addMember}>Add member</button>
            </div>
            <ul class="people">
              {#each role.m as id (id)}
                <li><span>{nameOf(id)}</span><button class="link danger" aria-label="Remove {nameOf(id)}" onclick={() => change(setMember(acl!, role!.g, id, false))}>Remove</button></li>
              {:else}
                <li class="dim">Nobody yet</li>
              {/each}
            </ul>
          {/if}
        </div>
      {/if}
    </div>
  {:else if tab === 'members'}
    <div class="split wide">
      <div class="list">
        <input bind:value={query} placeholder="Search members" aria-label="Search members" />
        <ul aria-label="Members">
          {#each shownPeople as u (u.id)}
            <li class:sel={u.id === person}>
              <button class="pick" aria-pressed={u.id === person} onclick={() => (person = u.id)}>
                <span class="rn">{u.name}</span>
                <span class="mini">{#each personRoles(u.id).slice(0, 4) as r (r.g)}<span title={r.n} style:color={roleTint(r.c)}><RoleIcon role={r} size={13} /></span>{/each}</span>
              </button>
            </li>
          {:else}
            <li class="dim pad">No registered users found</li>
          {/each}
        </ul>
        {#if guests.length}
          <h4>Online guests</h4>
          <ul aria-label="Online guests">
            {#each guests as u (u.session)}
              <li class="guest"><span class="rn">{u.name}</span><button class="link" onclick={() => registerGuest(u.session)}>Register</button></li>
            {/each}
          </ul>
        {/if}
      </div>
      <div class="detail">
        {#if chosen}
          <h3>{chosen.name}</h3>
          <p class="small">Choose this person's roles.</p>
          <div class="toggles">
            {#each custom as r (r.g)}
              {@const on = r.m.includes(chosen.id)}
              <label class="toggle" class:on style:color={roleTint(r.c)}>
                <input type="checkbox" checked={on} onchange={e => change(setMember(acl!, r.g, chosen!.id, e.currentTarget.checked))} />
                <RoleIcon role={r} size={15} /> <span>{r.n}</span>
              </label>
            {/each}
          </div>
        {:else}
          <p class="dim">Select a person. Guests need to be registered before they can hold a role.</p>
        {/if}
      </div>
    </div>
  {:else}
    <div class="keys">
      <p class="small">Anyone with a key gets its role's server permissions while connected. It shows no badge. Delete a key to end its access.</p>
      <div class="row">
        <select bind:value={keyRole} aria-label="Role for the key" disabled={!keyRoles.length}>
          {#each keyRoles as r (r.g)}<option value={r.g}>{r.n}</option>{/each}
        </select>
        <button class="btn" disabled={!keyRole} onclick={() => change(addKey(acl!, keyRole, newKeyCode()))}>New key</button>
      </div>
      {#if !keyRoles.length}<p class="dim">Create a role without Administrator first.</p>{/if}
      <ul class="people" aria-label="Access keys">
        {#each keys as k (k.token)}
          <li>
            <span class="key"><code>{k.token}</code><small>{roleName(k.role)}</small></span>
            <span class="acts">
              <button class="btn" aria-label="Copy key for {roleName(k.role)}" onclick={() => copyKey(k.token)}>{copied === k.token ? 'Copied' : 'Copy'}</button>
              <button class="btn" aria-label="Delete key for {roleName(k.role)}" onclick={() => change(removeKey(acl!, k.token))}>Delete</button>
            </span>
          </li>
        {:else}
          <li class="dim">No keys yet</li>
        {/each}
      </ul>
      {#if keys.length && dirty}<p class="small">New keys work after you save.</p>{/if}
    </div>
  {/if}

  {#snippet footer()}
    {#if losesAdmin}<p class="foot warn">Saving removes your own admin access.</p>{:else if error}<p class="foot err">{error}</p>{/if}
    <button class="btn" onclick={onclose}>Cancel</button>
    <button class="btn primary" disabled={!acl || !dirty} onclick={save}>Save</button>
  {/snippet}
</Modal>

<style>
  .top, .sub { display: flex; flex-wrap: wrap; gap: 2px; border-bottom: 1px solid var(--line); }
  .top { margin: 8px 0 12px; }
  .top button, .sub button { padding: 8px 14px; font-weight: 600; color: var(--text-dim); }
  .sub button { padding: 7px 12px; font-size: 13px; }
  .top button.on, .sub button.on { color: var(--text); box-shadow: inset 0 -2px 0 var(--accent); }
  .split { display: grid; grid-template-columns: 250px minmax(0, 1fr); gap: 18px; }
  .split.wide { grid-template-columns: 300px minmax(0, 1fr); }
  @media (max-width: 760px) { .split, .split.wide { grid-template-columns: minmax(0, 1fr); } }
  .list { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
  ul { list-style: none; margin: 0; padding: 0; }
  .list ul { border: 1px solid var(--line); background: var(--bg-0); max-height: 430px; overflow-y: auto; }
  .list li { display: flex; align-items: center; }
  .list li:hover { background: var(--bg-hover); }
  .list li.sel { background: var(--bg-active); }
  .pick { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; min-height: 38px; padding: 0 8px; text-align: left; font-size: 14px; }
  .ri { flex: none; display: inline-flex; color: var(--text-dim); }
  .rn { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 550; }
  .count { font-size: 12px; color: var(--text-dim); }
  .mini { display: inline-flex; gap: 3px; }
  .mini span { display: inline-flex; color: var(--text-dim); }
  .mv { flex: none; width: 24px; height: 28px; display: inline-flex; align-items: center; justify-content: center; color: var(--text-dim); }
  .mv:hover:not(:disabled) { color: var(--text); background: var(--bg-3); }
  .mv:disabled { opacity: 0.25; }
  .row { display: flex; gap: 6px; }
  .row input, .row select { flex: 1; min-width: 0; }
  .detail { min-width: 0; }
  .head { display: flex; align-items: center; gap: 12px; margin-bottom: 6px; }
  .big { flex: none; width: 42px; height: 42px; display: inline-flex; align-items: center; justify-content: center; background: var(--bg-3); color: var(--text-dim); }
  .title { flex: 1; min-width: 0; }
  h3 { margin: 0; font-size: 18px; font-weight: 680; overflow-wrap: anywhere; }
  h4 { margin: 0 0 4px; font-size: 11px; font-weight: 650; text-transform: uppercase; letter-spacing: 0.07em; color: var(--text-dim); }
  .list h4 { margin-top: 8px; }
  .perms { display: grid; grid-template-columns: repeat(auto-fit, minmax(270px, 1fr)); gap: 14px 24px; margin-top: 12px; }
  .perm { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 36px; border-bottom: 1px solid var(--line); font-size: 14px; }
  .seg { flex: none; display: inline-flex; padding-left: 1px; }
  .seg button { width: 36px; height: 28px; margin-left: -1px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--line-strong); background: var(--bg-0); color: var(--text-dim); }
  .seg button:hover { background: var(--bg-hover); color: var(--text); }
  .seg button.none { background: var(--bg-active); color: var(--text); }
  .seg button.allow { position: relative; background: color-mix(in srgb, var(--speaking) 30%, var(--bg-1)); border-color: var(--speaking); color: var(--text); }
  .seg button.deny { position: relative; background: color-mix(in srgb, var(--danger) 32%, var(--bg-1)); border-color: var(--danger); color: var(--text); }
  .dash { width: 8px; height: 1px; background: currentColor; }
  .look { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 22px; margin-top: 4px; }
  .lab { margin: 16px 0 6px; font-size: 13px; font-weight: 600; color: var(--text-dim); }
  .lab.first { margin-top: 16px; }
  .swatches, .icons { display: flex; flex-wrap: wrap; gap: 5px; }
  .swatch { width: 28px; height: 28px; border: 2px solid transparent; }
  .swatch.none { background: linear-gradient(135deg, transparent 47%, var(--danger) 47%, var(--danger) 53%, transparent 53%), var(--bg-0); border-color: var(--line-strong); }
  .swatch.on { border-color: var(--text); }
  .icons button { width: 36px; height: 36px; display: inline-flex; align-items: center; justify-content: center; background: var(--bg-0); border: 1px solid var(--line-strong); color: var(--text-dim); }
  .icons button:hover { background: var(--bg-hover); }
  .icons button.on { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
  .upload { margin-top: 8px; }
  .check { display: flex; align-items: center; gap: 8px; margin: 10px 0 0; font-size: 14px; font-weight: 400; color: var(--text); }
  .people { margin-top: 10px; border: 1px solid var(--line); }
  .people li { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 40px; padding: 4px 10px; font-size: 14px; flex-wrap: wrap; }
  .people li + li { border-top: 1px solid var(--line); }
  .guest { justify-content: space-between; gap: 8px; min-height: 36px; padding: 0 8px; font-size: 14px; }
  .toggles { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 6px; margin-top: 10px; }
  .toggle { display: flex; align-items: center; gap: 8px; min-height: 40px; margin: 0; padding: 0 10px; background: var(--bg-2); border: 1px solid var(--line-strong); font-size: 14px; font-weight: 550; color: var(--text); }
  .toggle.on { border-color: var(--accent); }
  .toggle span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .keys { display: flex; flex-direction: column; gap: 8px; max-width: 720px; }
  .key { display: flex; flex-direction: column; min-width: 0; }
  code { font-family: var(--mono); font-size: 13px; overflow-wrap: anywhere; }
  small { font-size: 12px; color: var(--text-dim); }
  .acts { display: inline-flex; gap: 4px; }
  .link { color: var(--link); font-size: 13px; }
  .link.danger { color: var(--danger); }
  .btn.danger { color: var(--danger); }
  .small { margin: 0; font-size: 12px; line-height: 1.4; color: var(--text-dim); }
  .dim { color: var(--text-dim); }
  .pad { padding: 8px 10px; }
  .warn { margin: 12px 0 0; font-size: 13px; color: var(--warn); }
  .foot { flex: 1; min-width: 0; margin: 0; font-size: 13px; }
  .err { color: var(--danger); }
</style>
