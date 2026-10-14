import { Injectable } from '@nestjs/common';
import {
  ErrorCode,
  LOOKUP_MEMBERS_LIMIT,
  LookupChannelSchema,
  LookupMemberSchema,
  LookupRoleSchema,
  SnowflakeSchema,
  z,
  type LookupChannel,
  type LookupMember,
  type LookupRole,
} from '@sab/shared';
import { Client, type Guild } from 'discord.js';
import { ServiceError } from '../../common/errors/service-error.js';
import { toServiceError } from '../../discord/helpers/discord-failure.js';

/**
 * What the dashboard's pickers need to name a channel, a role or a person of a
 * server: ids, names and types only. Channels and roles come from the
 * gateway cache the bot keeps current anyway; members are searched on
 * Discord, a few at a time, because a server can be far larger than a list.
 */
@Injectable()
export class DiscordLookupService {
  constructor(private readonly client: Client) {}

  /** Text, voice, category and the other non-thread channels, in the order Discord shows them. */
  channels(guildId: string): LookupChannel[] {
    const channels = [...this.guild(guildId).channels.cache.values()]
      .filter((channel) => !channel.isThread())
      .map((channel) => ({
        id: channel.id,
        name: channel.name,
        type: channel.type,
        parentId: channel.parentId,
        position: 'position' in channel ? channel.position : 0,
      }));
    return z
      .array(LookupChannelSchema)
      .parse(channels.sort((a, b) => a.position - b.position || a.name.localeCompare(b.name)));
  }

  roles(guildId: string): LookupRole[] {
    const roles = [...this.guild(guildId).roles.cache.values()].map((role) => ({
      id: role.id,
      name: role.name,
      color: role.colors.primaryColor,
      position: role.position,
      managed: role.managed,
    }));
    return z.array(LookupRoleSchema).parse(roles.sort((a, b) => b.position - a.position));
  }

  /** Members whose username or nickname starts with `query`, at most `LOOKUP_MEMBERS_LIMIT`. */
  async members(guildId: string, query: string): Promise<LookupMember[]> {
    const guild = this.guild(guildId);
    let found;
    try {
      found = await guild.members.search({ query, limit: LOOKUP_MEMBERS_LIMIT });
    } catch (error) {
      throw toServiceError(error);
    }
    return z.array(LookupMemberSchema).parse(
      [...found.values()].map((member) => ({
        id: member.id,
        username: member.user.username,
        displayName: member.displayName,
        bot: member.user.bot,
      })),
    );
  }

  private guild(guildId: string): Guild {
    const id = SnowflakeSchema.safeParse(guildId);
    const guild = id.success ? this.client.guilds.cache.get(id.data) : undefined;
    if (guild === undefined) throw new ServiceError(ErrorCode.GUILD_BOT_MISSING);
    return guild;
  }
}
