import { homedir } from 'node:os';
import path from 'node:path';
import { HeadlessClient } from '../index.ts';
import { handleChatCommand } from './chat-commands.ts';

async function main() {
  const host = process.env.MUMBLE_HOST;
  if (!host) throw new Error('Set MUMBLE_HOST to your Mumble server address');
  const port = Number(process.env.MUMBLE_PORT || 64738);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('MUMBLE_PORT must be 1..65535');

  const ids = (process.env.MUMBLE_ADMIN_USER_IDS || '').split(',').map(value => value.trim()).filter(Boolean);
  if (ids.some(id => !/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)))) throw new Error('MUMBLE_ADMIN_USER_IDS must be comma-separated nonnegative registered user IDs');
  const adminUserIds = new Set(ids.map(Number));
  const bot = await HeadlessClient.connect({
    host, port, name: process.env.MUMBLE_NAME || 'helper-bot',
    stateDir: process.env.MUMBLE_STATE_DIR || path.join(homedir(), '.config', 'mumh5-bots', 'helper-bot'),
    channel: process.env.MUMBLE_CHANNEL || undefined,
    password: process.env.MUMBLE_PASSWORD,
    trustNew: process.env.MUMBLE_TRUST_NEW === '1',
    serverFingerprint: process.env.MUMBLE_SERVER_FINGERPRINT
  });

  let stopping = false, pending = false;
  async function stop() {
    if (stopping) return;
    stopping = true;
    await bot.close();
  }
  const report = error => console.error(error.message);
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => { void stop().catch(report); });
  }
  bot.on('warning', message => console.error('Server warning:', message));
  bot.on('mediaError', error => console.error('Media error:', error.message));
  bot.once('close', reason => {
    if (stopping) return;
    console.error('Disconnected:', reason);
    process.exitCode = 1;
    void stop().catch(report);
  });

  bot.on('text', message => {
    if (stopping || pending || message.self || message.actor == null || !/^!(help|ping|status|whoami|join|mute|deaf|shutdown)(?:\s|$)/.test(message.html.trim())) return;
    // Serialize commands and leave room for Mumble's outgoing message rate limit.
    pending = true;
    void handleChatCommand(bot, message, { adminUserIds, shutdown: stop }).catch(report).finally(() => {
      const timer = setTimeout(() => { pending = false; }, 1500); timer.unref();
    });
  });

  console.log(JSON.stringify({ event: 'ready', name: bot.protocol.self?.name, session: bot.protocol.session }));
}

void main().catch(error => { console.error(error.message); process.exitCode = 1; });
