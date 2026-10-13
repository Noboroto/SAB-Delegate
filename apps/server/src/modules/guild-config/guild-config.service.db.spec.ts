import { AUDIT_ACTIONS, ErrorCode, type ActorContext } from '@sab/shared';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { requireDatabaseUrl } from '../../../../../vitest-test-database.mjs';
import { AuditService } from '../../common/audit/audit.service.js';
import type { ChannelAccessService } from '../../discord/services/channel-access.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';
import { GuildConfigService } from './guild-config.service.js';

const ACTOR: ActorContext = { source: 'DISCORD', userId: '100000000000000002' };
const CHANNEL = '200000000000000001';

describe('GuildConfigService against Postgres', () => {
  let database: TestDatabase;
  let prisma: PrismaService;
  let audit: AuditService;
  let service: GuildConfigService;
  let nextGuild = 100000000000000100n;

  // Every test works on its own server so none depends on the others' rows.
  const newGuild = () => String((nextGuild += 1n));

  beforeAll(async () => {
    database = await createTestDatabase(requireDatabaseUrl());
    prisma = database.prisma as unknown as PrismaService;
    audit = new AuditService(prisma);
    const access = {
      botCanRead: vi.fn().mockResolvedValue(true),
      botCanSend: vi.fn().mockResolvedValue(true),
    } as unknown as ChannelAccessService;
    service = new GuildConfigService(prisma, audit, access);
  });

  afterAll(async () => {
    await database.dispose();
  });

  it('keeps one server row and one settings row however often it is ensured', async () => {
    const guildId = newGuild();
    await service.ensureGuild(guildId, 'First name');
    await service.ensureGuild(guildId, 'First name');
    await service.ensureGuild(guildId);

    await expect(prisma.guild.count({ where: { discordId: guildId } })).resolves.toBe(1);
    const guild = await prisma.guild.findUniqueOrThrow({
      where: { discordId: guildId },
      include: { config: true },
    });
    expect(guild.name).toBe('First name');
    expect(guild.locale).toBe('vi');
    expect(guild.config).toMatchObject({ wordMaxWords: 1500, logChannelId: null });
  });

  it('survives the same server being announced concurrently', async () => {
    const guildId = newGuild();
    await Promise.all(Array.from({ length: 8 }, () => service.ensureGuild(guildId, 'Racing')));
    await expect(prisma.guild.count({ where: { discordId: guildId } })).resolves.toBe(1);
    const guild = await prisma.guild.findUniqueOrThrow({ where: { discordId: guildId } });
    await expect(prisma.guildConfig.count({ where: { guildId: guild.id } })).resolves.toBe(1);
  });

  it('follows a rename and keeps the name when an event carries none', async () => {
    const guildId = newGuild();
    await service.ensureGuild(guildId, 'Old name');
    await service.ensureGuild(guildId, 'New name');
    await service.ensureGuild(guildId, undefined);
    const guild = await prisma.guild.findUniqueOrThrow({ where: { discordId: guildId } });
    expect(guild.name).toBe('New name');
  });

  it('writes the change and reads it back, creating the rows for an unrecorded server', async () => {
    const guildId = newGuild();
    const patched = await service.patch(
      guildId,
      { logChannelId: CHANNEL, wordMaxWords: 400, locale: 'en' },
      ACTOR,
    );
    expect(patched).toMatchObject({ logChannelId: CHANNEL, wordMaxWords: 400, locale: 'en' });
    await expect(service.get(guildId)).resolves.toEqual(patched);
  });

  it('changes only what the patch names', async () => {
    const guildId = newGuild();
    await service.patch(guildId, { introChannelId: CHANNEL, wordMaxWords: 700 }, ACTOR);
    await service.patch(guildId, { logChannelId: CHANNEL }, ACTOR);
    await expect(service.get(guildId)).resolves.toMatchObject({
      introChannelId: CHANNEL,
      logChannelId: CHANNEL,
      wordMaxWords: 700,
    });
    await service.patch(guildId, { introChannelId: null }, ACTOR);
    await expect(service.get(guildId)).resolves.toMatchObject({
      introChannelId: null,
      logChannelId: CHANNEL,
    });
  });

  it('records who changed what in the same transaction', async () => {
    const guildId = newGuild();
    await service.patch(guildId, { birthdayChannelId: CHANNEL }, ACTOR);
    await service.patch(guildId, { birthdayChannelId: null }, ACTOR);

    const page = await audit.list({ guildId, action: AUDIT_ACTIONS.guildConfigUpdate });
    expect(page.items.map((item) => item.params)).toEqual([
      { before: { birthdayChannelId: CHANNEL }, after: { birthdayChannelId: null } },
      { before: { birthdayChannelId: null }, after: { birthdayChannelId: CHANNEL } },
    ]);
    expect(page.items[0]).toMatchObject({ source: 'DISCORD', actorDiscordId: ACTOR.userId });
  });

  it('writes neither the change nor an audit row on a dry run', async () => {
    const guildId = newGuild();
    await service.patch(guildId, { logChannelId: CHANNEL }, ACTOR);
    const result = await service.patch(guildId, { logChannelId: null, locale: 'en' }, ACTOR, {
      dryRun: true,
    });
    expect(result.before).toMatchObject({ logChannelId: CHANNEL, locale: 'vi' });
    expect(result.after).toMatchObject({ logChannelId: null, locale: 'en' });
    await expect(service.get(guildId)).resolves.toMatchObject({
      logChannelId: CHANNEL,
      locale: 'vi',
    });
    const page = await audit.list({ guildId });
    expect(page.items).toHaveLength(1);
  });

  it('rolls the change back when its audit row cannot be written', async () => {
    const guildId = newGuild();
    await service.patch(guildId, { logChannelId: CHANNEL }, ACTOR);

    const failingAudit = {
      record: vi.fn().mockRejectedValue(new Error('audit unavailable')),
    } as unknown as AuditService;
    const access = {
      botCanRead: vi.fn().mockResolvedValue(true),
      botCanSend: vi.fn().mockResolvedValue(true),
    } as unknown as ChannelAccessService;
    const strict = new GuildConfigService(prisma, failingAudit, access);

    await expect(
      strict.patch(guildId, { logChannelId: null, locale: 'en' }, ACTOR),
    ).rejects.toThrow('audit unavailable');
    await expect(service.get(guildId)).resolves.toMatchObject({
      logChannelId: CHANNEL,
      locale: 'vi',
    });
  });

  it('answers GUILD_NOT_FOUND for a server that was never recorded', async () => {
    await expect(service.get(newGuild())).rejects.toMatchObject({
      code: ErrorCode.GUILD_NOT_FOUND,
    });
  });
});
