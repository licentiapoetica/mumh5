import { getData, putData } from './blobstore.ts';
import { bannerImageUrl, bannerMark, cleanColor, type Banner } from '../core/banner.ts';

// Your own banner, for every server. Like the picture it is kept on this device and published in
// your comment when you connect, since guests lose their comment when they leave.
class OwnBanner {
  color = $state('');
  image = $state.raw<Uint8Array | null>(null);
  ready = false;
  readonly loaded: Promise<void>;
  private changed = false;

  constructor() {
    this.loaded = getData<{ color?: string; image?: Uint8Array }>('banner')
      .then(v => {
        if (!v || this.changed) return;
        this.color = cleanColor(v.color ?? '');
        this.image = v.image instanceof Uint8Array ? v.image : null;
      })
      .catch(() => {})
      .finally(() => { this.ready = true; });
  }

  get mark(): string {
    return bannerMark({ color: this.color, image: this.image });
  }

  get imageUrl(): string | null {
    return this.image ? bannerImageUrl(this.image) : null;
  }

  async save(banner: Banner): Promise<void> {
    this.changed = true;
    this.ready = true;
    this.color = cleanColor(banner.color);
    this.image = banner.image;
    await putData('banner', { color: this.color, image: this.image });
  }
}

export const ownBanner = new OwnBanner();
