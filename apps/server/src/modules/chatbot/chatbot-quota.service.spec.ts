import 'reflect-metadata';
import { CHATBOT_DEFAULT_MONTHLY_LIMIT, CHATBOT_LIMIT_MAX, ErrorCode } from '@sab/shared';
import { Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { AuditService } from '../../common/audit/audit.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { GuildConfigService } from '../guild-config/guild-config.service.js';
import { ChatbotQuotaService } from './chatbot-quota.service.js';

const GUILD = '100000000000000001';
const USER = '400000000000000001';

type Setup = {
  /** What `$queryRaw` resolves, call after call. */
  raw?: unknown[][];
  guildKey?: string | null;
  /** The server's default monthly limit, when it set one. */
  defaultLimit?: number;
};

function build(setup: Setup = {}) {
  const queryRaw = vi.fn();
  for (const rows of setup.raw ?? []) queryRaw.mockResolvedValueOnce(rows);
  queryRaw.mockResolvedValue([]);
  const prisma = {
    $queryRaw: queryRaw,
    $executeRaw: vi.fn().mockResolvedValue(1),
    $transaction: vi.fn(),
    guild: {
      findUnique: vi
        .fn()
        .mockResolvedValue(setup.guildKey === null ? null : { id: setup.guildKey ?? 'guild-key' }),
    },
    chatbotUsage: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    chatbotConfig: {
      findFirst: vi
        .fn()
        .mockResolvedValue(
          setup.defaultLimit === undefined ? null : { defaultMonthlyLimit: setup.defaultLimit },
        ),
    },
  };
  const ensureGuild = vi.fn().mockResolvedValue({ id: 'created-key' });
  const service = new ChatbotQuotaService(
    prisma as unknown as PrismaService,
    { record: vi.fn() } as unknown as AuditService,
    { ensureGuild } as unknown as GuildConfigService,
  );
  return { service, prisma, ensureGuild };
}

/** The values bound into a tagged-template call, in order. */
const boundValues = (call: unknown[]): unknown[] => call.slice(1);

describe('ChatbotQuotaService (unit)', () => {
  describe('limitOf', () => {
    it('falls back to the default limit for a server with no rows', async () => {
      const { service } = build({ raw: [[]] });
      await expect(service.limitOf(GUILD, USER, '2026-10')).resolves.toEqual({
        limit: CHATBOT_DEFAULT_MONTHLY_LIMIT,
        bonus: 0,
        used: 0,
        total: CHATBOT_DEFAULT_MONTHLY_LIMIT,
        remaining: CHATBOT_DEFAULT_MONTHLY_LIMIT,
        overridden: false,
      });
    });

    it('never reports a negative remaining when usage passed the total', async () => {
      const { service } = build({
        raw: [[{ limit: 1_000, bonus: 500, used: 2_300, overridden: true }]],
      });
      await expect(service.limitOf(GUILD, USER, '2026-10')).resolves.toMatchObject({
        total: 1_500,
        used: 2_300,
        remaining: 0,
        overridden: true,
      });
    });

    it('rejects ids that are not snowflakes before touching the database', async () => {
      const { service, prisma } = build();
      await expect(service.limitOf('not-an-id', USER)).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_FAILED,
      });
      await expect(service.limitOf(GUILD, '12')).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_FAILED,
      });
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });
  });

  describe('reserve', () => {
    it('reports the reserved amount and the period it was made in', async () => {
      const { service } = build({ raw: [[{ reserved: 200 }]] });
      await expect(
        service.reserve(GUILD, USER, 200, new Date('2026-10-31T16:59:00Z')),
      ).resolves.toEqual({ reserved: 200, period: '2026-10' });
    });

    it('uses the month of the injected clock', async () => {
      const { service, prisma } = build({ raw: [[{ reserved: 1 }]] });
      await expect(
        service.reserve(GUILD, USER, 1, new Date('2026-10-31T17:00:00Z')),
      ).resolves.toMatchObject({ period: '2026-11' });
      expect(prisma.chatbotUsage.createMany).toHaveBeenCalledWith({
        data: [{ guildId: 'guild-key', userId: USER, period: '2026-11' }],
        skipDuplicates: true,
      });
    });

    it('is exhausted, with the month as it stands, when nothing can be reserved', async () => {
      const none = build({
        raw: [[], [{ limit: 1_000, bonus: 0, used: 1_000, overridden: false }]],
      });
      await expect(none.service.reserve(GUILD, USER, 100)).resolves.toEqual({
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
      const zero = build({ raw: [[{ reserved: 0 }]] });
      await expect(zero.service.reserve(GUILD, USER, 100)).resolves.toMatchObject({
        exhausted: true,
      });
    });

    it.each([
      [0, 1],
      [-50, 1],
      [Number.NaN, 1],
      [12.9, 12],
      [5_000_000_000, CHATBOT_LIMIT_MAX],
    ])('clamps an estimate of %s to %s', async (estimate, expected) => {
      const { service, prisma } = build({ raw: [[{ reserved: 1 }]] });
      await service.reserve(GUILD, USER, estimate);
      expect(boundValues(prisma.$queryRaw.mock.calls[0] as unknown[])).toContain(expected);
    });

    it('creates the row of a server the bot is in but has not recorded yet', async () => {
      const { service, prisma, ensureGuild } = build({ guildKey: null, raw: [[{ reserved: 10 }]] });
      await expect(service.reserve(GUILD, USER, 10)).resolves.toMatchObject({ reserved: 10 });
      expect(ensureGuild).toHaveBeenCalledWith(GUILD);
      expect(prisma.chatbotUsage.createMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: [expect.objectContaining({ guildId: 'created-key' })] }),
      );
    });

    it('does not look the server up again when it has a row', async () => {
      const { service, ensureGuild } = build({ raw: [[{ reserved: 10 }]] });
      await service.reserve(GUILD, USER, 10);
      expect(ensureGuild).not.toHaveBeenCalled();
    });
  });

  describe('settle and refund', () => {
    it('returns the month the same statement left', async () => {
      const { service, prisma } = build({
        raw: [[{ limit: 1_000, bonus: 0, used: 120, overridden: false }]],
      });
      await expect(service.settle(GUILD, USER, '2026-10', 300, 120)).resolves.toMatchObject({
        used: 120,
        remaining: 880,
      });
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it('warns and still returns a snapshot when no usage row matched', async () => {
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const { service } = build({ raw: [[], []] });
      await expect(service.settle(GUILD, USER, '2026-10', 10, 10)).resolves.toMatchObject({
        used: 0,
        limit: CHATBOT_DEFAULT_MONTHLY_LIMIT,
      });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain(USER);
      warn.mockRestore();
    });

    it('binds sane numbers for hostile amounts', async () => {
      const { service, prisma } = build({ raw: [[]] });
      await service.settle(GUILD, USER, '2026-10', -5, Number.POSITIVE_INFINITY);
      const bound = boundValues(prisma.$queryRaw.mock.calls[0] as unknown[]);
      expect(bound).toContain(0);
      expect(bound.every((value) => typeof value !== 'number' || Number.isFinite(value))).toBe(
        true,
      );
    });

    it('refunds with a non-negative amount', async () => {
      const { service, prisma } = build();
      await service.refund(GUILD, USER, '2026-10', -9);
      expect(boundValues(prisma.$executeRaw.mock.calls[0] as unknown[])).toContain(0);
    });

    it('warns when a refund matched no row', async () => {
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const { service, prisma } = build();
      prisma.$executeRaw.mockResolvedValue(0);
      await service.refund(GUILD, USER, '2026-10', 10);
      expect(warn).toHaveBeenCalledTimes(1);
      warn.mockRestore();
    });
  });

  describe('admin input', () => {
    const actor = { source: 'HTTP' as const, userId: '300000000000000001' };

    it.each([-1, 1.5, CHATBOT_LIMIT_MAX + 1])('refuses a limit of %s', async (limit) => {
      const { service, prisma } = build();
      await expect(service.setLimit(GUILD, USER, limit, actor)).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_FAILED,
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it.each([0, 1.5, CHATBOT_LIMIT_MAX + 1])('refuses a grant of %s', async (tokens) => {
      const { service, prisma } = build();
      await expect(service.grant(GUILD, USER, tokens, actor)).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_FAILED,
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('previews a limit and a cleared limit without a transaction', async () => {
      const month = { limit: 100, bonus: 5, used: 40, overridden: false };
      const own = build({ raw: [[month]] });
      await expect(
        own.service.setLimit(GUILD, USER, 300, actor, { dryRun: true }),
      ).resolves.toMatchObject({
        limit: 300,
        overridden: true,
        bonus: 5,
        used: 40,
        remaining: 265,
      });
      const cleared = build({
        raw: [[{ ...month, limit: 300, overridden: true }]],
        defaultLimit: 80,
      });
      await expect(
        cleared.service.setLimit(GUILD, USER, null, actor, { dryRun: true }),
      ).resolves.toMatchObject({ limit: 80, overridden: false });
      expect(own.prisma.$transaction).not.toHaveBeenCalled();
      expect(cleared.prisma.$transaction).not.toHaveBeenCalled();
    });

    it('validates a previewed limit and grant like a real one', async () => {
      const { service, prisma } = build();
      await expect(
        service.setLimit(GUILD, USER, -1, actor, { dryRun: true }),
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
      await expect(
        service.grant(GUILD, USER, 0, actor, new Date(), { dryRun: true }),
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('previews a grant with the bonus kept between zero and the ceiling', async () => {
      const month = { limit: 100, bonus: 5, used: 0, overridden: false };
      const up = build({ raw: [[month]] });
      await expect(
        up.service.grant(GUILD, USER, 10, actor, new Date(), { dryRun: true }),
      ).resolves.toMatchObject({ bonus: 15, remaining: 115 });
      const down = build({ raw: [[month]] });
      await expect(
        down.service.grant(GUILD, USER, -50, actor, new Date(), { dryRun: true }),
      ).resolves.toMatchObject({ bonus: 0 });
      expect(up.prisma.$transaction).not.toHaveBeenCalled();
      expect(up.prisma.$executeRaw).not.toHaveBeenCalled();
    });

    it('reports a dry-run reset without opening a transaction', async () => {
      const { service, prisma } = build({
        raw: [[{ limit: 100, bonus: 0, used: 42, overridden: false }]],
      });
      await expect(service.reset(GUILD, USER, actor, { dryRun: true })).resolves.toEqual({
        dryRun: true,
        used: 42,
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    const base = { page: 1, pageSize: 20, order: 'asc' as const };

    it('matches nothing for a search that cannot be a member id, without a query', async () => {
      const { service, prisma } = build();
      await expect(service.list(GUILD, { ...base, q: 'abc%' })).resolves.toMatchObject({
        items: [],
        total: 0,
        defaultLimit: CHATBOT_DEFAULT_MONTHLY_LIMIT,
      });
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('never reports a negative remaining in a row', async () => {
      const { service } = build({
        raw: [[{ userId: USER, used: 9, bonus: 1, limit: 5, overridden: true }], [{ total: 41 }]],
      });
      const page = await service.list(GUILD, base, new Date('2026-10-15T05:00:00Z'));
      expect(page).toEqual({
        items: [{ userId: USER, used: 9, limit: 5, bonus: 1, overridden: true, remaining: 0 }],
        total: 41,
        period: '2026-10',
        defaultLimit: CHATBOT_DEFAULT_MONTHLY_LIMIT,
      });
    });
  });
});
