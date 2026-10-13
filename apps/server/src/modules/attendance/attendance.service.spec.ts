import 'reflect-metadata';
import { ErrorCode } from '@sab/shared';
import { Collection } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { AttendanceService } from './attendance.service.js';

const GUILD = '100000000000000001';
const ROLE = '200000000000000001';
const VOICE = '300000000000000001';

const failsWith = (code: ErrorCode): unknown =>
  expect.objectContaining({ name: 'ServiceError', code });

const member = (id: string, username: string) => ({ id, user: { username } });

function build(
  options: {
    voiceBased?: boolean;
    inChannel?: string[];
    holders?: Array<ReturnType<typeof member>>;
    role?: 'missing';
    channelGuild?: string;
  } = {},
) {
  const holders = options.holders ?? [
    member('400000000000000001', 'an'),
    member('400000000000000002', 'binh'),
    member('400000000000000003', 'chi'),
  ];
  const role =
    options.role === 'missing'
      ? null
      : {
          id: ROLE,
          name: 'Mentors',
          members: new Collection(holders.map((entry) => [entry.id, entry])),
        };
  const channel = {
    id: VOICE,
    guildId: options.channelGuild ?? GUILD,
    isDMBased: () => false,
    isVoiceBased: () => options.voiceBased ?? true,
    members: new Collection((options.inChannel ?? []).map((id) => [id, { id }])),
  };
  const guild = {
    id: GUILD,
    roles: { fetch: vi.fn().mockResolvedValue(role) },
    members: { fetch: vi.fn().mockResolvedValue(undefined) },
  };
  const client = {
    guilds: { fetch: vi.fn().mockResolvedValue(guild) },
    channels: { fetch: vi.fn().mockResolvedValue(channel) },
  };
  return { service: new AttendanceService(client as never), guild, client };
}

const INPUT = { roleId: ROLE, voiceChannelId: VOICE };

describe('AttendanceService.checkByRole', () => {
  it('splits the members of the role into present and absent', async () => {
    const { service, guild } = build({
      inChannel: ['400000000000000001', '400000000000000003', '400000000000000099'],
    });
    const result = await service.checkByRole(GUILD, INPUT);

    expect(guild.members.fetch).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      roleId: ROLE,
      roleName: 'Mentors',
      voiceChannelId: VOICE,
      total: 3,
      present: [
        { userId: '400000000000000001', username: 'an' },
        { userId: '400000000000000003', username: 'chi' },
      ],
      absent: [{ userId: '400000000000000002', username: 'binh' }],
    });
  });

  it('does not count people in the channel who lack the role', async () => {
    const { service } = build({ inChannel: ['400000000000000099'] });
    const result = await service.checkByRole(GUILD, INPUT);
    expect(result.present).toEqual([]);
    expect(result.absent).toHaveLength(3);
  });

  it('reports a role nobody has as an empty roll', async () => {
    const { service } = build({ holders: [] });
    await expect(service.checkByRole(GUILD, INPUT)).resolves.toMatchObject({
      total: 0,
      present: [],
      absent: [],
    });
  });

  it('refuses a channel that is not voice or stage', async () => {
    const { service } = build({ voiceBased: false });
    await expect(service.checkByRole(GUILD, INPUT)).rejects.toEqual(
      failsWith(ErrorCode.DISCORD_CHANNEL_NOT_FOUND),
    );
  });

  it('refuses a channel of another server', async () => {
    const { service } = build({ channelGuild: '100000000000000777' });
    await expect(service.checkByRole(GUILD, INPUT)).rejects.toEqual(
      failsWith(ErrorCode.DISCORD_CHANNEL_NOT_FOUND),
    );
  });

  it('refuses a role the server does not have, before reading the member list', async () => {
    const { service, guild } = build({ role: 'missing' });
    await expect(service.checkByRole(GUILD, INPUT)).rejects.toEqual(
      failsWith(ErrorCode.VALIDATION_FAILED),
    );
    expect(guild.members.fetch).not.toHaveBeenCalled();
  });

  it('refuses ids that are not snowflakes without calling Discord', async () => {
    const { service, client } = build();
    for (const input of [{ roleId: 'x', voiceChannelId: VOICE }, { roleId: ROLE }, null]) {
      await expect(service.checkByRole(GUILD, input)).rejects.toEqual(
        failsWith(ErrorCode.VALIDATION_FAILED),
      );
    }
    expect(client.guilds.fetch).not.toHaveBeenCalled();
  });

  it('says the bot is not in a server it cannot fetch', async () => {
    const { service, client } = build();
    client.guilds.fetch.mockRejectedValueOnce(
      Object.assign(new Error('Unknown Guild'), { code: 10004 }),
    );
    await expect(service.checkByRole(GUILD, INPUT)).rejects.toEqual(
      failsWith(ErrorCode.GUILD_BOT_MISSING),
    );
  });
});
