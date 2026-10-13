import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { AUDIT_ACTIONS, ErrorCode, type ActorContext } from '@sab/shared';
import { describe, expect, it, vi } from 'vitest';
import { AuditService } from '../../common/audit/audit.service.js';
import { ChannelAccessService } from '../../discord/services/channel-access.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { GuildConfigService } from './guild-config.service.js';

const GUILD = '100000000000000001';
const CHANNEL = '200000000000000001';
const OTHER_CHANNEL = '200000000000000002';
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

function build(options: { usable?: boolean } = {}) {
  const prisma = {
    guild: {
      upsert: vi
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
  const access = {
    botCanRead: vi.fn().mockResolvedValue(options.usable ?? true),
    botCanSend: vi.fn().mockResolvedValue(options.usable ?? true),
  };
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
    const { prisma, audit, service } = build({ usable: false });
    await expect(service.patch(GUILD, { logChannelId: CHANNEL }, ACTOR)).rejects.toEqual(
      failsWith(ErrorCode.DISCORD_CHANNEL_NOT_FOUND),
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('holds the intro channel to read access and the others to send access', async () => {
    const { access, service } = build();
    await service.patch(GUILD, { introChannelId: CHANNEL }, ACTOR);
    expect(access.botCanRead).toHaveBeenCalledWith(CHANNEL);
    expect(access.botCanSend).not.toHaveBeenCalled();

    await service.patch(GUILD, { logChannelId: OTHER_CHANNEL }, ACTOR);
    await service.patch(GUILD, { birthdayChannelId: OTHER_CHANNEL }, ACTOR);
    await service.patch(GUILD, { wordChannelId: OTHER_CHANNEL }, ACTOR);
    expect(access.botCanSend).toHaveBeenCalledTimes(3);
  });

  it('does not ask Discord anything to clear a channel', async () => {
    const { access, service } = build();
    await service.patch(GUILD, { logChannelId: null }, ACTOR);
    expect(access.botCanSend).not.toHaveBeenCalled();
  });

  it('rejects wordMaxWords under 200 and checks no channel for it', async () => {
    const { access, prisma, service } = build();
    await expect(
      service.patch(GUILD, { wordMaxWords: 199, logChannelId: CHANNEL }, ACTOR),
    ).rejects.toEqual(failsWith(ErrorCode.VALIDATION_FAILED));
    expect(access.botCanSend).not.toHaveBeenCalled();
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
    expect(prisma.guild.upsert).not.toHaveBeenCalled();
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
    const { access, service } = build({ usable: false });
    await expect(
      service.patch(GUILD, { birthdayChannelId: CHANNEL }, ACTOR, { dryRun: true }),
    ).rejects.toEqual(failsWith(ErrorCode.DISCORD_CHANNEL_NOT_FOUND));
    expect(access.botCanSend).toHaveBeenCalledWith(CHANNEL);
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
    expect(prisma.guild.upsert).toHaveBeenCalled();
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

describe('GuildConfigService.ensureGuild', () => {
  it('upserts the server by its Discord id and the settings by the server key', async () => {
    const { prisma, service } = build();
    await expect(service.ensureGuild(GUILD, 'SAB')).resolves.toMatchObject({ id: 'guild-uuid' });
    expect(prisma.guild.upsert.mock.calls[0]?.[0]).toMatchObject({
      where: { discordId: GUILD },
      create: { discordId: GUILD, name: 'SAB' },
      update: { name: 'SAB' },
    });
    expect(prisma.guildConfig.createMany.mock.calls[0]?.[0]).toEqual({
      data: [{ guildId: 'guild-uuid' }],
      skipDuplicates: true,
    });
  });

  it('leaves the stored name alone when no name is given', async () => {
    const { prisma, service } = build();
    await service.ensureGuild(GUILD);
    expect(prisma.guild.upsert.mock.calls[0]?.[0]).toHaveProperty('update', {});
  });

  it('works inside the transaction it is handed', async () => {
    const { prisma, service } = build();
    const tx = {
      guild: { upsert: vi.fn().mockResolvedValue({ id: 'tx-guild' }) },
      guildConfig: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
    };
    await service.ensureGuild(GUILD, undefined, tx as never);
    expect(tx.guild.upsert).toHaveBeenCalled();
    expect(prisma.guild.upsert).not.toHaveBeenCalled();
  });

  it('refuses an id that is not a snowflake', async () => {
    const { service } = build();
    await expect(service.ensureGuild('not-an-id')).rejects.toEqual(
      failsWith(ErrorCode.VALIDATION_FAILED),
    );
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
