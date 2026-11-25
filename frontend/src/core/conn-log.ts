// The connection log: short lines about why connections ended and what the page and network did
// around it, kept so a drop on a phone can be explained afterwards. No addresses or names of
// people; the server is named by its label only.
export interface LogEntry { at: number; text: string }

export const LOG_LIMIT = 100;

// Appends, dropping the oldest lines beyond the limit
export function appendLog(list: LogEntry[], entry: LogEntry, limit = LOG_LIMIT): LogEntry[] {
  const next = [...list, entry];
  return next.length > limit ? next.slice(next.length - limit) : next;
}

const two = (n: number) => String(n).padStart(2, '0');

export function formatTime(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
}

// Text to copy into a bug report, oldest line first
export function formatLog(list: LogEntry[], header: string[] = []): string {
  return [...header, ...list.map(e => `${formatTime(e.at)}  ${e.text}`)].join('\n');
}
