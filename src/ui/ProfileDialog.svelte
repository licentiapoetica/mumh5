<script lang="ts">
  import { onDestroy } from 'svelte';
  import Modal from './Modal.svelte';
  import Avatar from './Avatar.svelte';
  import RichEditor from './RichEditor.svelte';
  import { session, sessions } from '../lib/session.svelte.ts';
  import { ui } from '../lib/ui.svelte.ts';
  import { voice } from '../lib/audio/voice.svelte.ts';
  import { ownAvatar } from '../lib/avatar.svelte.ts';
  import { changeNamePrompt, setPictureFromFile } from '../lib/actions.ts';

  const self = $derived(session.self);

  // A long description arrives later; the editor waits, or saving would overwrite it with nothing
  $effect(() => { if (self?.commentHash && !self.comment) session.loadComment(self.session); });
  let ready = $state(false);
  $effect(() => { if (self && (!self.commentHash || self.comment)) ready = true; });

  // The editor reports its normalized text first; that is what counts as unchanged
  let original = $state<string | null>(null);
  let draft = $state('');
  const dirty = $derived(original !== null && draft !== original);
  let discard = $state(false);

  // Also when the connection ends, so it does not come back by itself after a reconnect
  onDestroy(() => { ui.profileEdit = false; });
  const close = () => { ui.profileEdit = false; };

  function tryClose() {
    // Escape belongs to a dialog opened from here (Insert link)
    if (ui.prompt) return;
    if (dirty && !discard) discard = true;
    else close();
  }

  function save() {
    if (dirty) session.setComment(draft);
    close();
  }

  let picker = $state<HTMLInputElement>();
  let busy = $state(false);
  let error = $state('');
  async function pickPicture() {
    const file = picker?.files?.[0];
    if (picker) picker.value = '';
    if (!file) return;
    busy = true;
    error = (await setPictureFromFile(file)) ?? '';
    busy = false;
  }

  function changeName() {
    const u = self;
    if (!u) return;
    close();
    changeNamePrompt(u);
  }
</script>

<Modal title="Edit profile" onclose={tryClose} width={620}>
  {#if self}
    <div class="who">
      <Avatar name={self.name} size={72} speaking={voice.transmitting} src={session.avatar(self.session)} keep />
      <div class="text">
        <strong>{self.name}</strong>
        <span>{self.userId != null ? 'Registered' : 'Guest'} on {session.server?.label}</span>
      </div>
    </div>
    <div class="actions">
      <button class="btn" disabled={busy} onclick={() => picker?.click()}>{busy ? 'Preparing...' : ownAvatar.url ? 'Change picture' : 'Add picture'}</button>
      {#if ownAvatar.url}<button class="btn" disabled={busy} onclick={() => sessions.setAvatar(null)}>Remove picture</button>{/if}
      <button class="btn" disabled={dirty} title={dirty ? 'Changing your name reconnects. Save your description first.' : undefined} onclick={changeName}>Change name</button>
      <input bind:this={picker} type="file" accept="image/*" hidden aria-label="Picture file" onchange={pickPicture} />
    </div>
    {#if error}<p class="error">{error}</p>{/if}

    <h3>Description</h3>
    {#if ready}
      <RichEditor value={self.comment ?? ''} limit={session.htmlLimit} placeholder="Tell people about yourself"
        onchange={h => { original ??= h; draft = h; discard = false; }} />
    {:else}
      <p class="dim">Loading description...</p>
    {/if}
  {/if}

  {#snippet footer()}
    {#if discard}
      <span class="ask">Discard your changes?</span>
      <button class="btn" onclick={() => (discard = false)}>Keep editing</button>
      <button class="btn danger" onclick={close}>Discard</button>
    {:else}
      <button class="btn" onclick={tryClose}>Cancel</button>
      <button class="btn primary" disabled={!ready} onclick={save}>Save</button>
    {/if}
  {/snippet}
</Modal>

<style>
  .who { display: flex; align-items: center; gap: 14px; margin-top: 8px; }
  .text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  strong { font-size: 18px; font-weight: 650; overflow-wrap: anywhere; }
  .text span { font-size: 13px; color: var(--text-dim); overflow-wrap: anywhere; }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
  h3 { margin: 22px 0 8px; font-size: 15px; font-weight: 650; }
  .dim { margin: 0; color: var(--text-dim); }
  .error { margin: 10px 0 0; font-size: 13px; color: var(--danger); }
  .ask { flex: 1; align-self: center; min-width: 0; font-size: 14px; color: var(--text-dim); }
</style>
