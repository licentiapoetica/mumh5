import { native, type IdentitySummary } from './native.ts';

// Client certificates kept by the desktop app's main process
class Identities {
  list = $state<IdentitySummary[]>([]);
  setupDone = $state(true);
  loaded = $state(false);
  // A damaged profile that was set aside: shown until an identity exists again
  damaged = $state<string[]>([]);
  directory = $state('');

  async refresh(): Promise<void> {
    if (!native) return;
    const r = await native.identities.list();
    this.list = r.identities;
    this.setupDone = r.setupDone;
    this.damaged = r.damaged ?? [];
    this.directory = r.directory ?? '';
    this.loaded = true;
  }

  get default(): IdentitySummary | undefined {
    return this.list.find(i => i.isDefault) ?? this.list[0];
  }

  byId(id: string | undefined): IdentitySummary | undefined {
    return this.list.find(i => i.id === id) ?? this.default;
  }
}

export const identities = new Identities();
identities.refresh();
