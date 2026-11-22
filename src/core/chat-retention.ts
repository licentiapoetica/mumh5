export const CHAT_RETENTION_MS = 24 * 60 * 60 * 1000;

export function historyHours(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= 8760 ? value : 24;
}

export function currentChatMessage(time: number, now = Date.now(), retention = CHAT_RETENTION_MS): boolean {
  return Number.isFinite(time) && time > now - retention;
}
