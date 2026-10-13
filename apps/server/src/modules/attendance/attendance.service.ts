import { Injectable } from '@nestjs/common';
import { AttendanceCheckSchema, ErrorCode, type AttendanceResult } from '@sab/shared';
import { Client } from 'discord.js';
import { ServiceError } from '../../common/errors/service-error.js';
import { fetchGuild, fetchGuildChannel } from '../../discord/helpers/discord-lookup.js';

/**
 * Who of a role is in a voice or stage channel right now. Reads only, so
 * nothing is audited. The slash command, the REST API and the MCP tools all go
 * through here.
 */
@Injectable()
export class AttendanceService {
  constructor(private readonly client: Client) {}

  async checkByRole(guildId: string, input: unknown): Promise<AttendanceResult> {
    const parsed = AttendanceCheckSchema.safeParse(input);
    if (!parsed.success) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
    const { roleId, voiceChannelId } = parsed.data;

    const guild = await fetchGuild(this.client, guildId);
    const channel = await fetchGuildChannel(this.client, guild, voiceChannelId);
    if (!channel.isVoiceBased()) throw new ServiceError(ErrorCode.DISCORD_CHANNEL_NOT_FOUND);

    const role = await guild.roles.fetch(roleId);
    if (role === null) throw new ServiceError(ErrorCode.VALIDATION_FAILED, { field: 'role' });

    // `role.members` reads the cache; the full list needs the whole member list.
    await guild.members.fetch();
    const inChannel = new Set(channel.members.keys());

    const present: AttendanceResult['present'] = [];
    const absent: AttendanceResult['absent'] = [];
    for (const member of role.members.values()) {
      const entry = { userId: member.id, username: member.user.username };
      (inChannel.has(member.id) ? present : absent).push(entry);
    }

    return {
      roleId: role.id,
      roleName: role.name,
      voiceChannelId: channel.id,
      total: present.length + absent.length,
      present,
      absent,
    };
  }
}
