import { ErrorCode } from '@sab/shared';
import type { Client, Guild } from 'discord.js';
import { ServiceError } from '../../common/errors/service-error.js';
import { discordErrorCode } from './reply.js';

/** Unknown Channel, Unknown Guild. */
const MISSING_CODES: ReadonlySet<number> = new Set([10003, 10004]);
/** Missing Access, Missing Permissions. */
const FORBIDDEN_CODES: ReadonlySet<number> = new Set([50001, 50013]);

/** `GUILD_BOT_MISSING` when the bot is not in the server. */
export async function fetchGuild(client: Client, guildId: string): Promise<Guild> {
  try {
    return await client.guilds.fetch(guildId);
  } catch (error) {
    const code = discordErrorCode(error);
    if (code !== undefined && (MISSING_CODES.has(code) || FORBIDDEN_CODES.has(code))) {
      throw new ServiceError(ErrorCode.GUILD_BOT_MISSING);
    }
    throw error;
  }
}

/**
 * A channel of this server. The channel is read by its own id, so the server it
 * belongs to is checked: an id of another server's channel must not be
 * served on behalf of this one.
 */
export async function fetchGuildChannel(client: Client, guild: Guild, channelId: string) {
  let channel;
  try {
    channel = await client.channels.fetch(channelId);
  } catch (error) {
    const code = discordErrorCode(error);
    if (code !== undefined && (MISSING_CODES.has(code) || FORBIDDEN_CODES.has(code))) {
      throw new ServiceError(ErrorCode.DISCORD_CHANNEL_NOT_FOUND);
    }
    throw error;
  }
  if (channel === null || channel.isDMBased() || channel.guildId !== guild.id) {
    throw new ServiceError(ErrorCode.DISCORD_CHANNEL_NOT_FOUND);
  }
  return channel;
}
