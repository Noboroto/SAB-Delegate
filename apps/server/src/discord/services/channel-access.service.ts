import { Injectable } from '@nestjs/common';
import { Client, PermissionFlagsBits } from 'discord.js';
import { discordErrorCode } from '../helpers/reply.js';

/** Unknown Channel, Missing Access: the bot cannot see the channel at all. */
const INVISIBLE_CHANNEL_CODES: ReadonlySet<number> = new Set([10003, 50001]);

/**
 * What the bot may do in one specific channel. The guild-level permission says
 * nothing here: channel overwrites can deny a role the guild grants, and a
 * command that "worked" in testing then fails in the one channel that matters.
 */
@Injectable()
export class ChannelAccessService {
  constructor(private readonly client: Client) {}

  /** Can see the channel and post in it (in a thread: post in threads). */
  botCanSend(channelId: string): Promise<boolean> {
    return this.check(channelId, 'send');
  }

  /** Can see the channel and read its history. */
  botCanRead(channelId: string): Promise<boolean> {
    return this.check(channelId, 'read');
  }

  private async check(channelId: string, need: 'send' | 'read'): Promise<boolean> {
    let channel;
    try {
      channel = await this.client.channels.fetch(channelId);
    } catch (error) {
      const code = discordErrorCode(error);
      if (code !== undefined && INVISIBLE_CHANNEL_CODES.has(code)) return false;
      throw error;
    }
    if (!channel || channel.isDMBased() || !('permissionsFor' in channel)) return false;

    const me = channel.guild.members.me ?? (await channel.guild.members.fetchMe());
    const permissions = channel.permissionsFor(me);
    if (!permissions) return false;

    const required =
      need === 'read'
        ? [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory]
        : [
            PermissionFlagsBits.ViewChannel,
            channel.isThread()
              ? PermissionFlagsBits.SendMessagesInThreads
              : PermissionFlagsBits.SendMessages,
          ];
    return permissions.has(required);
  }
}
