<script lang="ts">
  import Modal from './Modal.svelte';
  import { store, type SavedServer } from '../lib/settings.svelte.ts';
  import { sessions } from '../lib/session.svelte.ts';
  import { identities } from '../lib/identities.svelte.ts';
  import { makeServerIcon } from '../lib/upload.ts';

  // prefill: values for a new server, e.g. picked from the public list
  let { server, prefill, onclose }: { server: SavedServer | null; prefill?: { host?: string; port?: number; label?: string }; onclose: () => void } = $props();

  // svelte-ignore state_referenced_locally
  const initial = server;
  // svelte-ignore state_referenced_locally
  const pre = prefill ?? {};
  let label = $state(initial?.label ?? pre.label ?? '');
  let host = $state(initial?.host ?? pre.host ?? '');
  let port = $state(initial?.port ?? pre.port ?? 64738);
  // New servers start with the name you used last
  let username = $state(initial?.username ?? store.servers.at(-1)?.username ?? '');
  let password = $state(initial?.password ?? '');
  let identityId = $state(initial?.identityId ?? '');
  let icon = $state(initial?.icon ?? '');
  let iconError = $state('');
  let iconPicker: HTMLInputElement;

  async function pickIcon() {
    const file = iconPicker.files?.[0];
    iconPicker.value = '';
    if (!file) return;
    iconError = '';
    try { icon = await makeServerIcon(file); } catch { iconError = 'Could not read this image.'; }
  }

  const valid = $derived(host.trim() && username.trim() && port > 0 && port < 65536);

  function build(): SavedServer {
    // Accept "host:port" pasted into the host field
    let h = host.trim(), p = Number(port);
    const m = /^(.+):(\d+)$/.exec(h);
    if (m && !h.includes(']')) { h = m[1]; p = Number(m[2]); }
    return { id: initial?.id ?? crypto.randomUUID(), label: label.trim() || h, host: h, port: p, username: username.trim(), password, identityId: identityId || undefined, icon: icon || undefined };
  }

  function saveAndConnect(e: SubmitEvent) {
    e.preventDefault();
    if (!valid) return;
    const s = build();
    store.upsertServer(s);
    // Reconnect with the new settings if it was connected
    if (sessions.byServer(s.id)) sessions.close(s.id);
    sessions.open(s);
    onclose();
  }

  function remove() {
    if (!initial) return;
    sessions.close(initial.id);
    store.removeServer(initial.id);
    onclose();
  }
</script>

<Modal title={initial ? 'Edit server' : 'Add a server'} {onclose}>
  <form id="connect" onsubmit={saveAndConnect}>
    <label for="c-host">Address</label>
    <div class="row">
      <input id="c-host" bind:value={host} placeholder="mumble.example.com" autocomplete="off" required />
      <input class="port" type="number" bind:value={port} min="1" max="65535" aria-label="Port" />
    </div>
    <label for="c-user">Username</label>
    <input id="c-user" bind:value={username} autocomplete="username" required />
    <label for="c-pass">Password <span class="opt">(optional)</span></label>
    <input id="c-pass" type="password" bind:value={password} autocomplete="current-password" />
    {#if identities.list.length > 1}
      <label for="c-id">Identity</label>
      <select id="c-id" bind:value={identityId}>
        <option value="">Default ({identities.default?.name})</option>
        {#each identities.list as i (i.id)}<option value={i.id}>{i.name}</option>{/each}
      </select>
    {/if}
    <label for="c-label">Label <span class="opt">(optional)</span></label>
    <input id="c-label" bind:value={label} placeholder={host || 'My server'} />
    <label for="c-icon">Icon <span class="opt">(optional)</span></label>
    <div class="icon-row">
      <span class="preview">
        {#if icon}<img src={icon} alt="" />{:else}{(label || host || '?').trim().slice(0, 2).toUpperCase()}{/if}
      </span>
      <button id="c-icon" type="button" class="btn" onclick={() => iconPicker.click()}>{icon ? 'Change image' : 'Choose image'}</button>
      {#if icon}<button type="button" class="btn" onclick={() => (icon = '')}>Remove</button>{/if}
      <input bind:this={iconPicker} type="file" accept="image/*" hidden onchange={pickIcon} />
    </div>
    {#if iconError}<p class="err">{iconError}</p>{/if}
  </form>
  {#snippet footer()}
    {#if initial}<button class="btn danger" onclick={remove}>Remove</button><span style="flex:1"></span>{/if}
    <button class="btn" onclick={onclose}>Cancel</button>
    <button class="btn primary" type="submit" form="connect" disabled={!valid}>Save and connect</button>
  {/snippet}
</Modal>

<style>
  .row { display: flex; gap: 8px; }
  .port { width: 100px; flex: none; }
  .icon-row { display: flex; align-items: center; gap: 8px; }
  .preview { width: 44px; height: 44px; flex: none; display: flex; align-items: center; justify-content: center; background: var(--bg-3); font-weight: 700; overflow: hidden; }
  .preview img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .err { color: var(--danger); font-size: 13px; margin: 6px 0 0; }
  .opt { text-transform: none; font-weight: 400; letter-spacing: 0; color: var(--text-faint); }
</style>
