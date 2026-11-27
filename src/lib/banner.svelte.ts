import { getData, putData } from './blobstore.ts';
import { bannerImageUrl, bannerMark, cleanColor, type Banner } from '../core/banner.ts';
import type { BannerCrop } from './images.ts';

interface Kept { color?: string; image?: Uint8Array; source?: Blob; crop?: BannerCrop }

// The picture as chosen and where it sits in the frame, so it can be moved again later
export interface BannerSource { blob: Blob; crop: BannerCrop }

// Your own banner, for every server. Like the picture it is kept on this device and published in
// your comment when you connect, since guests lose their comment when they leave.
class OwnBanner {
  color = $state('');
  image = $state.raw<Uint8Array | null>(null);
  source = $state.raw<BannerSource | null>(null);
  ready = false;
  readonly loaded: Promise<void>;
  private changed = false;

  constructor() {
    this.loaded = getData<Kept>('banner')
      .then(v => {
        if (!v || this.changed) return;
        this.color = cleanColor(v.color ?? '');
        this.image = v.image instanceof Uint8Array ? v.image : null;
        this.source = this.image && v.source instanceof Blob && v.crop ? { blob: v.source, crop: v.crop } : null;
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

  // source: undefined keeps the one there is, as long as there is still a picture
  async save(banner: Banner, source?: BannerSource | null): Promise<void> {
    this.changed = true;
    this.ready = true;
    this.color = cleanColor(banner.color);
    this.image = banner.image;
    if (!banner.image) this.source = null;
    else if (source !== undefined) this.source = source;
    const kept: Kept = { color: this.color, image: this.image ?? undefined };
    if (this.source) { kept.source = this.source.blob; kept.crop = { ...this.source.crop }; }
    await putData('banner', kept);
  }
}

export const ownBanner = new OwnBanner();
