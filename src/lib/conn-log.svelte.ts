import { appendLog, formatLog, type LogEntry } from '../core/conn-log.ts';
import { loadList, save } from './storage.ts';

const KEY = 'mumh5.connLog';

// Kept in this browser (never sent anywhere) so it survives the reload that follows a drop
class ConnectionLog {
  entries = $state<LogEntry[]>(loadList<LogEntry>(KEY).filter(e => typeof e?.at === 'number' && typeof e.text === 'string'));
  private started = false;

  get hidden(): boolean { return typeof document !== 'undefined' && document.hidden; }

  add(text: string): void {
    this.entries = appendLog(this.entries, { at: Date.now(), text });
    save(KEY, $state.snapshot(this.entries));
  }

  clear(): void {
    this.entries = [];
    save(KEY, []);
  }

  text(header: string[]): string {
    return formatLog($state.snapshot(this.entries), header);
  }

  // What the page and the network do, in the same list as the connections
  start(): void {
    if (this.started || typeof document === 'undefined') return;
    this.started = true;
    this.add('page opened');
    document.addEventListener('visibilitychange', () => this.add(document.hidden ? 'page hidden' : 'page visible'));
    window.addEventListener('online', () => this.add('network online'));
    window.addEventListener('offline', () => this.add('network offline'));
    window.addEventListener('pagehide', e => this.add(e.persisted ? 'page frozen' : 'page closing'));
    window.addEventListener('pageshow', e => { if (e.persisted) this.add('page restored'); });
    (document as Document & { addEventListener(t: 'freeze' | 'resume', fn: () => void): void }).addEventListener('freeze', () => this.add('page frozen by the browser'));
    (document as Document & { addEventListener(t: 'freeze' | 'resume', fn: () => void): void }).addEventListener('resume', () => this.add('page resumed'));
  }
}

export const connLog = new ConnectionLog();
