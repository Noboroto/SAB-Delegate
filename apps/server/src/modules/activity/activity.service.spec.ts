import 'reflect-metadata';
import { AUDIT_ACTIONS, ErrorCode, type ActorContext } from '@sab/shared';
import { ChannelType, Collection } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import type { AuditService } from '../../common/audit/audit.service.js';
import { ServiceError } from '../../common/errors/service-error.js';
import type { GuildConfigService } from '../guild-config/guild-config.service.js';
import { ActivityService } from './activity.service.js';

const GUILD = '100000000000000001';
const CATEGORY = '100000000000000009';
const ACTOR: ActorContext = { source: 'DISCORD', userId: '100000000000000002' };
const INPUT = { emoji: '🎉', name: 'Game Night', shortName: 'GNT' };

const failsWith = (code: ErrorCode): unknown =>
  expect.objectContaining({ name: 'ServiceError', code });

type Options = {
  roles?: Array<{ id: string; name: string }>;
  category?: { type: ChannelType; guildId: string } | null;
  failOnChannel?: number;
  configured?: string | null;
  unknownGuild?: boolean;
};

function build(options: Options = {}) {
  let next = 1000;
  const made: Array<{ id: string; delete: ReturnType<typeof vi.fn> }> = [];
  const item = () => {
    next += 1;
    const entry = {
      id: `${next}00000000000000`.slice(0, 18),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    made.push(entry);
    return entry;
  };

  const roles = new Collection<string, { id: string; name: string }>(
    (options.roles ?? []).map((role) => [role.id, role]),
  );
  let channelCalls = 0;
  const guild = {
    id: GUILD,
    roles: {
      everyone: { id: GUILD },
      fetch: vi.fn().mockResolvedValue(roles),
      create: vi
        .fn()
        .mockImplementation((data: { name: string }) =>
          Promise.resolve({ ...item(), name: data.name }),
        ),
    },
    channels: {
      create: vi.fn().mockImplementation((data: { name: string }) => {
        channelCalls += 1;
        if (channelCalls === options.failOnChannel) return Promise.reject(new Error('boom'));
        return Promise.resolve({ ...item(), name: data.name });
      }),
    },
  };
  const category =
    options.category === undefined
      ? { type: ChannelType.GuildCategory, guildId: GUILD, isDMBased: () => false }
      : options.category && { ...options.category, isDMBased: () => false };
  const client = {
    guilds: { fetch: vi.fn().mockResolvedValue(guild) },
    channels: { fetch: vi.fn().mockResolvedValue(category) },
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const config = {
    get: vi.fn().mockImplementation(() => {
      if (options.unknownGuild === true) {
        return Promise.reject(new ServiceError(ErrorCode.GUILD_NOT_FOUND));
      }
      return Promise.resolve({ activityCategoryId: options.configured ?? null });
    }),
  };
  const service = new ActivityService(
    client as never,
    audit as unknown as AuditService,
    config as unknown as GuildConfigService,
  );
  return { service, guild, client, audit, config, made };
}

describe('ActivityService.createActivity', () => {
  it('makes three roles and three channels in the chosen category and audits it', async () => {
    const { service, guild, audit } = build();
    const result = await service.createActivity(GUILD, { ...INPUT, categoryId: CATEGORY }, ACTOR);

    expect(guild.roles.create.mock.calls.map(([data]) => (data as { name: string }).name)).toEqual([
      'Game Night-Event',
      'Game Night-Multi',
      'Game Night-MC',
    ]);
    const channels = guild.channels.create.mock.calls.map(
      ([data]) => data as { name: string; parent: string; type: ChannelType; userLimit?: number },
    );
    expect(channels.map((channel) => channel.name)).toEqual([
      '🎉┃game-night-general',
      '🎉┃game-night-thread-only',
      '🎉┃Game Night voice',
    ]);
    expect(channels.every((channel) => channel.parent === CATEGORY)).toBe(true);
    expect(channels.map((channel) => channel.type)).toEqual([
      ChannelType.GuildText,
      ChannelType.GuildText,
      ChannelType.GuildVoice,
    ]);
    expect(channels[2]?.userLimit).toBe(99);

    expect(result.categoryId).toBe(CATEGORY);
    expect(Object.values(result.roles)).toHaveLength(3);
    expect(Object.values(result.channels)).toHaveLength(3);
    expect(audit.record).toHaveBeenCalledWith({
      guildId: GUILD,
      actor: ACTOR,
      action: AUDIT_ACTIONS.activityCreate,
      params: {
        targetId: CATEGORY,
        roleId: Object.values(result.roles),
        channelId: Object.values(result.channels),
      },
    });
  });

  it('puts the technician and Muted roles of the server into the permission overwrites', async () => {
    const { service, guild } = build({
      roles: [
        { id: '300000000000000001', name: 'Technician Team' },
        { id: '300000000000000002', name: 'Muted' },
      ],
    });
    await service.createActivity(GUILD, { ...INPUT, categoryId: CATEGORY }, ACTOR);
    const overwrites = (
      guild.channels.create.mock.calls[0]?.[0] as {
        permissionOverwrites: Array<{ id: string }>;
      }
    ).permissionOverwrites.map((entry) => entry.id);
    expect(overwrites).toContain('300000000000000001');
    expect(overwrites).toContain('300000000000000002');
  });

  it('uses the default category of the server when none is given', async () => {
    const { service, client } = build({ configured: CATEGORY });
    const result = await service.createActivity(GUILD, INPUT, ACTOR);
    expect(result.categoryId).toBe(CATEGORY);
    expect(client.channels.fetch).toHaveBeenCalledWith(CATEGORY);
  });

  it('prefers the category asked for over the default', async () => {
    const { service, config } = build({ configured: '100000000000000008' });
    const result = await service.createActivity(GUILD, { ...INPUT, categoryId: CATEGORY }, ACTOR);
    expect(result.categoryId).toBe(CATEGORY);
    expect(config.get).not.toHaveBeenCalled();
  });

  it.each([{ configured: null }, { unknownGuild: true }])(
    'refuses, creating nothing, when there is no category at all (%j)',
    async (options) => {
      const { service, guild, audit } = build(options);
      await expect(service.createActivity(GUILD, INPUT, ACTOR)).rejects.toEqual(
        failsWith(ErrorCode.VALIDATION_FAILED),
      );
      expect(guild.roles.create).not.toHaveBeenCalled();
      expect(guild.channels.create).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    },
  );

  it('refuses a category that is not one, or belongs to another server', async () => {
    const wrongType = build({ category: { type: ChannelType.GuildText, guildId: GUILD } });
    await expect(
      wrongType.service.createActivity(GUILD, { ...INPUT, categoryId: CATEGORY }, ACTOR),
    ).rejects.toEqual(failsWith(ErrorCode.DISCORD_CHANNEL_NOT_FOUND));
    expect(wrongType.guild.roles.create).not.toHaveBeenCalled();

    const elsewhere = build({
      category: { type: ChannelType.GuildCategory, guildId: '100000000000000777' },
    });
    await expect(
      elsewhere.service.createActivity(GUILD, { ...INPUT, categoryId: CATEGORY }, ACTOR),
    ).rejects.toEqual(failsWith(ErrorCode.DISCORD_CHANNEL_NOT_FOUND));

    const missing = build({ category: null });
    await expect(
      missing.service.createActivity(GUILD, { ...INPUT, categoryId: CATEGORY }, ACTOR),
    ).rejects.toEqual(failsWith(ErrorCode.DISCORD_CHANNEL_NOT_FOUND));
  });

  it('refuses invalid input before touching Discord', async () => {
    const { service, client } = build();
    for (const input of [{ ...INPUT, shortName: 'ab' }, { ...INPUT, name: ' ' }, 'nope', null]) {
      await expect(service.createActivity(GUILD, input, ACTOR)).rejects.toEqual(
        failsWith(ErrorCode.VALIDATION_FAILED),
      );
    }
    await expect(service.createActivity('12', INPUT, ACTOR)).rejects.toEqual(
      failsWith(ErrorCode.VALIDATION_FAILED),
    );
    expect(client.guilds.fetch).not.toHaveBeenCalled();
  });

  it('takes back everything it made when a later step fails, and rethrows the failure', async () => {
    const { service, made, audit } = build({ failOnChannel: 2 });
    await expect(
      service.createActivity(GUILD, { ...INPUT, categoryId: CATEGORY }, ACTOR),
    ).rejects.toThrow('boom');
    // Three roles and the first channel were made.
    expect(made).toHaveLength(4);
    for (const entry of made) expect(entry.delete).toHaveBeenCalledTimes(1);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('keeps the activity when only its audit row cannot be written', async () => {
    const { service, made, audit } = build();
    audit.record.mockRejectedValueOnce(new Error('db down'));
    await expect(
      service.createActivity(GUILD, { ...INPUT, categoryId: CATEGORY }, ACTOR),
    ).resolves.toMatchObject({ categoryId: CATEGORY });
    for (const entry of made) expect(entry.delete).not.toHaveBeenCalled();
  });

  it('says the bot is not in a server it cannot fetch', async () => {
    const { service, client } = build();
    client.guilds.fetch.mockRejectedValueOnce(
      Object.assign(new Error('Unknown Guild'), { code: 10004 }),
    );
    await expect(
      service.createActivity(GUILD, { ...INPUT, categoryId: CATEGORY }, ACTOR),
    ).rejects.toEqual(failsWith(ErrorCode.GUILD_BOT_MISSING));
  });
});

describe('ActivityService.resolveCategoryId', () => {
  it('returns the asked-for category, the default, or null', async () => {
    expect(await build().service.resolveCategoryId(GUILD, CATEGORY)).toBe(CATEGORY);
    expect(await build({ configured: CATEGORY }).service.resolveCategoryId(GUILD)).toBe(CATEGORY);
    expect(await build({ configured: null }).service.resolveCategoryId(GUILD)).toBeNull();
    expect(await build({ unknownGuild: true }).service.resolveCategoryId(GUILD)).toBeNull();
  });
});
