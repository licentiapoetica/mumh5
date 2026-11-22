export const CHAT_RETENTION_MS = 24 * 60 * 60 * 1000;

export function currentChatMessage(time: number, now = Date.now()): boolean {
  return Number.isFinite(time) && time > now - CHAT_RETENTION_MS;
}
