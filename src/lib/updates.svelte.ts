import { checkForUpdate, type UpdateInfo } from '../core/update-check.ts';
import { desktop } from './native.ts';
import { store } from './settings.svelte.ts';
import { load, save } from './storage.ts';

export const build = __MUMH5_BUILD__;

const EVERY = 6 * 3600 * 1000;
const KEY = 'mumh5.updateCheck';

interface Saved {
  at: number;         // when GitHub last answered
  commit: string;     // the build that asked; a new build asks again
  info: UpdateInfo | null;
  dismissed: number;  // the bar stays away until the release has more changes than this
}

// Desktop builds only: the browser build comes from whoever runs the proxy.
// Asks GitHub at start (after a short wait) and every few hours, unless turned off in Settings > About.
class Updates {
  info = $state<UpdateInfo | null>(null);
  checking = $state(false);
  error = $state('');
  lastCheck = $state(0);
  private dismissed = $state(0);
  private started = false;

  readonly possible = !!desktop && !!build.commit;

  get showBar(): boolean {
    return !!this.info?.newer && this.info.changes > this.dismissed && store.settings.updateCheck;
  }

  start(): void {
    if (this.started || !this.possible) return;
    this.started = true;
    const saved = load<Saved>(KEY, { at: 0, commit: '', info: null, dismissed: 0 });
    if (saved.commit === build.commit) {
      this.info = saved.info;
      this.lastCheck = saved.at;
      this.dismissed = saved.dismissed;
    }
    const tick = () => { if (store.settings.updateCheck && Date.now() - this.lastCheck >= EVERY) void this.check(); };
    setTimeout(tick, 5000);
    setInterval(tick, 15 * 60 * 1000);
  }

  async check(): Promise<void> {
    if (!this.possible || this.checking) return;
    this.checking = true;
    this.error = '';
    try {
      this.info = await checkForUpdate(build.repo, build.commit, (url, init) => fetch(url, { ...init, cache: 'no-store' }), AbortSignal.timeout(15000));
      this.lastCheck = Date.now();
      this.persist();
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    } finally {
      this.checking = false;
    }
  }

  dismiss(): void {
    this.dismissed = this.info?.changes ?? 0;
    this.persist();
  }

  private persist(): void {
    save(KEY, { at: this.lastCheck, commit: build.commit, info: $state.snapshot(this.info), dismissed: this.dismissed } satisfies Saved);
  }
}

export const updates = new Updates();
