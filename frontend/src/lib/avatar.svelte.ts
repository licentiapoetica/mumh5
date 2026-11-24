import { getBlob, putBlob, deleteBlob } from './blobstore.ts';

// Your own picture. Servers keep pictures only for registered users and do not send yours back
// to you, so it is kept on this device and sent to each server when you connect.
class OwnAvatar {
  bytes = $state.raw<Uint8Array | null>(null);
  url = $state<string | null>(null);
  readonly loaded: Promise<void>;

  constructor() {
    this.loaded = getBlob('avatar')
      .then(async b => { if (b && !this.bytes) this.apply(new Uint8Array(await b.arrayBuffer())); })
      .catch(() => {});
  }

  async save(bytes: Uint8Array | null): Promise<void> {
    if (bytes) await putBlob('avatar', new Blob([bytes as BlobPart]));
    else await deleteBlob('avatar');
    this.apply(bytes);
  }

  private apply(bytes: Uint8Array | null): void {
    if (this.url) URL.revokeObjectURL(this.url);
    this.bytes = bytes;
    this.url = bytes ? URL.createObjectURL(new Blob([bytes as BlobPart])) : null;
  }
}

export const ownAvatar = new OwnAvatar();
