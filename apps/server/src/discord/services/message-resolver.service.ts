import { Injectable } from '@nestjs/common';
import { parseMessageRef, type MessageRefFailure } from '@sab/shared';
import { Client, type Message } from 'discord.js';
import { discordErrorCode } from '../helpers/reply.js';

export type MessageResolution =
  | { status: 'OK'; message: Message }
  | { status: 'INVALID_LINK'; reason: MessageRefFailure }
  | { status: 'NOT_FOUND' }
  | { status: 'NO_ACCESS' };

/** Unknown Channel, Unknown Message. */
const MISSING_CODES: ReadonlySet<number> = new Set([10003, 10008]);
/** Missing Access, Missing Permissions. */
const FORBIDDEN_CODES: ReadonlySet<number> = new Set([50001, 50013]);

/**
 * Turns what a person typed (a "Copy Message Link", a `channel/message` pair, a
 * bare id) into the message. A link into another server is followed on
 * purpose: the bot works across every server it is in, and the guild in a link
 * is not checked against the one the command ran in.
 */
@Injectable()
export class MessageResolver {
  constructor(private readonly client: Client) {}

  /**
   * `defaults.channelId` is the channel a bare id refers to. Expected
   * failures come back as a status; an unexpected API error is thrown.
   */
  async fetch(input: string, defaults: { channelId?: string } = {}): Promise<MessageResolution> {
    const ref = parseMessageRef(input, defaults);
    if (!ref.ok) return { status: 'INVALID_LINK', reason: ref.reason };

    try {
      const channel = await this.client.channels.fetch(ref.channelId);
      if (!channel?.isTextBased()) return { status: 'NOT_FOUND' };
      return { status: 'OK', message: await channel.messages.fetch(ref.messageId) };
    } catch (error) {
      const code = discordErrorCode(error);
      if (code !== undefined && MISSING_CODES.has(code)) return { status: 'NOT_FOUND' };
      if (code !== undefined && FORBIDDEN_CODES.has(code)) return { status: 'NO_ACCESS' };
      throw error;
    }
  }
}
