import { getBlob, putBlob, deleteBlob } from './blobstore.ts';

const KEY = 'appearance.background';
export const BACKGROUND_TYPES = 'image/png,image/jpeg,image/webp,image/gif,image/avif';
const MAX_BYTES = 20 * 1024 * 1024;

// Keep the file out of localStorage, and only expose an object URL after storage succeeds.
class BackgroundImage {
  url = $state<string | null>(null);
  name = $state('');
  busy = $state(true);
  error = $state('');
  readonly ready: Promise<void>;

  constructor() {
    this.ready = getBlob(KEY).then(blob => {
      if (blob) this.apply(blob);
    }).catch(() => {
      this.error = 'Could not load the saved background image.';
    }).finally(() => { this.busy = false; });
  }

  async import(file: File): Promise<boolean> {
    if (this.busy) return false;
    this.error = '';
    if (!BACKGROUND_TYPES.split(',').includes(file.type)) {
      this.error = 'Choose a PNG, JPEG, WebP, GIF or AVIF image.';
      return false;
    }
    if (file.size > MAX_BYTES) {
      this.error = 'Choose an image smaller than 20 MB.';
      return false;
    }
    this.busy = true;
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      await putBlob(KEY, file);
      this.apply(file);
      return true;
    } catch {
      this.error = 'Could not read or save this image. Try another image or free some device storage.';
      return false;
    } finally {
      URL.revokeObjectURL(url);
      this.busy = false;
    }
  }

  async remove(): Promise<boolean> {
    if (this.busy) return false;
    this.error = '';
    this.busy = true;
    try {
      await deleteBlob(KEY);
      this.apply(null);
      return true;
    } catch {
      this.error = 'Could not remove the saved background image.';
      return false;
    } finally {
      this.busy = false;
    }
  }

  private apply(blob: Blob | null) {
    const previous = this.url;
    this.url = blob ? URL.createObjectURL(blob) : null;
    this.name = blob instanceof File ? blob.name : blob ? 'Saved image' : '';
    if (previous) URL.revokeObjectURL(previous);
  }
}

export const backgroundImage = new BackgroundImage();
