<script lang="ts">
  import { native, isWeb, type IdentitySummary } from '../lib/native.ts';
  import { identities } from '../lib/identities.svelte.ts';
  import { store } from '../lib/settings.svelte.ts';
  import { ui } from '../lib/ui.svelte.ts';

  let message = $state('');

  const usedBy = (id: string) => store.servers.filter(s => s.identityId === id).map(s => s.label);

  async function act(task: () => Promise<unknown>) {
    message = '';
    try {
      await task();
      await identities.refresh();
    } catch (e) {
      message = (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
    }
  }

  function exportId(i: IdentitySummary) {
    ui.prompt = {
      title: `Back up ${i.name}`, label: 'Password for the backup file', confirm: isWeb ? 'Download' : 'Choose location...', input: 'password',
      text: 'The .p12 file contains your private key. Protect it with a password; the desktop Mumble client can import it.',
      onsubmit: pw => act(async () => {
        const path = await native!.identities.exportP12(i.id, pw);
        if (path) message = `Saved to ${path}`;
      })
    };
  }

  function rename(i: IdentitySummary) {
    ui.prompt = { title: 'Rename identity', label: 'Name', confirm: 'Rename', initial: i.name, onsubmit: n => act(() => native!.identities.rename(i.id, n)) };
  }

  function remove(i: IdentitySummary) {
    const servers = usedBy(i.id);
    ui.prompt = {
      title: `Delete ${i.name}?`, label: '', confirm: 'Delete', danger: true, input: 'none',
      text: `Registrations on servers are tied to this certificate and cannot be recovered without a backup.${servers.length ? ` Used by: ${servers.join(', ')}; they will use the default identity instead.` : ''}`,
      onsubmit: () => act(() => native!.identities.remove(i.id))
    };
  }
</script>

<ul class="ids">
  {#each identities.list as i (i.id)}
    <li class:default={i.isDefault}>
      <div class="head">
        <strong>{i.name}</strong>
        {#if i.isDefault}<span class="tag">default</span>{/if}
      </div>
      <code>{i.fingerprint}</code>
      {#if usedBy(i.id).length}<p class="help">Used for {usedBy(i.id).join(', ')}</p>{/if}
      <div class="actions">
        {#if !i.isDefault}<button class="link" onclick={() => act(() => native!.identities.setDefault(i.id))}>Make default</button>{/if}
        <button class="link" onclick={() => (ui.cert = { title: `Certificate: ${i.name}`, chain: [i.cert] })}>View certificate</button>
        <button class="link" onclick={() => exportId(i)}>Back up</button>
        <button class="link" onclick={() => rename(i)}>Rename</button>
        <button class="link danger" onclick={() => remove(i)}>Delete</button>
      </div>
    </li>
  {:else}
    <li class="help">No identity yet; one is created when you first connect.</li>
  {/each}
</ul>
<button class="btn" onclick={() => (ui.wizard = 'add')}>Add identity</button>
{#if message}<p class="help msg">{message}</p>{/if}

<style>
  .ids { list-style: none; margin: 8px 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  li { padding: 10px 12px; background: var(--bg-0); border: 1px solid var(--line); }
  li.default { border-color: var(--accent); }
  .head { display: flex; align-items: center; gap: 8px; }
  .tag { font-size: 11px; font-weight: 600; padding: 0 6px; background: var(--accent); color: var(--accent-text); }
  code { display: block; margin-top: 4px; font: 11px var(--mono); color: var(--text-dim); overflow-wrap: anywhere; }
  .actions { display: flex; flex-wrap: wrap; gap: 4px 14px; margin-top: 8px; }
  .link { color: var(--link); font-size: 13px; }
  .link:hover { text-decoration: underline; }
  .link.danger { color: var(--danger); }
  .help { margin: 4px 0 0; font-size: 13px; color: var(--text-dim); }
  .msg { overflow-wrap: anywhere; }
</style>
