import type { HeadlessClient, HeadlessText } from '../index.ts';

export interface CommandOptions { adminUserIds: ReadonlySet<number>; shutdown(): Promise<void> }

// Replies are private, including when the command was sent in a channel.
export async function handleChatCommand(bot: HeadlessClient, message: HeadlessText, options: CommandOptions): Promise<void> {
  if (message.self || message.actor == null) return;
  const match = /^!(help|ping|status|whoami|join|mute|deaf|shutdown)(?:\s+([\s\S]*))?$/.exec(message.html.trim());
  if (!match) return;
  const [, command, rest = ''] = match, argument = rest.trim();
  const reply = (text: string) => bot.sendText(text, { user: message.actor! });
  const userId = bot.protocol.users.get(message.actor)?.userId;
  const admin = userId != null && options.adminUserIds.has(userId);
  if (['join', 'mute', 'deaf', 'shutdown'].includes(command) && !admin) {
    await reply('This command requires an allowlisted registered user ID. Use !whoami to find yours.'); return;
  }
  try {
    switch (command) {
      case 'help':
        await reply('Commands: !help, !ping, !status, !whoami. Admin: !join /Channel, !mute on|off, !deaf on|off, !shutdown.'); break;
      case 'ping': await reply('pong'); break;
      case 'whoami':
        await reply(`Your session ID: ${message.actor}. Registered user ID: ${userId ?? 'none (register your user on this server first)'}.`); break;
      case 'status':
        await reply(`Connected as ${bot.protocol.self?.name}; channel ${bot.channelPath(bot.protocol.self?.channelId ?? 0)}; ${bot.protocol.users.size} users; audio ${bot.audio ? 'enabled' : 'disabled'}.`); break;
      case 'join':
        if (!argument) throw new Error('Usage: !join /Channel');
        await bot.join(argument); await reply(`Joined ${argument}.`); break;
      case 'mute': case 'deaf':
        if (argument !== 'on' && argument !== 'off') throw new Error(`Usage: !${command} on|off`);
        if (command === 'mute') bot.protocol.setSelfMute(argument === 'on');
        else bot.protocol.setSelfDeaf(argument === 'on');
        await bot.protocol.flushed(); await reply(`${command} ${argument} submitted.`); break;
      case 'shutdown': await reply('Shutting down.'); await options.shutdown(); break;
    }
  } catch (error) { await reply(`Command failed: ${(error as Error).message}`); }
}
