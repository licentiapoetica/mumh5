import { checkDeployed, checkForUpdate, WEB_VERSION_FILE, type UpdateInfo } from '../core/update-check.ts';
import { desktop, isWeb } from './native.ts';
import { store } from './settings.svelte.ts';
import { load, save } from './storage.ts';

export const build = __MUMH5_BUILD__;

// The build this page runs (web build only; written into index.html by vite.config.ts)
const webBuild = isWeb ? document.querySelector<HTMLMetaElement>('meta[name="mumh5-build"]')?.content ?? '' : '';

// Desktop asks GitHub, so rarely; the browser build asks its own site, which costs nothing
const EVERY = isWeb ? 10 * 60 * 1000 : 6 * 3600 * 1000;
const KEY = 'mumh5.updateCheck';

interface Saved {
  at: number;         // when GitHub last answered
  commit: string;     // the build that asked; a new build asks again
  info: UpdateInfo | null;
  dismissed: number;  // the bar stays away until the release has more changes than this
}

// Desktop: whether GitHub has a newer release (Download). Browser: whether the site now serves
// another build than this page runs (Reload). Asks at start (after a short wait), now and then
// and when the window comes back, unless turned off in Settings > About.
// The browser state lives only as long as the page: a reload loads what the site serves.
class Updates {
  info = $state<UpdateInfo | null>(null);
  checking = $state(false);
  error = $state('');
  lastCheck = $state(0);
  private dismissed = $state(0);
  private dismissedBuild = $state('');
  private started = false;

  readonly web = isWeb;
  readonly possible = desktop ? !!build.commit : /^[0-9a-f]{6,64}$/.test(webBuild);

  get showBar(): boolean {
    if (!this.info?.newer || !store.settings.updateCheck) return false;
    return this.web ? this.info.build !== this.dismissedBuild : this.info.changes > this.dismissed;
  }

  start(): void {
    if (this.started || !this.possible) return;
    this.started = true;
    if (!this.web) {
      const saved = load<Saved>(KEY, { at: 0, commit: '', info: null, dismissed: 0 });
      if (saved.commit === build.commit) {
        this.info = saved.info;
        this.lastCheck = saved.at;
        this.dismissed = saved.dismissed;
      }
    }
    const tick = () => { if (store.settings.updateCheck && Date.now() - this.lastCheck >= EVERY) void this.check(); };
    setTimeout(tick, 5000);
    setInterval(tick, 15 * 60 * 1000);
    // Timers are held back in background tabs and on sleeping phones
    document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
  }

  async check(): Promise<void> {
    if (!this.possible || this.checking) return;
    this.checking = true;
    this.error = '';
    try {
      const get = (url: string, init?: RequestInit) => fetch(url, { ...init, cache: 'no-store' });
      const signal = AbortSignal.timeout(15000);
      this.info = this.web
        ? await checkDeployed(new URL(WEB_VERSION_FILE, document.baseURI).href, webBuild, get, signal)
        : await checkForUpdate(build.repo, build.commit, get, signal);
      this.lastCheck = Date.now();
      this.persist();
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    } finally {
      this.checking = false;
    }
  }

  dismiss(): void {
    if (this.web) this.dismissedBuild = this.info?.build ?? '';
    else this.dismissed = this.info?.changes ?? 0;
    this.persist();
  }

  // Browser: the page loads again, from the site (the service worker goes to the network first)
  reload(): void {
    location.reload();
  }

  private persist(): void {
    if (this.web) return;
    save(KEY, { at: this.lastCheck, commit: build.commit, info: $state.snapshot(this.info), dismissed: this.dismissed } satisfies Saved);
  }
}

export const updates = new Updates();
