<script lang="ts">
  import Modal from './Modal.svelte';
  import RichEditor from './RichEditor.svelte';
  import { session } from '../lib/session.svelte.ts';
  import { PERM, type ChannelAcl, type AclEntry, type AclGroup } from '../core/client.ts';
  import { sounds } from '../lib/audio/sounds.svelte.ts';
  import { isTextChannel, markText, stripMark } from '../core/text-signal.ts';
  import { textChannels } from '../lib/text-channels.ts';
  import { sessions } from '../lib/session.svelte.ts';

  type Props =
    | { mode: 'create'; parent: number; onclose: () => void; tab?: undefined; id?: undefined }
    | { mode: 'edit'; id: number; tab?: 'general' | 'permissions' | 'groups'; onclose: () => void; parent?: undefined };
  let props: Props = $props();

  // svelte-ignore state_referenced_locally
  const { mode, onclose } = props;
  // svelte-ignore state_referenced_locally
  const channelId = props.mode === 'edit' ? props.id : null;
  // svelte-ignore state_referenced_locally
  const parentId = props.mode === 'create' ? props.parent : null;
  const client = session.client;

  const channel = $derived(channelId != null ? session.channel(channelId) : undefined);
  const parent = $derived(session.channel(parentId ?? channel?.parent ?? 0));
  const isRoot = channelId === 0;

  // svelte-ignore state_referenced_locally
  let tab = $state<'general' | 'permissions' | 'groups'>(props.tab ?? 'general');
  let error = $state('');

  // ─── General ────────────────────────────────────────────────────────────────
  // svelte-ignore state_referenced_locally
  const initial = channelId != null ? session.channel(channelId) : undefined;
  let name = $state(initial?.name ?? '');
  // The editor never sees the text channel marker; it is put back when saving
  let description = $state(stripMark(initial?.description ?? ''));
  let textChannel = $state(isTextChannel(initial?.description ?? ''));
  // The marker is an HTML comment and the messages are plugin data
  const textPossible = textChannels.supported(sessions.active) && session.serverInfo?.config.allowHtml !== false;
  let position = $state(initial?.position ?? 0);
  let maxUsers = $state(initial?.maxUsers ?? 0);
  let temporary = $state(false);
  const canTemp = $derived(session.can(parentId ?? 0, PERM.MakeTempChannel) !== false);
  const canPermanent = $derived(session.can(parentId ?? 0, PERM.MakeChannel) !== false);
  $effect(() => { if (mode === 'create' && !canPermanent && canTemp) temporary = true; });

  // Long descriptions arrive later; take them into the editor once they do
  const descPending = $derived(!!channel?.descriptionHash && !channel.description);
  let descLoaded = $state(!(initial?.descriptionHash && !initial?.description));
  $effect(() => {
    if (channelId != null && descPending) session.loadDescription(channelId);
    if (!descLoaded && channel?.description) { description = stripMark(channel.description); textChannel = isTextChannel(channel.description); descLoaded = true; }
  });

  // ─── ACL ────────────────────────────────────────────────────────────────────
  let acl = $state<ChannelAcl | null>(null);
  let aclDirty = $state(false);
  let selectedRule = $state(-1);
  let selectedGroup = $state('');
  let names = $state<Record<number, string>>({});

  const offs: (() => void)[] = [];
  if (client && channelId != null) {
    offs.push(client.on('acl', a => {
      if (a.channelId !== channelId || acl) return;
      acl = a;
      selectedRule = a.acls.findIndex(r => !r.inherited);
      selectedGroup = a.groups[0]?.name ?? '';
    }));
    offs.push(client.on('userNames', m => { names = Object.fromEntries(m); }));
    names = Object.fromEntries(client.registeredNames);
    client.queryAcl(channelId);
  }
  $effect(() => () => offs.forEach(off => off()));

  const userName = (id: number) => names[id] ?? `user #${id}`;
  const touch = () => { aclDirty = true; };

  // Registered user id for a name, asked from the server
  function resolveName(raw: string): Promise<number | null> {
    const wanted = raw.trim().toLowerCase();
    const known = Object.entries(names).find(([, n]) => n.toLowerCase() === wanted);
    if (known) return Promise.resolve(Number(known[0]));
    if (!client || !wanted) return Promise.resolve(null);
    return new Promise(resolve => {
      const timer = setTimeout(() => { off(); resolve(null); }, 3000);
      const off = client.on('userNames', m => {
        for (const [id, n] of m) if (n.toLowerCase() === wanted) { clearTimeout(timer); off(); resolve(id); return; }
      });
      client.queryUsers({ names: [raw.trim()] });
    });
  }

  const PERMS: { bit: number; name: string; rootOnly?: boolean }[] = [
    { bit: PERM.Write, name: 'Write ACL (full control)' },
    { bit: PERM.Traverse, name: 'Traverse' },
    { bit: PERM.Enter, name: 'Enter' },
    { bit: PERM.Speak, name: 'Speak' },
    { bit: PERM.Whisper, name: 'Whisper' },
    { bit: PERM.TextMessage, name: 'Text message' },
    { bit: PERM.Listen, name: 'Listen' },
    { bit: PERM.MuteDeafen, name: 'Mute and deafen' },
    { bit: PERM.Move, name: 'Move users' },
    { bit: PERM.MakeChannel, name: 'Make channel' },
    { bit: PERM.MakeTempChannel, name: 'Make temporary channel' },
    { bit: PERM.LinkChannel, name: 'Link channel' },
    { bit: PERM.Kick, name: 'Kick users', rootOnly: true },
    { bit: PERM.Ban, name: 'Ban users', rootOnly: true },
    { bit: PERM.Register, name: 'Register users', rootOnly: true },
    { bit: PERM.SelfRegister, name: 'Register self', rootOnly: true },
    { bit: PERM.ResetUserContent, name: 'Reset user content', rootOnly: true }
  ];
  const permList = $derived(PERMS.filter(p => !p.rootOnly || isRoot));
  const BUILTIN_GROUPS = ['all', 'auth', 'in', 'out', 'sub', 'admin'];
  const groupSuggestions = $derived([...new Set([...BUILTIN_GROUPS, ...(acl?.groups.map(g => g.name) ?? [])])]);

  // $<certhash> groups match one certificate; name them after the online user when we can
  function groupLabel(g: string | null): string {
    if (g?.startsWith('$')) {
      const u = session.allUsers().find(x => x.hash === g.slice(1));
      return u ? `Certificate of ${u.name}` : `Certificate ${g.slice(1, 9)}...`;
    }
    return `@${g}`;
  }
  const ruleLabel = (r: AclEntry) => r.userId != null ? userName(r.userId) : groupLabel(r.group);
  const rule = $derived(acl && selectedRule >= 0 ? acl.acls[selectedRule] : null);
  let targetText = $state('');
  let targetKind = $state<'group' | 'user'>('group');
  $effect(() => {
    const r = rule;
    if (!r) return;
    targetKind = r.userId != null ? 'user' : 'group';
    targetText = r.userId != null ? userName(r.userId) : r.group ?? 'all';
  });

  function addRule() {
    if (!acl) return;
    acl.acls.push({ applyHere: true, applySubs: true, inherited: false, userId: null, group: 'all', grant: 0, deny: 0 });
    selectedRule = acl.acls.length - 1;
    touch();
  }

  function removeRule() {
    if (!acl || !rule || rule.inherited) return;
    acl.acls.splice(selectedRule, 1);
    selectedRule = Math.min(selectedRule, acl.acls.length - 1);
    touch();
  }

  // Rules are evaluated in order; only the channel's own rules can move, and not above inherited ones
  function moveRule(dir: -1 | 1) {
    if (!acl || !rule || rule.inherited) return;
    const to = selectedRule + dir;
    if (to < 0 || to >= acl.acls.length || acl.acls[to].inherited) return;
    [acl.acls[selectedRule], acl.acls[to]] = [acl.acls[to], acl.acls[selectedRule]];
    selectedRule = to;
    touch();
  }

  async function applyTarget() {
    if (!rule || rule.inherited) return;
    error = '';
    if (targetKind === 'group') {
      rule.userId = null;
      rule.group = targetText.trim().replace(/^@/, '') || 'all';
    } else {
      const id = await resolveName(targetText);
      if (id == null) { error = `"${targetText}" is not a registered user on this server.`; return; }
      rule.userId = id;
      rule.group = null;
    }
    touch();
  }

  function setBit(kind: 'grant' | 'deny', bit: number, on: boolean) {
    if (!rule || rule.inherited) return;
    const other = kind === 'grant' ? 'deny' : 'grant';
    rule[kind] = on ? rule[kind] | bit : rule[kind] & ~bit;
    if (on) rule[other] &= ~bit; // allow and deny exclude each other
    touch();
  }

  // ─── Groups ─────────────────────────────────────────────────────────────────
  const group = $derived(acl?.groups.find(g => g.name === selectedGroup) ?? null);
  let newGroup = $state('');
  let newMember = $state('');

  function addGroup() {
    const n = newGroup.trim().replace(/^@/, '');
    if (!acl || !n || acl.groups.some(g => g.name === n)) return;
    acl.groups.push({ name: n, inherited: false, inherit: true, inheritable: true, add: [], remove: [], inheritedMembers: [] });
    selectedGroup = n;
    newGroup = '';
    touch();
  }

  function deleteGroup() {
    if (!acl || !group || group.inherited) return;
    acl.groups = acl.groups.filter(g => g !== group);
    selectedGroup = acl.groups[0]?.name ?? '';
    touch();
  }

  async function addMember() {
    if (!group) return;
    error = '';
    const id = await resolveName(newMember);
    if (id == null) { error = `"${newMember}" is not a registered user on this server.`; return; }
    if (!group.add.includes(id)) group.add.push(id);
    group.remove = group.remove.filter(x => x !== id);
    newMember = '';
    touch();
  }

  function toggleInheritedMember(g: AclGroup, id: number) {
    g.remove = g.remove.includes(id) ? g.remove.filter(x => x !== id) : [...g.remove, id];
    touch();
  }

  // ─── Save ───────────────────────────────────────────────────────────────────
  function save() {
    if (!client) return;
    error = '';
    if (mode === 'create') {
      if (!name.trim()) { error = 'The channel needs a name.'; return; }
      client.createChannel(parentId!, name.trim(), { temporary, description: markText(description, textChannel), position, maxUsers });
      sounds.play('channelCreated');
      return onclose();
    }
    const ch = channel;
    if (!ch || channelId == null) return onclose();
    const fields: { name?: string; description?: string; position?: number; maxUsers?: number } = {};
    if (!isRoot && name.trim() && name.trim() !== ch.name) fields.name = name.trim();
    // An untouched description may not start with the marker; that alone is no change
    const changed = description !== stripMark(ch.description) || textChannel !== isTextChannel(ch.description);
    if (descLoaded && changed) fields.description = markText(description, textChannel);
    if (position !== ch.position) fields.position = Number(position) || 0;
    if (maxUsers !== ch.maxUsers) fields.maxUsers = Number(maxUsers) || 0;
    if (Object.keys(fields).length) client.updateChannel(channelId, fields);
    if (acl && aclDirty) client.saveAcl($state.snapshot(acl) as ChannelAcl);
    if (Object.keys(fields).length || aclDirty) sounds.play('channelEdited');
    onclose();
  }

  const title = $derived(mode === 'create' ? `New channel in ${parent?.name || 'Root'}` : `Channel: ${channel?.name || 'Root'}`);
</script>

<Modal {title} {onclose} width={760}>
  {#if mode === 'edit'}
    <div class="tabs" role="tablist">
      <button role="tab" aria-selected={tab === 'general'} class:active={tab === 'general'} onclick={() => (tab = 'general')}>General</button>
      <button role="tab" aria-selected={tab === 'permissions'} class:active={tab === 'permissions'} onclick={() => (tab = 'permissions')}>Permissions</button>
      <button role="tab" aria-selected={tab === 'groups'} class:active={tab === 'groups'} onclick={() => (tab = 'groups')}>Groups</button>
    </div>
  {/if}

  {#if tab === 'general'}
    <label for="ch-name">Name</label>
    <input id="ch-name" bind:value={name} disabled={isRoot} placeholder="Channel name" />
    <label for="ch-desc">Description</label>
    {#if descLoaded}
      <RichEditor value={description} limit={session.htmlLimit} placeholder="What is this channel for?" onchange={h => (description = h)} />
    {:else}
      <p class="dim">Loading description...</p>
    {/if}
    <div class="row3">
      <div>
        <label for="ch-pos">Position</label>
        <input id="ch-pos" type="number" bind:value={position} />
      </div>
      <div>
        <label for="ch-max">User limit</label>
        <input id="ch-max" type="number" min="0" bind:value={maxUsers} />
      </div>
      {#if mode === 'create'}
        <label class="check"><input type="checkbox" bind:checked={temporary} disabled={!canTemp || !canPermanent} /> Temporary (removed when empty)</label>
      {/if}
    </div>
    {#if !isRoot}
      <label class="check top" title="Read and written without joining, from any channel. Only mumh5 shows it this way; in other Mumble clients it is an ordinary channel and its messages are not visible there. The server keeps no messages: mumh5 clients keep them and pass the recent ones on to people who connect later. Everyone on the server who uses mumh5 can read it.">
        <input type="checkbox" bind:checked={textChannel} disabled={!textPossible} /> Text channel (mumh5 only)
      </label>
      {#if !textPossible}<p class="dim small">Text channels need a server from version 1.4 that allows HTML.</p>{/if}
    {/if}
    <p class="dim small">Lower positions come first. A user limit of 0 uses the server default.</p>
  {:else if !acl}
    <p class="dim">Loading permissions...</p>
  {:else if tab === 'permissions'}
    <label class="check top"><input type="checkbox" bind:checked={acl.inheritAcls} onchange={touch} /> Inherit rules from the parent channel</label>
    <div class="split">
      <div class="listcol">
        <ul class="list" role="listbox" aria-label="Rules">
          {#each acl.acls as r, i (i)}
            <li>
              <button role="option" aria-selected={i === selectedRule} class:sel={i === selectedRule} class:inh={r.inherited} onclick={() => (selectedRule = i)}>
                <span>{ruleLabel(r)}</span>
                {#if r.inherited}<small>inherited</small>{/if}
              </button>
            </li>
          {:else}
            <li class="dim small pad">No rules yet</li>
          {/each}
        </ul>
        <div class="listbtns">
          <button class="btn" onclick={addRule}>Add</button>
          <button class="btn" disabled={!rule || rule.inherited} onclick={removeRule}>Remove</button>
          <button class="btn" disabled={!rule || rule.inherited} onclick={() => moveRule(-1)} aria-label="Move up">Up</button>
          <button class="btn" disabled={!rule || rule.inherited} onclick={() => moveRule(1)} aria-label="Move down">Down</button>
        </div>
      </div>
      <div class="detail">
        {#if rule}
          {#if rule.inherited}<p class="note">Inherited from a parent channel. Edit it there, or turn off inheriting above.</p>{/if}
          <fieldset disabled={rule.inherited}>
            <div class="target">
              <select bind:value={targetKind} aria-label="Target type">
                <option value="group">Group</option>
                <option value="user">User</option>
              </select>
              <input bind:value={targetText} list="ch-groups" aria-label="Target" onchange={applyTarget}
                placeholder={targetKind === 'group' ? 'all, auth, in, admin...' : 'Registered user name'} />
              <datalist id="ch-groups">{#each groupSuggestions as g (g)}<option value={g}></option>{/each}</datalist>
            </div>
            <div class="applies">
              <label class="check"><input type="checkbox" bind:checked={rule.applyHere} onchange={touch} /> Applies to this channel</label>
              <label class="check"><input type="checkbox" bind:checked={rule.applySubs} onchange={touch} /> Applies to subchannels</label>
            </div>
            <table class="perms">
              <thead><tr><th>Permission</th><th>Allow</th><th>Deny</th></tr></thead>
              <tbody>
                {#each permList as p (p.bit)}
                  <tr>
                    <td>{p.name}</td>
                    <td><input type="checkbox" aria-label="Allow {p.name}" checked={(rule.grant & p.bit) !== 0} onchange={e => setBit('grant', p.bit, e.currentTarget.checked)} /></td>
                    <td><input type="checkbox" aria-label="Deny {p.name}" checked={(rule.deny & p.bit) !== 0} onchange={e => setBit('deny', p.bit, e.currentTarget.checked)} /></td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </fieldset>
        {:else}
          <p class="dim">Select a rule, or add one.</p>
        {/if}
      </div>
    </div>
  {:else}
    <div class="split">
      <div class="listcol">
        <ul class="list" role="listbox" aria-label="Groups">
          {#each acl.groups as g (g.name)}
            <li>
              <button role="option" aria-selected={g.name === selectedGroup} class:sel={g.name === selectedGroup} onclick={() => (selectedGroup = g.name)}>
                <span>@{g.name}</span>
                {#if g.inherited}<small>inherited</small>{/if}
              </button>
            </li>
          {:else}
            <li class="dim small pad">No groups yet</li>
          {/each}
        </ul>
        <div class="listbtns">
          <input bind:value={newGroup} placeholder="New group" aria-label="New group name" onkeydown={e => { if (e.key === 'Enter') addGroup(); }} />
          <button class="btn" onclick={addGroup} disabled={!newGroup.trim()}>Add</button>
          <button class="btn" disabled={!group || group.inherited} onclick={deleteGroup}>Delete</button>
        </div>
      </div>
      <div class="detail">
        {#if group}
          <label class="check"><input type="checkbox" bind:checked={group.inherit} onchange={touch} /> Include members of the parent's @{group.name}</label>
          <label class="check"><input type="checkbox" bind:checked={group.inheritable} onchange={touch} /> Subchannels can use this group</label>
          <h4>Members added here</h4>
          <ul class="members">
            {#each group.add as id (id)}
              <li><span>{userName(id)}</span><button class="link danger" onclick={() => { group.add = group.add.filter(x => x !== id); touch(); }}>Remove</button></li>
            {:else}
              <li class="dim small">Nobody yet</li>
            {/each}
          </ul>
          <div class="target">
            <input bind:value={newMember} placeholder="Registered user name" aria-label="Member name" onkeydown={e => { if (e.key === 'Enter') addMember(); }} />
            <button class="btn" onclick={addMember} disabled={!newMember.trim()}>Add member</button>
          </div>
          {#if group.inheritedMembers.length}
            <h4>Inherited members</h4>
            <ul class="members">
              {#each group.inheritedMembers as id (id)}
                {@const excluded = group.remove.includes(id)}
                <li><span class:struck={excluded}>{userName(id)}</span>
                  <button class="link" onclick={() => toggleInheritedMember(group, id)}>{excluded ? 'Include again' : 'Exclude here'}</button></li>
              {/each}
            </ul>
          {/if}
        {:else}
          <p class="dim">Select a group, or add one.</p>
        {/if}
      </div>
    </div>
  {/if}

  {#if error}<p class="error">{error}</p>{/if}

  {#snippet footer()}
    <button class="btn" onclick={onclose}>Cancel</button>
    <button class="btn primary" onclick={save}>{mode === 'create' ? 'Create channel' : 'Save'}</button>
  {/snippet}
</Modal>

<style>
  .tabs { display: flex; gap: 2px; margin: 8px 0 4px; border-bottom: 1px solid var(--line); }
  .tabs button { padding: 8px 14px; color: var(--text-dim); font-weight: 600; }
  .tabs button.active { color: var(--text); box-shadow: inset 0 -2px 0 var(--accent); }
  .row3 { display: flex; gap: 12px; align-items: flex-end; flex-wrap: wrap; }
  .row3 > div { width: 140px; }
  .check { display: flex; align-items: center; gap: 8px; text-transform: none; font-weight: 400; letter-spacing: 0; font-size: 14px; color: var(--text); margin: 10px 0 0; }
  .check.top { margin-top: 12px; }
  .split { display: grid; grid-template-columns: 220px 1fr; gap: 14px; margin-top: 12px; }
  @media (max-width: 640px) { .split { grid-template-columns: 1fr; } }
  .list { list-style: none; margin: 0; padding: 0; border: 1px solid var(--line); background: var(--bg-0); max-height: 340px; overflow-y: auto; }
  .list button { display: flex; justify-content: space-between; align-items: center; gap: 8px; width: 100%; padding: 6px 10px; text-align: left; font-size: 14px; }
  .list button span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .list { overflow-x: hidden; }
  .list button:hover { background: var(--bg-hover); }
  .list button.sel { background: var(--accent); color: var(--accent-text); }
  .list button.inh:not(.sel) { color: var(--text-dim); }
  .list small { font-size: 11px; opacity: 0.8; }
  .pad { padding: 8px 10px; }
  .listbtns { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
  .listbtns .btn { padding: 4px 10px; font-size: 13px; }
  .listbtns input { flex: 1 1 100%; }
  .detail { min-width: 0; }
  fieldset { border: 0; margin: 0; padding: 0; min-width: 0; }
  fieldset:disabled { opacity: 0.6; }
  .target { display: flex; gap: 6px; }
  .target select { width: 100px; flex: none; }
  .applies { display: flex; gap: 16px; flex-wrap: wrap; }
  .perms { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 13px; }
  .perms th { text-align: left; color: var(--text-faint); font-weight: 600; padding: 4px 6px; border-bottom: 1px solid var(--line); }
  .perms td { padding: 3px 6px; border-bottom: 1px solid var(--line); }
  .perms th:not(:first-child), .perms td:not(:first-child) { text-align: center; width: 60px; }
  .perms input { vertical-align: middle; }
  h4 { margin: 16px 0 6px; font-size: 11px; font-weight: 650; text-transform: uppercase; letter-spacing: 0.07em; color: var(--text-dim); }
  .members { list-style: none; margin: 0 0 8px; padding: 0; }
  .members li { display: flex; justify-content: space-between; padding: 3px 0; font-size: 14px; }
  .struck { text-decoration: line-through; color: var(--text-faint); }
  .link { color: var(--link); font-size: 13px; }
  .link.danger { color: var(--danger); }
  .note { margin: 0 0 8px; font-size: 13px; color: var(--warn); }
  .dim { color: var(--text-dim); }
  .small { font-size: 12px; }
  .error { color: var(--danger); margin: 10px 0 0; }
</style>
