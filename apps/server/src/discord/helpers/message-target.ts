import { ErrorCode } from '@sab/shared';
import type { Message } from 'discord.js';
import { ServiceError } from '../../common/errors/service-error.js';
import type { MessageResolver } from '../services/message-resolver.service.js';

type MessageLocation = { readonly channelId: string; readonly messageId: string };

/**
 * The message an id pair names, or the `ServiceError` a caller turns into a
 * sentence. The resolver is the one place that knows which Discord answers
 * mean "gone" and which mean "not allowed".
 */
export async function requireMessage(
  resolver: MessageResolver,
  location: MessageLocation,
): Promise<Message> {
  const found = await resolver.fetch(`${location.channelId}/${location.messageId}`);
  switch (found.status) {
    case 'OK':
      return found.message;
    case 'NOT_FOUND':
      throw new ServiceError(ErrorCode.DISCORD_MESSAGE_NOT_FOUND);
    case 'NO_ACCESS':
      throw new ServiceError(ErrorCode.DISCORD_MISSING_PERMISSIONS, { permission: 'view' });
    case 'INVALID_LINK':
      throw new ServiceError(ErrorCode.VALIDATION_FAILED);
  }
}

/**
 * The server a call is made for must be the server the message lives in, or an
 * API caller could read and ping across servers. The answer is the same as for
 * a channel that does not exist, so it does not reveal which servers the bot
 * is in. A slash command passes the guild it resolved from the link itself.
 */
export function assertInGuild(message: Pick<Message, 'guildId'>, guildId: string): void {
  if (message.guildId !== guildId) throw new ServiceError(ErrorCode.DISCORD_CHANNEL_NOT_FOUND);
}
