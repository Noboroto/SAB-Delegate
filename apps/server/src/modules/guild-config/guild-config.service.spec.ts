import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { AUDIT_ACTIONS, ErrorCode, type ActorContext } from '@sab/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditService } from '../../common/audit/audit.service.js';
import {
  ChannelAccessService,
  type ChannelAccess,
} from '../../discord/services/channel-access.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { GuildConfigService } from './guild-config.service.js';

const GUILD = '100000000000000001';
const CHANNEL = '200000000000000001';
const OTHER_CHANNEL = '200000000000000002';
const OTHER_GUILD = '100000000000000009';
const ACTOR: ActorContext = { source: 'DISCORD', userId: '100000000000000002' };

const config = (overrides: Record<string, unknown> = {}) => ({
  introChannelId: null,
  logChannelId: null,
  birthdayChannelId: null,
  activityCategoryId: null,
  wordChannelId: null,
  wordMaxWords: 1500,
  ...overrides,
});
const settingsRow = (overrides: Record<string, unknown> = {}, locale = 'vi') => ({
  locale,
  config: config(overrides),
});

function build(options: { access?: ChannelAccess } = {}) {
  const prisma = {
    guild: {
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: vi
        .fn()
        .mockResolvedValue({ id: 'guild-uuid', discordId: GUILD, name: null, locale: 'vi' }),
      findUnique: vi.fn().mockResolvedValue(settingsRow()),
      update: vi.fn().mockResolvedValue({}),
    },
    guildConfig: {
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
      update: vi.fn().mockResolvedValue({}),
    },
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation((work: (tx: typeof prisma) => unknown) => work(prisma));
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const access = { check: vi.fn().mockResolvedValue(options.access ?? 'ok') };
  const service = new GuildConfigService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    access as unknown as ChannelAccessService,
  );
  return { prisma, audit, access, service };
}

const failsWith = (code: string): unknown =>
  expect.objectContaining({ code, name: 'ServiceError' });

describe('GuildConfigService.patch validation', () => {
  it('refuses a channel the bot cannot use, before anything is written', async () => {
    const { prisma, audit, service } = build({ access: 'not-found' });
    await expect(service.patch(GUILD, { logChannelId: CHANNEL }, ACTOR)).rejects.toEqual(
      failsWith(ErrorCode.DISCORD_CHANNEL_NOT_FOUND),
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('holds the intro channel to read access and the others to send access', async () => {
    const { access, service } = build();
    await service.patch(GUILD, { introChannelId: CHANNEL }, ACTOR);
    expect(access.check).toHaveBeenCalledWith(CHANNEL, 'read');
    expect(access.check).toHaveBeenCalledTimes(1);

    await service.patch(GUILD, { logChannelId: OTHER_CHANNEL }, ACTOR);
    await service.patch(GUILD, { birthdayChannelId: OTHER_CHANNEL }, ACTOR);
    await service.patch(GUILD, { wordChannelId: OTHER_CHANNEL }, ACTOR);
    expect(access.check.mock.calls.slice(1)).toEqual([
      [OTHER_CHANNEL, 'send'],
      [OTHER_CHANNEL, 'send'],
      [OTHER_CHANNEL, 'send'],
    ]);
  });

  it('scopes the channel check to the server for callers other than a slash command', async () => {
    const { access, service } = build();
    const rest: ActorContext = { source: 'HTTP', userId: '100000000000000002' };
    await service.patch(GUILD, { logChannelId: CHANNEL }, rest);
    expect(access.check).toHaveBeenCalledWith(CHANNEL, 'send', GUILD);
    await service.patch(GUILD, { introChannelId: CHANNEL }, rest, { dryRun: true });
    expect(access.check).toHaveBeenLastCalledWith(CHANNEL, 'read', GUILD);
  });

  it('answers a channel of another server like a missing one and writes nothing', async () => {
    const { access, prisma, audit, service } = build();
    access.check.mockImplementation((_id: string, _need: string, guildId?: string) =>
      Promise.resolve(guildId === undefined ? 'ok' : 'not-found'),
    );
    const rest: ActorContext = { source: 'HTTP', userId: '100000000000000002' };
    await expect(service.patch(GUILD, { logChannelId: CHANNEL }, rest)).rejects.toEqual(
      failsWith(ErrorCode.DISCORD_CHANNEL_NOT_FOUND),
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('does not ask Discord anything to clear a channel', async () => {
    const { access, service } = build();
    await service.patch(GUILD, { logChannelId: null }, ACTOR);
    expect(access.check).not.toHaveBeenCalled();
  });

  it('rejects wordMaxWords under 200 and checks no channel for it', async () => {
    const { access, prisma, service } = build();
    await expect(
      service.patch(GUILD, { wordMaxWords: 199, logChannelId: CHANNEL }, ACTOR),
    ).rejects.toEqual(failsWith(ErrorCode.VALIDATION_FAILED));
    expect(access.check).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    await expect(service.patch(GUILD, { wordMaxWords: 200 }, ACTOR)).resolves.toBeDefined();
  });

  it('strips fields it does not know instead of writing them', async () => {
    const { prisma, service } = build();
    await service.patch(
      GUILD,
      { logChannelId: CHANNEL, guildId: 'other-guild-key', id: 'x', isAdmin: true },
      ACTOR,
    );
    expect(prisma.guildConfig.update).toHaveBeenCalledWith({
      where: { guildId: 'guild-uuid' },
      data: { logChannelId: CHANNEL },
    });
  });

  it.each([
    ['an empty patch', {}],
    ['a patch of unknown fields only', { isAdmin: true }],
    ['a mention instead of an id', { logChannelId: `<#${CHANNEL}>` }],
    ['an unsupported language', { locale: 'fr' }],
    ['something that is not an object', 'logChannelId'],
  ])('rejects %s', async (_label, patch) => {
    const { prisma, service } = build();
    await expect(service.patch(GUILD, patch, ACTOR)).rejects.toEqual(
      failsWith(ErrorCode.VALIDATION_FAILED),
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a server id that is not a snowflake', async () => {
    const { service } = build();
    await expect(service.patch('abc', { locale: 'en' }, ACTOR)).rejects.toEqual(
      failsWith(ErrorCode.VALIDATION_FAILED),
    );
  });
});

describe('GuildConfigService.patch with dryRun', () => {
  it('reports the current and planned channel without writing or auditing', async () => {
    const { prisma, audit, service } = build();
    prisma.guild.findUnique.mockResolvedValueOnce(settingsRow({ logChannelId: OTHER_CHANNEL }));
    const result = await service.patch(GUILD, { logChannelId: CHANNEL }, ACTOR, { dryRun: true });
    expect(result.before.logChannelId).toBe(OTHER_CHANNEL);
    expect(result.after.logChannelId).toBe(CHANNEL);
    expect(result.after.wordMaxWords).toBe(1500);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.guild.createMany).not.toHaveBeenCalled();
    expect(prisma.guildConfig.update).not.toHaveBeenCalled();
    expect(prisma.guild.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('reports a language change', async () => {
    const { prisma, service } = build();
    const result = await service.patch(GUILD, { locale: 'en' }, ACTOR, { dryRun: true });
    expect(result.before.locale).toBe('vi');
    expect(result.after.locale).toBe('en');
    expect(prisma.guild.update).not.toHaveBeenCalled();
  });

  it('plans against defaults for a server the bot has not recorded yet', async () => {
    const { prisma, service } = build();
    prisma.guild.findUnique.mockResolvedValueOnce(null);
    const result = await service.patch(GUILD, { wordMaxWords: 300 }, ACTOR, { dryRun: true });
    expect(result.before).toMatchObject({ locale: 'vi', wordMaxWords: 1500, logChannelId: null });
    expect(result.after.wordMaxWords).toBe(300);
  });

  it('still checks the channel against Discord, which is a read', async () => {
    const { access, service } = build({ access: 'not-found' });
    await expect(
      service.patch(GUILD, { birthdayChannelId: CHANNEL }, ACTOR, { dryRun: true }),
    ).rejects.toEqual(failsWith(ErrorCode.DISCORD_CHANNEL_NOT_FOUND));
    expect(access.check).toHaveBeenCalledWith(CHANNEL, 'send');
  });

  it('executes exactly what the dry run reported when run for real', async () => {
    const { prisma, service } = build();
    prisma.guild.findUnique
      .mockResolvedValueOnce(settingsRow())
      .mockResolvedValueOnce(settingsRow())
      .mockResolvedValueOnce(settingsRow({ logChannelId: CHANNEL }, 'en'));
    const planned = await service.patch(GUILD, { logChannelId: CHANNEL, locale: 'en' }, ACTOR, {
      dryRun: true,
    });
    const applied = await service.patch(GUILD, { logChannelId: CHANNEL, locale: 'en' }, ACTOR, {
      dryRun: false,
    });
    expect(applied).toEqual(planned.after);
  });
});

describe('GuildConfigService.patch', () => {
  it('writes the change and its audit row in one transaction, with only the changed fields', async () => {
    const { prisma, audit, service } = build();
    prisma.guild.findUnique
      .mockResolvedValueOnce(settingsRow({ logChannelId: OTHER_CHANNEL }))
      .mockResolvedValueOnce(settingsRow({ logChannelId: CHANNEL }));

    const result = await service.patch(GUILD, { logChannelId: CHANNEL }, ACTOR);

    expect(result.logChannelId).toBe(CHANNEL);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.guildConfig.update).toHaveBeenCalledWith({
      where: { guildId: 'guild-uuid' },
      data: { logChannelId: CHANNEL },
    });
    expect(prisma.guild.update).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      {
        guildId: GUILD,
        actor: ACTOR,
        action: AUDIT_ACTIONS.guildConfigUpdate,
        params: {
          before: { logChannelId: OTHER_CHANNEL },
          after: { logChannelId: CHANNEL },
        },
      },
      prisma,
    );
  });

  it('stores the language on the server row and the rest on the settings row', async () => {
    const { prisma, service } = build();
    prisma.guild.findUnique
      .mockResolvedValueOnce(settingsRow())
      .mockResolvedValueOnce(settingsRow({ wordMaxWords: 400 }, 'en'));
    await service.patch(GUILD, { locale: 'en', wordMaxWords: 400 }, ACTOR);
    expect(prisma.guild.update).toHaveBeenCalledWith({
      where: { id: 'guild-uuid' },
      data: { locale: 'en' },
    });
    expect(prisma.guildConfig.update).toHaveBeenCalledWith({
      where: { guildId: 'guild-uuid' },
      data: { wordMaxWords: 400 },
    });
  });

  it('clears a channel with null', async () => {
    const { prisma, service } = build();
    await service.patch(GUILD, { birthdayChannelId: null }, ACTOR);
    expect(prisma.guildConfig.update).toHaveBeenCalledWith({
      where: { guildId: 'guild-uuid' },
      data: { birthdayChannelId: null },
    });
  });

  it('does not record an audit row the transaction would have rolled back', async () => {
    const { prisma, audit, service } = build();
    prisma.guildConfig.update.mockRejectedValueOnce(new Error('write failed'));
    await expect(service.patch(GUILD, { logChannelId: CHANNEL }, ACTOR)).rejects.toThrow(
      'write failed',
    );
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('creates the server and settings rows first when the bot had not recorded them', async () => {
    const { prisma, service } = build();
    await service.patch(GUILD, { logChannelId: CHANNEL }, ACTOR);
    expect(prisma.guild.createMany).toHaveBeenCalled();
    expect(prisma.guildConfig.createMany).toHaveBeenCalled();
  });
});

describe('GuildConfigService.get', () => {
  it('returns the settings with nothing but settings in them', async () => {
    const { prisma, service } = build();
    prisma.guild.findUnique.mockResolvedValueOnce(settingsRow({ introChannelId: CHANNEL }, 'en'));
    await expect(service.get(GUILD)).resolves.toEqual({
      introChannelId: CHANNEL,
      logChannelId: null,
      birthdayChannelId: null,
      activityCategoryId: null,
      wordChannelId: null,
      wordMaxWords: 1500,
      locale: 'en',
    });
  });

  it('falls back to defaults for a server with no settings row', async () => {
    const { prisma, service } = build();
    prisma.guild.findUnique.mockResolvedValueOnce({ locale: 'vi', config: null });
    await expect(service.get(GUILD)).resolves.toMatchObject({
      wordMaxWords: 1500,
      introChannelId: null,
    });
  });

  it('answers GUILD_NOT_FOUND for a server the bot has never seen', async () => {
    const { prisma, service } = build();
    prisma.guild.findUnique.mockResolvedValueOnce(null);
    await expect(service.get(GUILD)).rejects.toEqual(failsWith(ErrorCode.GUILD_NOT_FOUND));
  });
});

describe('GuildConfigService.assertChannelUsable', () => {
  it.each([
    ['introChannelId', 'read', 'view'],
    ['logChannelId', 'send', 'send'],
    ['birthdayChannelId', 'send', 'send'],
  ] as const)(
    'names the missing %s permission, not just "not found"',
    async (setting, need, permission) => {
      const { access, service } = build({ access: 'missing-permissions' });
      await expect(service.assertChannelUsable(setting, CHANNEL)).rejects.toEqual(
        expect.objectContaining({
          code: ErrorCode.DISCORD_MISSING_PERMISSIONS,
          params: { permission },
          name: 'ServiceError',
        }),
      );
      expect(access.check).toHaveBeenCalledWith(CHANNEL, need);
    },
  );

  it('says not found only for a channel that is not there', async () => {
    const { service } = build({ access: 'not-found' });
    await expect(service.assertChannelUsable('logChannelId', CHANNEL)).rejects.toEqual(
      failsWith(ErrorCode.DISCORD_CHANNEL_NOT_FOUND),
    );
  });

  it('resolves for a usable channel', async () => {
    const { service } = build();
    await expect(service.assertChannelUsable('introChannelId', CHANNEL)).resolves.toBeUndefined();
  });

  it('is what patch reports too, before anything is written', async () => {
    const { prisma, service } = build({ access: 'missing-permissions' });
    await expect(service.patch(GUILD, { introChannelId: CHANNEL }, ACTOR)).rejects.toEqual(
      expect.objectContaining({
        code: ErrorCode.DISCORD_MISSING_PERMISSIONS,
        params: { permission: 'view' },
      }),
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('GuildConfigService.ensureGuild', () => {
  it('inserts the server and its settings with ON CONFLICT DO NOTHING, then reads the server back', async () => {
    const { prisma, service } = build();
    await expect(service.ensureGuild(GUILD, 'SAB')).resolves.toMatchObject({ id: 'guild-uuid' });
    expect(prisma.guild.createMany.mock.calls[0]?.[0]).toEqual({
      data: [{ discordId: GUILD, name: 'SAB' }],
      skipDuplicates: true,
    });
    expect(prisma.guild.findUniqueOrThrow.mock.calls[0]?.[0]).toMatchObject({
      where: { discordId: GUILD },
    });
    expect(prisma.guildConfig.createMany.mock.calls[0]?.[0]).toEqual({
      data: [{ guildId: 'guild-uuid' }],
      skipDuplicates: true,
    });
  });

  it('renames only when the stored name differs, and never writes without a name', async () => {
    const { prisma, service } = build();
    await service.ensureGuild(GUILD, 'SAB');
    expect(prisma.guild.updateMany.mock.calls[0]?.[0]).toEqual({
      where: { discordId: GUILD, OR: [{ name: null }, { name: { not: 'SAB' } }] },
      data: { name: 'SAB' },
    });

    prisma.guild.updateMany.mockClear();
    await service.ensureGuild(GUILD);
    expect(prisma.guild.updateMany).not.toHaveBeenCalled();
  });

  it('works inside the transaction it is handed', async () => {
    const { prisma, service } = build();
    const tx = {
      guild: {
        createMany: vi.fn().mockResolvedValue({ count: 0 }),
        updateMany: vi.fn(),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'tx-guild' }),
      },
      guildConfig: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
    };
    await service.ensureGuild(GUILD, undefined, tx as never);
    expect(tx.guild.createMany).toHaveBeenCalled();
    expect(prisma.guild.createMany).not.toHaveBeenCalled();
  });

  it('refuses an id that is not a snowflake', async () => {
    const { service } = build();
    await expect(service.ensureGuild('not-an-id')).rejects.toEqual(
      failsWith(ErrorCode.VALIDATION_FAILED),
    );
  });
});

describe('GuildConfigService.wordGameRoute', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['performance', 'Date', 'setTimeout', 'clearTimeout'] });
    // lru-cache reads an entry stamped 0 as "no expiry"; a faked clock starts at 0.
    vi.advanceTimersByTime(1);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads once for a channel and remembers it', async () => {
    const { prisma, service } = build();
    prisma.guild.findUnique.mockResolvedValue(settingsRow({ wordChannelId: CHANNEL }));
    const expected = { channelId: CHANNEL, maxWords: 1500 };
    await expect(service.wordGameRoute(GUILD)).resolves.toEqual(expected);
    await expect(service.wordGameRoute(GUILD)).resolves.toEqual(expected);
    expect(prisma.guild.findUnique).toHaveBeenCalledTimes(1);
  });

  it('remembers "not configured" and an unknown server too', async () => {
    const { prisma, service } = build();
    await expect(service.wordGameRoute(GUILD)).resolves.toBeNull();
    await expect(service.wordGameRoute(GUILD)).resolves.toBeNull();
    prisma.guild.findUnique.mockResolvedValue(null);
    await expect(service.wordGameRoute(OTHER_GUILD)).resolves.toBeNull();
    await expect(service.wordGameRoute(OTHER_GUILD)).resolves.toBeNull();
    expect(prisma.guild.findUnique).toHaveBeenCalledTimes(2);
  });

  it('reads again after the time to live', async () => {
    const { prisma, service } = build();
    await service.wordGameRoute(GUILD);
    vi.advanceTimersByTime(59_000);
    await service.wordGameRoute(GUILD);
    expect(prisma.guild.findUnique).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2_000);
    await service.wordGameRoute(GUILD);
    expect(prisma.guild.findUnique).toHaveBeenCalledTimes(2);
  });

  it('sees a new word channel right after patch commits', async () => {
    const { prisma, service } = build();
    await expect(service.wordGameRoute(GUILD)).resolves.toBeNull();
    prisma.guild.findUnique.mockResolvedValue(settingsRow({ wordChannelId: CHANNEL }));
    await service.patch(GUILD, { wordChannelId: CHANNEL }, ACTOR);
    await expect(service.wordGameRoute(GUILD)).resolves.toEqual({
      channelId: CHANNEL,
      maxWords: 1500,
    });
  });

  it('keeps the old answer when patch fails before commit', async () => {
    const { prisma, service } = build();
    prisma.guild.findUnique.mockResolvedValue(settingsRow({ wordChannelId: CHANNEL }));
    await service.wordGameRoute(GUILD);
    prisma.$transaction.mockRejectedValueOnce(new Error('db down'));
    await expect(service.patch(GUILD, { wordMaxWords: 300 }, ACTOR)).rejects.toThrow();
    await service.wordGameRoute(GUILD);
    expect(prisma.guild.findUnique).toHaveBeenCalledTimes(1);
  });

  it('does not keep an answer read while a write was committing', async () => {
    const { prisma, service } = build();
    let release: (row: unknown) => void = () => undefined;
    prisma.guild.findUnique.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const pending = service.wordGameRoute(GUILD);
    service.forgetWordGameRoute(GUILD);
    release(settingsRow());
    await pending;

    prisma.guild.findUnique.mockResolvedValue(settingsRow({ wordChannelId: CHANNEL }));
    await expect(service.wordGameRoute(GUILD)).resolves.toMatchObject({ channelId: CHANNEL });
  });
});

describe('GuildConfigService wiring', () => {
  it('is built by the container from its three collaborators', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        GuildConfigService,
        { provide: PrismaService, useValue: {} },
        { provide: AuditService, useValue: {} },
        { provide: ChannelAccessService, useValue: {} },
      ],
    }).compile();
    expect(moduleRef.get(GuildConfigService)).toBeInstanceOf(GuildConfigService);
    await moduleRef.close();
  });
});
