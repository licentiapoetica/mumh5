export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export interface DebugEntry { id: number; time: string; level: LogLevel; area: string; message: string; details: Record<string, string | number | boolean | null> }
/** Diagnostic events only: never pass authentication payloads, keys or chat messages. */
export class DebugLog {
  private entries: DebugEntry[] = [];
  private listeners = new Set<() => void>();
  private next = 1;
  constructor(readonly limit = 1000) {}
  record(level: LogLevel, area: string, message: string, details: DebugEntry['details'] = {}): void {
    this.entries.push({ id: this.next++, time: new Date().toISOString(), level, area, message: message.slice(0, 1000), details });
    if (this.entries.length > this.limit) this.entries.splice(0, this.entries.length - this.limit);
    for (const fn of this.listeners) fn();
  }
  snapshot(): readonly DebugEntry[] { return this.entries.slice(); }
  subscribe(fn: () => void): () => void { this.listeners.add(fn); fn(); return () => { this.listeners.delete(fn); }; }
  clear(): void { this.entries = []; for (const fn of this.listeners) fn(); }
  export(entries = this.snapshot()): string { return ['Dream Cord debug log', ...entries.map(e => `${e.time} ${e.level.toUpperCase()} [${e.area}] ${e.message}${Object.keys(e.details).length ? ' ' + JSON.stringify(e.details) : ''}`)].join('\n') + '\n'; }
}
export const debugLog = new DebugLog();
