import 'reflect-metadata';
import { AUDIT_ACTIONS, CHATBOT_LIMIT_MAX, type ActorContext } from '@sab/shared';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { requireDatabaseUrl } from '../../../../../vitest-test-database.mjs';
import { AuditService } from '../../common/audit/audit.service.js';
import type { ChannelAccessService } from '../../discord/services/channel-access.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';
import { GuildConfigService } from '../guild-config/guild-config.service.js';
import { periodOf } from './chatbot-period.js';
import { ChatbotQuotaService } from './chatbot-quota.service.js';

const ACTOR: ActorContext = { source: 'HTTP', userId: '300000000000000001' };
/** A fixed clock: no spec depends on which month it happens to run in. */
const NOW = new Date('2026-10-15T05:00:00Z');
const PERIOD = periodOf(NOW);

describe('chatbot quota against Postgres', () => {
  let database: TestDatabase;
  let prisma: PrismaService;
  let quota: ChatbotQuotaService;
  let guilds: GuildConfigService;
  let nextGuild = 120000000000001000n;
  let nextUser = 420000000000001000n;

  const newUser = () => String((nextUser += 1n));
  const keyOfGuild = async (discordId: string) =>
    (await prisma.guild.findUniqueOrThrow({ where: { discordId } })).id;
  /** A server whose chatbot default limit is `defaultLimit`. */
  const newGuild = async (defaultLimit = 1_000) => {
    const discordId = String((nextGuild += 1n));
    const guild = await guilds.ensureGuild(discordId);
    await prisma.chatbotConfig.create({
      data: { guildId: guild.id, defaultMonthlyLimit: defaultLimit },
    });
    return discordId;
  };
  const usageRows = async (discordId: string, userId: string) =>
    prisma.chatbotUsage.findMany({
      where: { guild: { discordId }, userId },
      orderBy: { period: 'asc' },
    });
  const audits = async (discordId: string) =>
    prisma.auditLog.findMany({
      where: { guild: { discordId } },
      select: { action: true, params: true },
      orderBy: { createdAt: 'asc' },
    });

  beforeAll(async () => {
    database = await createTestDatabase(requireDatabaseUrl());
    prisma = database.prisma as unknown as PrismaService;
    const audit = new AuditService(prisma);
    guilds = new GuildConfigService(prisma, audit, {
      check: vi.fn().mockResolvedValue('ok'),
    } as unknown as ChannelAccessService);
    quota = new ChatbotQuotaService(prisma, audit, guilds);
  });

  afterAll(async () => {
    await database.dispose();
  });

  it('never hands out more than the limit when reserves race', async () => {
    const guild = await newGuild(1_000);
    const key = await keyOfGuild(guild);
    for (let round = 0; round < 5; round += 1) {
      const user = newUser();
      await prisma.chatbotUsage.create({ data: { guildId: key, userId: user, period: PERIOD } });
      const results = await Promise.all(
        Array.from({ length: 20 }, () => quota.reserve(guild, user, 200, NOW)),
      );
      const granted = results.flatMap((result) => ('reserved' in result ? [result.reserved] : []));
      const total = granted.reduce((sum, value) => sum + value, 0);
      const used = (await usageRows(guild, user))[0]?.used;
      // A reserve is capped at what is left, so there is not even an overdraft here.
      expect(used, `round ${round}`).toBe(total);
      expect(total, `round ${round}`).toBeLessThanOrEqual(1_000 + 200);
      expect(granted, `round ${round}`).toHaveLength(5);
      expect(results.filter((result) => 'exhausted' in result)).toHaveLength(15);
    }
  });

  it('tells an exhausted member their month in the same answer', async () => {
    const guild = await newGuild(1_000);
    const user = newUser();
    await quota.reserve(guild, user, 1_000, NOW);
    await expect(quota.reserve(guild, user, 10, NOW)).resolves.toEqual({
      exhausted: true,
      quota: {
        limit: 1_000,
        bonus: 0,
        used: 1_000,
        total: 1_000,
        remaining: 0,
        overridden: false,
      },
    });
  });

  it('works for a server the bot is in but never recorded', async () => {
    const guild = String((nextGuild += 1n));
    await expect(quota.reserve(guild, newUser(), 50, NOW)).resolves.toMatchObject({ reserved: 50 });
  });

  it('reserves what is left when less than the estimate remains', async () => {
    const guild = await newGuild(1_000);
    const user = newUser();
    await expect(quota.reserve(guild, user, 700, NOW)).resolves.toEqual({
      reserved: 700,
      period: PERIOD,
    });
    await expect(quota.reserve(guild, user, 700, NOW)).resolves.toEqual({
      reserved: 300,
      period: PERIOD,
    });
    await expect(quota.reserve(guild, user, 1, NOW)).resolves.toMatchObject({ exhausted: true });
  });

  describe('settle and refund', () => {
    it('replaces the reservation with the real cost', async () => {
      const guild = await newGuild(1_000);
      const user = newUser();
      const held = await quota.reserve(guild, user, 300, NOW);
      if (!('reserved' in held)) throw new Error('expected a reservation');
      await expect(
        quota.settle(guild, user, held.period, held.reserved, 120),
      ).resolves.toMatchObject({ used: 120, total: 1_000, remaining: 880 });
    });

    it('records an overdraft, leaves nothing remaining and blocks the next call', async () => {
      const guild = await newGuild(1_000);
      const user = newUser();
      const held = await quota.reserve(guild, user, 500, NOW);
      if (!('reserved' in held)) throw new Error('expected a reservation');
      await expect(
        quota.settle(guild, user, held.period, held.reserved, 1_450),
      ).resolves.toMatchObject({ used: 1_450, remaining: 0 });
      await expect(quota.reserve(guild, user, 100, NOW)).resolves.toMatchObject({
        exhausted: true,
      });
    });

    it('refunds back to the earlier usage and never below zero', async () => {
      const guild = await newGuild(1_000);
      const user = newUser();
      await quota.reserve(guild, user, 100, NOW);
      const held = await quota.reserve(guild, user, 250, NOW);
      if (!('reserved' in held)) throw new Error('expected a reservation');
      await quota.refund(guild, user, held.period, held.reserved);
      expect((await usageRows(guild, user))[0]?.used).toBe(100);
      await quota.refund(guild, user, held.period, 5_000);
      expect((await usageRows(guild, user))[0]?.used).toBe(0);
    });

    it('settles into the month it reserved in when the call crosses midnight', async () => {
      const guild = await newGuild(1_000);
      const user = newUser();
      const held = await quota.reserve(guild, user, 200, new Date('2026-10-31T16:59:00Z'));
      if (!('reserved' in held)) throw new Error('expected a reservation');
      await quota.reserve(guild, user, 50, new Date('2026-10-31T17:00:00Z'));
      await quota.settle(guild, user, held.period, held.reserved, 80);
      const rows = await usageRows(guild, user);
      expect(rows.map((row) => [row.period, row.used])).toEqual([
        ['2026-10', 80],
        ['2026-11', 50],
      ]);
    });
  });

  it('starts a fresh month at midnight in the business zone', async () => {
    const guild = await newGuild(1_000);
    const user = newUser();
    await expect(
      quota.reserve(guild, user, 1_000, new Date('2026-10-31T16:59:00Z')),
    ).resolves.toEqual({ reserved: 1_000, period: '2026-10' });
    await expect(
      quota.reserve(guild, user, 1, new Date('2026-10-31T16:59:30Z')),
    ).resolves.toMatchObject({ exhausted: true });
    await expect(
      quota.reserve(guild, user, 400, new Date('2026-10-31T17:00:00Z')),
    ).resolves.toEqual({ reserved: 400, period: '2026-11' });
    await expect(quota.limitOf(guild, user, '2026-10')).resolves.toMatchObject({ used: 1_000 });
    await expect(quota.limitOf(guild, user, '2026-11')).resolves.toMatchObject({ used: 400 });
  });

  it('keeps servers apart for the same member', async () => {
    const [one, two] = [await newGuild(1_000), await newGuild(1_000)];
    const user = newUser();
    await quota.reserve(one, user, 600, NOW);
    await quota.setLimit(one, user, 5_000, ACTOR);
    await quota.grant(one, user, 700, ACTOR, NOW);

    await expect(quota.limitOf(one, user, PERIOD)).resolves.toMatchObject({
      used: 600,
      limit: 5_000,
      bonus: 700,
      overridden: true,
    });
    await expect(quota.limitOf(two, user, PERIOD)).resolves.toMatchObject({
      used: 0,
      limit: 1_000,
      bonus: 0,
      overridden: false,
    });
    await expect(quota.reserve(two, user, 1_000, NOW)).resolves.toMatchObject({ reserved: 1_000 });
    expect((await usageRows(one, user))[0]?.used).toBe(600);
  });

  it('reads the defaults for a server that never configured the chatbot', async () => {
    const guild = String((nextGuild += 1n));
    await guilds.ensureGuild(guild);
    await expect(quota.limitOf(guild, newUser(), PERIOD)).resolves.toMatchObject({
      limit: 100_000,
      remaining: 100_000,
      overridden: false,
    });
  });

  describe('holds kept on a turn', () => {
    let nextMessage = 320000000000001000n;
    /** A pending turn of `user` in `guild`, the row a hold is written on. */
    const pendingTurn = async (guild: string, user: string) => {
      const triggerMessageId = String((nextMessage += 1n));
      const key = await keyOfGuild(guild);
      await prisma.chatbotTurn.create({
        data: {
          guildId: key,
          channelId: '220000000000001001',
          userId: user,
          triggerMessageId,
          status: 'PENDING',
          question: 'q',
          context: { system: '' },
        },
      });
      return triggerMessageId;
    };
    const turnRow = (triggerMessageId: string) =>
      prisma.chatbotTurn.findUniqueOrThrow({ where: { triggerMessageId } });

    it('writes the hold on the turn in the same step that charges the member', async () => {
      const guild = await newGuild(1_000);
      const user = newUser();
      const trigger = await pendingTurn(guild, user);
      const held = await quota.reserveForTurn(guild, user, 300, trigger, NOW);
      expect(held).toEqual({ reserved: 300, period: PERIOD, durable: true });
      expect(await turnRow(trigger)).toMatchObject({ reservedTokens: 300, period: PERIOD });
      expect((await usageRows(guild, user))[0]?.used).toBe(300);
    });

    it('charges a member whose turn is not pending, without a record to keep', async () => {
      const guild = await newGuild(1_000);
      const user = newUser();
      const held = await quota.reserveForTurn(guild, user, 100, '320000000099999999', NOW);
      expect(held).toEqual({ reserved: 100, period: PERIOD, durable: false });
      expect((await usageRows(guild, user))[0]?.used).toBe(100);
    });

    it('reports an exhausted member and writes nothing on the turn', async () => {
      const guild = await newGuild(100);
      const user = newUser();
      await quota.reserve(guild, user, 100, NOW);
      const trigger = await pendingTurn(guild, user);
      const held = await quota.reserveForTurn(guild, user, 50, trigger, NOW);
      expect(held).toMatchObject({ exhausted: true });
      expect(await turnRow(trigger)).toMatchObject({ reservedTokens: 0, period: null });
    });

    it('settles the hold from the row and returns the month as the statement left it', async () => {
      const guild = await newGuild(1_000);
      const user = newUser();
      const trigger = await pendingTurn(guild, user);
      await quota.reserveForTurn(guild, user, 300, trigger, NOW);
      const settled = await quota.settleTurn(guild, user, trigger, 120);
      expect(settled).toMatchObject({ used: 120, remaining: 880 });
      expect((await usageRows(guild, user))[0]?.used).toBe(120);
      expect((await turnRow(trigger)).reservedTokens).toBe(0);
    });

    it('settles in the month the hold was made in', async () => {
      const guild = await newGuild(1_000);
      const user = newUser();
      const trigger = await pendingTurn(guild, user);
      await quota.reserveForTurn(guild, user, 200, trigger, new Date('2026-09-30T12:00:00Z'));
      await quota.settleTurn(guild, user, trigger, 50);
      const rows = await usageRows(guild, user);
      expect(rows.map((row) => [row.period, row.used])).toEqual([['2026-09', 50]]);
    });

    it('lets exactly one of a settle and a refund have the hold', async () => {
      const guild = await newGuild(1_000);
      const user = newUser();
      const trigger = await pendingTurn(guild, user);
      await quota.reserveForTurn(guild, user, 300, trigger, NOW);
      const [settled, refunded] = await Promise.all([
        quota.settleTurn(guild, user, trigger, 100),
        quota.refundTurn(guild, user, trigger),
      ]);
      // Either the settle charged 100 and the refund found nothing, or the other way round.
      const used = (await usageRows(guild, user))[0]?.used;
      if (settled === null) {
        expect([refunded, used]).toEqual([300, 0]);
      } else {
        expect([refunded, used]).toEqual([0, 100]);
      }
    });

    it('refunds once however many callers race for the hold', async () => {
      const guild = await newGuild(1_000);
      const user = newUser();
      const trigger = await pendingTurn(guild, user);
      await quota.reserveForTurn(guild, user, 300, trigger, NOW);
      await quota.reserve(guild, user, 200, NOW);
      const given = await Promise.all(
        Array.from({ length: 6 }, () => quota.refundTurn(guild, user, trigger)),
      );
      expect(given.filter((amount) => amount > 0)).toEqual([300]);
      expect((await usageRows(guild, user))[0]?.used).toBe(200);
    });

    it('gives back nothing and charges nothing for a turn without a hold', async () => {
      const guild = await newGuild(1_000);
      const user = newUser();
      const trigger = await pendingTurn(guild, user);
      await expect(quota.refundTurn(guild, user, trigger)).resolves.toBe(0);
      await expect(quota.settleTurn(guild, user, trigger, 10)).resolves.toBeNull();
      expect(await usageRows(guild, user)).toEqual([]);
    });

    it('reports the month as it stands when the usage row is gone', async () => {
      const guild = await newGuild(1_000);
      const user = newUser();
      const trigger = await pendingTurn(guild, user);
      await quota.reserveForTurn(guild, user, 300, trigger, NOW);
      // The usage row is gone, so the settlement matches nothing; the hold is
      // taken together with it and the call reports the month as it stands.
      await prisma.chatbotUsage.deleteMany({ where: { userId: user } });
      await expect(quota.settleTurn(guild, user, trigger, 10)).resolves.toMatchObject({ used: 0 });
      expect((await turnRow(trigger)).reservedTokens).toBe(0);
    });
  });

  describe('the CHECK constraints', () => {
    it('reject a negative counter, a malformed period and a negative limit', async () => {
      const guild = await newGuild();
      const key = await keyOfGuild(guild);
      const user = newUser();
      await expect(
        prisma.chatbotUsage.create({
          data: { guildId: key, userId: user, period: PERIOD, used: -1 },
        }),
      ).rejects.toThrow();
      await expect(
        prisma.chatbotUsage.create({ data: { guildId: key, userId: user, period: '2026-13' } }),
      ).rejects.toThrow();
      await expect(
        prisma.chatbotUserQuota.create({ data: { guildId: key, userId: user, monthlyLimit: -5 } }),
      ).rejects.toThrow();
    });

    it('are never hit by settle, which clamps used at the ceiling', async () => {
      const guild = await newGuild(CHATBOT_LIMIT_MAX);
      const user = newUser();
      await quota.setLimit(guild, user, CHATBOT_LIMIT_MAX, ACTOR);
      await quota.grant(guild, user, CHATBOT_LIMIT_MAX, ACTOR, NOW);
      const key = await keyOfGuild(guild);
      await prisma.chatbotUsage.update({
        where: { guildId_userId_period: { guildId: key, userId: user, period: PERIOD } },
        data: { used: CHATBOT_LIMIT_MAX - 10 },
      });
      await expect(quota.settle(guild, user, PERIOD, 0, 5_000)).resolves.toMatchObject({
        used: CHATBOT_LIMIT_MAX,
        remaining: CHATBOT_LIMIT_MAX,
      });
    });

    it('are never hit by reserve when the limit and bonus together pass the ceiling', async () => {
      const guild = await newGuild(CHATBOT_LIMIT_MAX);
      const user = newUser();
      await quota.grant(guild, user, CHATBOT_LIMIT_MAX, ACTOR, NOW);
      const key = await keyOfGuild(guild);
      await prisma.chatbotUsage.update({
        where: { guildId_userId_period: { guildId: key, userId: user, period: PERIOD } },
        data: { used: CHATBOT_LIMIT_MAX - 1 },
      });
      await expect(quota.reserve(guild, user, 500, NOW)).resolves.toEqual({
        reserved: 1,
        period: PERIOD,
      });
      expect((await usageRows(guild, user))[0]?.used).toBe(CHATBOT_LIMIT_MAX);
    });
  });

  describe('admin operations', () => {
    it('clamps a negative grant at zero and the bonus at the ceiling', async () => {
      const guild = await newGuild();
      const user = newUser();
      await quota.grant(guild, user, 500, ACTOR, NOW);
      await expect(quota.grant(guild, user, -800, ACTOR, NOW)).resolves.toMatchObject({ bonus: 0 });
      await expect(quota.grant(guild, user, 100, ACTOR, NOW)).resolves.toMatchObject({
        bonus: 100,
      });
      await quota.grant(guild, user, CHATBOT_LIMIT_MAX, ACTOR, NOW);
      await expect(quota.grant(guild, user, CHATBOT_LIMIT_MAX, ACTOR, NOW)).resolves.toMatchObject({
        bonus: CHATBOT_LIMIT_MAX,
      });
    });

    it('creates the usage row when the first thing that happens is a negative grant', async () => {
      const guild = await newGuild();
      const user = newUser();
      await expect(quota.grant(guild, user, -100, ACTOR, NOW)).resolves.toMatchObject({
        bonus: 0,
        used: 0,
      });
    });

    it('overrides the limit, and null brings the default back', async () => {
      const guild = await newGuild(1_000);
      const user = newUser();
      await expect(quota.setLimit(guild, user, 50, ACTOR)).resolves.toMatchObject({
        limit: 50,
        overridden: true,
      });
      await expect(quota.reserve(guild, user, 400, NOW)).resolves.toMatchObject({ reserved: 50 });
      await expect(quota.setLimit(guild, user, 80, ACTOR)).resolves.toMatchObject({ limit: 80 });
      await expect(quota.setLimit(guild, user, null, ACTOR)).resolves.toMatchObject({
        limit: 1_000,
        overridden: false,
      });
      expect(await prisma.chatbotUserQuota.count({ where: { guild: { discordId: guild } } })).toBe(
        0,
      );
    });

    it('lets a zero limit block the member without a reservation', async () => {
      const guild = await newGuild(1_000);
      const user = newUser();
      await quota.setLimit(guild, user, 0, ACTOR);
      await expect(quota.reserve(guild, user, 10, NOW)).resolves.toMatchObject({ exhausted: true });
    });

    it('resets what was spent and keeps the bonus; a dry run changes and audits nothing', async () => {
      const guild = await newGuild(1_000);
      const user = newUser();
      await quota.reserve(guild, user, 300, NOW);
      await quota.grant(guild, user, 50, ACTOR, NOW);
      const before = (await audits(guild)).length;

      await expect(quota.reset(guild, user, ACTOR, { dryRun: true }, NOW)).resolves.toEqual({
        dryRun: true,
        used: 300,
      });
      expect(await audits(guild)).toHaveLength(before);
      expect((await usageRows(guild, user))[0]).toMatchObject({ used: 300, bonus: 50 });

      await expect(quota.reset(guild, user, ACTOR, { dryRun: false }, NOW)).resolves.toEqual({
        dryRun: false,
        used: 300,
      });
      expect((await usageRows(guild, user))[0]).toMatchObject({ used: 0, bonus: 50 });
      await expect(quota.reset(guild, newUser(), ACTOR, { dryRun: false }, NOW)).resolves.toEqual({
        dryRun: false,
        used: 0,
      });
    });

    it('writes one audit row per admin write, with only the allow-listed parameters', async () => {
      const guild = await newGuild(1_000);
      const user = newUser();
      await quota.setLimit(guild, user, 400, ACTOR);
      await quota.grant(guild, user, 25, ACTOR, NOW);
      await quota.reserve(guild, user, 100, NOW);
      await quota.reset(guild, user, ACTOR, { dryRun: false }, NOW);
      await quota.setLimit(guild, user, null, ACTOR);
      expect(await audits(guild)).toEqual([
        { action: AUDIT_ACTIONS.chatbotQuotaSet, params: { userId: user, limit: 400 } },
        {
          action: AUDIT_ACTIONS.chatbotQuotaGrant,
          params: { userId: user, tokens: 25, period: PERIOD },
        },
        {
          action: AUDIT_ACTIONS.chatbotQuotaReset,
          params: { userId: user, period: PERIOD, tokens: 100 },
        },
        { action: AUDIT_ACTIONS.chatbotQuotaSet, params: { userId: user, limit: null } },
      ]);
    });

    it('leaves no audit row and no change behind when the write is refused', async () => {
      const guild = await newGuild();
      const user = newUser();
      await expect(quota.setLimit(guild, user, -1, ACTOR)).rejects.toThrow();
      await expect(quota.grant(guild, user, 0, ACTOR, NOW)).rejects.toThrow();
      expect(await audits(guild)).toEqual([]);
    });
  });

  describe('list', () => {
    it('shows members with usage or an own limit, this month only, sorted and paged', async () => {
      const guild = await newGuild(1_000);
      const [onlyLimit, onlyUsage, both, lastMonth] = [newUser(), newUser(), newUser(), newUser()];
      await quota.setLimit(guild, onlyLimit, 200, ACTOR);
      await quota.reserve(guild, onlyUsage, 300, NOW);
      await quota.setLimit(guild, both, 2_000, ACTOR);
      await quota.reserve(guild, both, 900, NOW);
      await quota.grant(guild, both, 10, ACTOR, NOW);
      await quota.reserve(guild, lastMonth, 700, new Date('2020-01-15T00:00:00Z'));

      const base = { page: 1, pageSize: 20, order: 'asc' as const };
      const all = await quota.list(guild, { ...base, sort: 'used', order: 'desc' }, NOW);
      expect(all.total).toBe(3);
      expect(all.period).toBe('2026-10');
      expect(all.defaultLimit).toBe(1_000);
      expect(all.items).toEqual([
        { userId: both, used: 900, limit: 2_000, bonus: 10, overridden: true, remaining: 1_110 },
        { userId: onlyUsage, used: 300, limit: 1_000, bonus: 0, overridden: false, remaining: 700 },
        { userId: onlyLimit, used: 0, limit: 200, bonus: 0, overridden: true, remaining: 200 },
      ]);

      const byLimit = await quota.list(guild, { ...base, sort: 'limit' }, NOW);
      expect(byLimit.items.map((row) => row.userId)).toEqual([onlyLimit, onlyUsage, both]);

      const second = await quota.list(
        guild,
        { ...base, pageSize: 2, page: 2, sort: 'userId' },
        NOW,
      );
      expect(second.total).toBe(3);
      expect(second.items.map((row) => row.userId)).toEqual([
        [onlyLimit, onlyUsage, both].sort()[2],
      ]);

      const byPrefix = await quota.list(guild, { ...base, q: both.slice(0, 18) }, NOW);
      expect(byPrefix.items.map((row) => row.userId)).toEqual([both]);
    });

    it('does not show another server', async () => {
      const [one, two] = [await newGuild(), await newGuild()];
      await quota.reserve(one, newUser(), 10, NOW);
      await expect(
        quota.list(two, { page: 1, pageSize: 20, order: 'asc' }, NOW),
      ).resolves.toMatchObject({
        items: [],
        total: 0,
      });
    });
  });
});
