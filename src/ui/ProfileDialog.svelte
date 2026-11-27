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
  import { store } from '../lib/settings.svelte.ts';
  import PickColor from './PickColor.svelte';
  import { MAX_BANNER_BYTES, stripProfileMarks } from '../core/banner.ts';
  import { ownBanner } from '../lib/banner.svelte.ts';
  import { makeBanner, type BannerCrop as Crop } from '../lib/images.ts';
  import BannerCrop from './BannerCrop.svelte';

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

  // The banner applies at once, like the picture
  let bannerPicker = $state<HTMLInputElement>();
  let bannerBusy = $state(false);
  let bannerError = $state('');
  // Follows the color picker while it is dragged; saved when it is let go
  let liveColor = $state<string | null>(null);
  const bannerColor = $derived(liveColor ?? ownBanner.color);
  const hue = $derived([...(self?.name ?? '')].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 360);

  async function setBanner(color: string, image: Uint8Array | null) {
    liveColor = null;
    bannerError = '';
    await sessions.setBanner({ color, image });
  }

  // A picture being placed in the frame: a new one, or the kept original moved again
  let placing = $state<{ blob: Blob; crop: Crop } | null>(null);

  function pickBanner() {
    const file = bannerPicker?.files?.[0];
    if (bannerPicker) bannerPicker.value = '';
    if (!file) return;
    bannerError = '';
    placing = { blob: file, crop: { x: 0.5, y: 0.5, zoom: 1 } };
  }

  async function placeBanner(crop: Crop) {
    const blob = placing?.blob;
    if (!blob) return;
    bannerBusy = true;
    bannerError = '';
    try {
      const bytes = await makeBanner(blob, MAX_BANNER_BYTES, crop);
      if (bytes) {
        liveColor = null;
        await sessions.setBanner({ color: ownBanner.color, image: bytes }, { blob, crop });
        placing = null;
      } else bannerError = 'This picture does not get small enough for a banner.';
    } catch {
      bannerError = 'This file could not be read as a picture.';
    }
    bannerBusy = false;
  }

  function unreadable() {
    placing = null;
    bannerError = 'This file could not be read as a picture.';
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
      <Avatar name={store.displayName(self)} size={72} speaking={voice.transmitting} src={session.avatar(self.session)} keep />
      <div class="text">
        <strong>{store.displayName(self)}</strong>
        <span>{store.displayName(self) !== self.name ? `${self.name}, ` : ''}{self.userId != null ? 'registered' : 'guest'} on {session.server?.label}</span>
      </div>
    </div>
    <div class="actions">
      <button class="btn" disabled={busy} onclick={() => picker?.click()}>{busy ? 'Preparing...' : ownAvatar.url ? 'Change picture' : 'Add picture'}</button>
      {#if ownAvatar.url}<button class="btn" disabled={busy} onclick={() => sessions.setAvatar(null)}>Remove picture</button>{/if}
      <button class="btn" disabled={dirty} title={dirty ? 'Save your description first.' : undefined} onclick={changeName}>Change name</button>
      <input bind:this={picker} type="file" accept="image/*" hidden aria-label="Picture file" onchange={pickPicture} />
    </div>
    {#if error}<p class="error">{error}</p>{/if}

    <h3>Banner</h3>
    {#if placing}
      {#key placing}
        <BannerCrop blob={placing.blob} crop={placing.crop} busy={bannerBusy} onsave={placeBanner} oncancel={() => (placing = null)} onerror={unreadable} />
      {/key}
    {:else}
    <div class="banner" style:background={bannerColor || `hsl(${hue} 38% 30%)`}>
      {#if ownBanner.imageUrl}<img src={ownBanner.imageUrl} alt="" />{/if}
    </div>
    <div class="actions" title={session.canChooseName ? undefined : 'This server does not allow the formatting the banner travels in.'}>
      <label class="color">
        <input type="color" aria-label="Banner color" disabled={!session.canChooseName} value={bannerColor || '#3b4252'}
          oninput={e => (liveColor = e.currentTarget.value)} onchange={e => setBanner(e.currentTarget.value, ownBanner.image)} />
        <span>Color</span>
      </label>
      <PickColor label="Pick the banner color from the screen" size={16} disabled={!session.canChooseName} onpick={c => setBanner(c, ownBanner.image)} />
      <button class="btn" disabled={bannerBusy || !session.canChooseName} onclick={() => bannerPicker?.click()}
        title="Shown 5:1; you choose the part after picking it">{bannerBusy ? 'Preparing...' : ownBanner.image ? 'Change banner picture' : 'Add banner picture'}</button>
      {#if ownBanner.source}<button class="btn" disabled={bannerBusy} onclick={() => (placing = { ...ownBanner.source! })}>Move banner picture</button>{/if}
      {#if ownBanner.image}<button class="btn" disabled={bannerBusy} onclick={() => setBanner(ownBanner.color, null)}>Remove banner picture</button>{/if}
      {#if ownBanner.color || ownBanner.image}<button class="btn" disabled={bannerBusy} onclick={() => setBanner('', null)}>Reset banner</button>{/if}
    </div>
    {/if}
    <input bind:this={bannerPicker} type="file" accept="image/*" hidden aria-label="Banner picture file" onchange={pickBanner} />
    {#if bannerError}<p class="error">{bannerError}</p>{/if}
    <p class="hint">Other mumh5 users see your banner on your profile. Other Mumble clients do not show it.</p>

    <h3>Description</h3>
    {#if ready}
      <RichEditor value={stripProfileMarks(self.comment ?? '')} limit={session.htmlLimit > 0 ? Math.max(1, session.htmlLimit - ownBanner.mark.length) : 0} placeholder="Tell people about yourself"
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
  .banner { height: 64px; margin-top: 4px; border: 1px solid var(--line); }
  .banner img { display: block; width: 100%; height: 100%; object-fit: cover; }
  .color { display: inline-flex; align-items: center; gap: 6px; font-size: 14px; }
  .color input { width: 34px; height: var(--control-h); padding: 2px; }
  .actions { align-items: center; }
  .hint { margin: 8px 0 0; font-size: 12px; color: var(--text-faint); }
  .error { margin: 10px 0 0; font-size: 13px; color: var(--danger); }
  .ask { flex: 1; align-self: center; min-width: 0; font-size: 14px; color: var(--text-dim); }
</style>
