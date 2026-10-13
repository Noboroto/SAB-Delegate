import { Injectable } from '@nestjs/common';
import { Client, PermissionFlagsBits } from 'discord.js';
import { discordErrorCode } from '../helpers/reply.js';

/** Unknown Channel: the id names nothing the bot can resolve. */
const UNKNOWN_CHANNEL_CODE = 10003;
/** Missing Access: the channel exists but the bot may not see it. */
const MISSING_ACCESS_CODE = 50001;

export type ChannelNeed = 'send' | 'read';

/**
 * `not-found`: no such channel, or not one the bot can have permissions in (a
 * direct message). `missing-permissions`: the channel is there but the bot may
 * not do what was asked in it. Callers tell the person which of the two, since
 * the fix is different.
 */
export type ChannelAccess = 'ok' | 'not-found' | 'missing-permissions';

/**
 * What the bot may do in one specific channel. The guild-level permission says
 * nothing here: channel overwrites can deny a role the guild grants, and a
 * command that "worked" in testing then fails in the one channel that matters.
 */
@Injectable()
export class ChannelAccessService {
  constructor(private readonly client: Client) {}

  /**
   * `send`: can see the channel and post in it (in a thread: post in threads).
   * `read`: can see the channel and read its history. Failures other than
   * "unknown channel" and "missing access" are thrown.
   */
  async check(channelId: string, need: ChannelNeed): Promise<ChannelAccess> {
    let channel;
    try {
      channel = await this.client.channels.fetch(channelId);
    } catch (error) {
      const code = discordErrorCode(error);
      if (code === UNKNOWN_CHANNEL_CODE) return 'not-found';
      if (code === MISSING_ACCESS_CODE) return 'missing-permissions';
      throw error;
    }
    if (!channel || channel.isDMBased() || !('permissionsFor' in channel)) return 'not-found';

    const me = channel.guild.members.me ?? (await channel.guild.members.fetchMe());
    const permissions = channel.permissionsFor(me);
    if (!permissions) return 'not-found';

    const required =
      need === 'read'
        ? [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory]
        : [
            PermissionFlagsBits.ViewChannel,
            channel.isThread()
              ? PermissionFlagsBits.SendMessagesInThreads
              : PermissionFlagsBits.SendMessages,
          ];
    return permissions.has(required) ? 'ok' : 'missing-permissions';
  }
}
