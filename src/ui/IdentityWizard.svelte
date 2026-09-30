<script lang="ts">
  import Modal from './Modal.svelte';
  import Icon from './Icon.svelte';
  import { native, type IdentitySummary } from '../lib/native.ts';
  import { identities } from '../lib/identities.svelte.ts';

  // setup: first start (marks setup as done at the end); add: adding another identity from Settings
  let { mode = 'setup', onclose }: { mode?: 'setup' | 'add'; onclose: () => void } = $props();

  type Step = 'welcome' | 'create' | 'import' | 'backup' | 'done';
  let step = $state<Step>('welcome');
  let busy = $state(false);
  let error = $state('');
  let result = $state<IdentitySummary | null>(null);
  let mumble = $state<{ name: string } | null>(null);

  // create
  let name = $state('');
  let email = $state('');
  // import
  let file = $state<File | null>(null);
  let filePassword = $state('');
  // backup
  let backupPassword = $state('');
  let backupConfirm = $state('');
  let savedTo = $state('');

  // svelte-ignore state_referenced_locally
  const existing = mode === 'setup' ? identities.default : undefined;

  native?.identities.findMumble().then(m => (mumble = m));

  async function run(task: () => Promise<IdentitySummary>, next: Step) {
    busy = true;
    error = '';
    try {
      result = await task();
      await identities.refresh();
      step = next;
    } catch (e) {
      error = (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
    } finally {
      busy = false;
    }
  }

  const create = (e: SubmitEvent) => {
    e.preventDefault();
    run(() => native!.identities.create(name.trim(), email.trim()), 'backup');
  };

  const importFile = async (e: SubmitEvent) => {
    e.preventDefault();
    if (!file) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    run(() => native!.identities.importP12(bytes, filePassword, ''), 'done');
  };

  const importMumble = () => run(() => native!.identities.importMumble(''), 'done');

  function keepExisting() {
    result = existing ?? null;
    step = 'backup';
  }

  async function saveBackup() {
    if (!result) return;
    busy = true;
    error = '';
    try {
      const path = await native!.identities.exportP12(result.id, backupPassword);
      if (path) {
        savedTo = path;
        step = 'done';
      }
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
    }
  }

  async function finish() {
    if (mode === 'setup') await native?.identities.finishSetup();
    await identities.refresh();
    onclose();
  }

  const title = $derived(mode === 'setup' ? 'Set up your identity' : 'Add an identity');
  const passwordsOk = $derived(backupPassword.length >= 8 && backupPassword === backupConfirm);
</script>

<Modal {title} onclose={mode === 'setup' ? () => {} : onclose} width={560}>
  {#if step === 'welcome'}
    <p>Mumble recognizes you by a <strong>certificate</strong>, not by a password. Registered names, admin rights and friends lists on servers are tied to it, so it is worth setting up once and keeping a backup.</p>
    <div class="choices">
      <button class="choice" onclick={() => (step = 'create')}>
        <Icon name="plus" /><span><strong>Create a new identity</strong><small>Start fresh with a new certificate</small></span>
      </button>
      {#if mumble}
        <button class="choice" disabled={busy} onclick={importMumble}>
          <Icon name="download" /><span><strong>Use my Mumble desktop identity</strong><small>Found "{mumble.name}" from the desktop client; keeps your registrations</small></span>
        </button>
      {/if}
      <button class="choice" onclick={() => (step = 'import')}>
        <Icon name="file" /><span><strong>Import a certificate file</strong><small>A .p12 or .pfx backup, for example exported from Mumble</small></span>
      </button>
      {#if existing}
        <button class="choice" onclick={keepExisting}>
          <Icon name="shield" /><span><strong>Keep the current identity</strong><small>"{existing.name}", created automatically earlier</small></span>
        </button>
      {/if}
    </div>
  {:else if step === 'create'}
    <form id="w-create" onsubmit={create}>
      <p>The name is stored in the certificate and helps you tell identities apart. Servers show the username you enter when connecting, not this.</p>
      <label for="w-name">Name</label>
      <!-- svelte-ignore a11y_autofocus -->
      <input id="w-name" bind:value={name} required autofocus placeholder="e.g. kibi" />
      <label for="w-email">Email <span class="opt">(optional, stored in the certificate)</span></label>
      <input id="w-email" type="email" bind:value={email} />
    </form>
  {:else if step === 'import'}
    <form id="w-import" onsubmit={importFile}>
      <label for="w-file">Certificate file</label>
      <input id="w-file" type="file" accept=".p12,.pfx,application/x-pkcs12" onchange={e => (file = (e.currentTarget as HTMLInputElement).files?.[0] ?? null)} />
      <label for="w-fpass">Password <span class="opt">(leave empty if it has none)</span></label>
      <input id="w-fpass" type="password" bind:value={filePassword} autocomplete="off" />
    </form>
  {:else if step === 'backup' && result}
    <p>Identity <strong>{result.name}</strong> is ready.</p>
    <p class="mono">{result.fingerprint}</p>
    <p>If this computer dies, the certificate goes with it, and so do your registrations. Save a password-protected backup now; the desktop Mumble client can import it too.</p>
    <label for="w-bpass">Backup password <span class="opt">(at least 8 characters)</span></label>
    <input id="w-bpass" type="password" bind:value={backupPassword} autocomplete="new-password" />
    <label for="w-bconf">Repeat password</label>
    <input id="w-bconf" type="password" bind:value={backupConfirm} autocomplete="new-password" />
  {:else if step === 'done'}
    <p>You are set up{result ? ` as ${result.name}` : ''}.</p>
    {#if result}<p class="mono">{result.fingerprint}</p>{/if}
    {#if savedTo}<p class="ok">Backup saved to {savedTo}</p>{/if}
    <p class="dim">Manage identities, pick one per server and export backups in Settings.</p>
  {/if}

  {#if error}<p class="error">{error}</p>{/if}

  {#snippet footer()}
    {#if step === 'welcome'}
      {#if mode === 'add'}<button class="btn" onclick={onclose}>Cancel</button>{/if}
    {:else if step === 'create'}
      <button class="btn" onclick={() => (step = 'welcome')}>Back</button>
      <button class="btn primary" type="submit" form="w-create" disabled={busy || !name.trim()}>{busy ? 'Generating...' : 'Create'}</button>
    {:else if step === 'import'}
      <button class="btn" onclick={() => (step = 'welcome')}>Back</button>
      <button class="btn primary" type="submit" form="w-import" disabled={busy || !file}>Import</button>
    {:else if step === 'backup'}
      <button class="btn" onclick={() => (step = 'done')}>Skip for now</button>
      <button class="btn primary" disabled={busy || !passwordsOk} onclick={saveBackup}>Save backup...</button>
    {:else}
      <button class="btn primary" onclick={finish}>Done</button>
    {/if}
  {/snippet}
</Modal>

<style>
  p { color: var(--text-dim); margin: 10px 0 0; }
  p strong { color: var(--text); }
  .choices { display: flex; flex-direction: column; gap: 8px; margin-top: 16px; }
  .choice { display: flex; align-items: center; gap: 14px; padding: 12px 14px; text-align: left; background: var(--bg-3); border: 1px solid var(--line); }
  .choice:hover:not(:disabled) { border-color: var(--accent); background: var(--bg-hover); }
  .choice span { display: flex; flex-direction: column; }
  .choice small { color: var(--text-dim); font-size: 13px; }
  .opt { text-transform: none; font-weight: 400; letter-spacing: 0; color: var(--text-faint); }
  .mono { font: 12px var(--mono); overflow-wrap: anywhere; color: var(--text); }
  .ok { color: var(--speaking); overflow-wrap: anywhere; }
  .dim { font-size: 13px; }
  .error { color: var(--danger); }
</style>
