import 'reflect-metadata';
import {
  CHATBOT_TURN_ANSWER_MAX_CHARS,
  CHATBOT_TURN_QUESTION_MAX_CHARS,
  CHATBOT_RECENT_TURNS,
  CHATBOT_RECENT_TURNS_MAX_CHARS,
  CHATBOT_TURN_CONTEXT_MAX_BYTES,
  ErrorCode,
  type ChatbotTurnRecord,
} from '@sab/shared';
import { Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { AuditService } from '../../common/audit/audit.service.js';
import { ServiceError } from '../../common/errors/service-error.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { GuildConfigService } from '../guild-config/guild-config.service.js';
import { ChatbotHistoryService } from './chatbot-history.service.js';

const GUILD = '100000000000000001';
const USER = '400000000000000001';
const TURN_ID = '019a0000-0000-7000-8000-000000000001';

const TURN: ChatbotTurnRecord = {
  guildId: GUILD,
  channelId: '200000000000000001',
  userId: USER,
  triggerMessageId: '300000000000000001',
  replyMessageId: '300000000000000002',
  status: 'OK',
  failureReason: null,
  question: 'hello',
  answer: 'hi',
  model: 'm',
  llmSource: 'global',
  inputTokens: 1,
  outputTokens: 2,
  estimated: false,
  context: { system: 's', channelMessages: [], memory: {}, recentTurns: 0, attachments: [] },
};

function build(findMany: unknown[] = []) {
  const prisma = {
    chatbotTurn: {
      findMany: vi.fn().mockResolvedValue(findMany),
      findFirst: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    $transaction: vi.fn(),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const ensureGuild = vi.fn().mockResolvedValue({ id: 'guild-key' });
  const service = new ChatbotHistoryService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    { ensureGuild } as unknown as GuildConfigService,
  );
  return { service, prisma, audit, ensureGuild };
}

const recent = (question: string, answer: string | null, n: number) => ({
  triggerMessageId: String(300000000000000100n + BigInt(n)),
  replyMessageId: null,
  question,
  answer,
  createdAt: new Date(2026, 9, 16, 12, n),
});

describe('ChatbotHistoryService (unit)', () => {
  describe('record', () => {
    it('inserts under the server row and ignores a message already stored', async () => {
      const { service, prisma, ensureGuild } = build();
      await service.record(TURN);
      expect(ensureGuild).toHaveBeenCalledWith(GUILD, undefined, undefined);
      expect(prisma.chatbotTurn.createMany).toHaveBeenCalledWith({
        data: [expect.objectContaining({ guildId: 'guild-key', question: 'hello' }) as unknown],
        skipDuplicates: true,
      });
    });

    it('fills a missing reply id only, within the same server', async () => {
      const { service, prisma } = build();
      await service.record(TURN);
      expect(prisma.chatbotTurn.updateMany).toHaveBeenCalledWith({
        where: {
          triggerMessageId: TURN.triggerMessageId,
          guildId: 'guild-key',
          replyMessageId: null,
        },
        data: { replyMessageId: TURN.replyMessageId },
      });
    });

    it('does not touch an existing turn when it has no reply id to add', async () => {
      const { service, prisma } = build();
      await service.record({ ...TURN, replyMessageId: null });
      expect(prisma.chatbotTurn.updateMany).not.toHaveBeenCalled();
    });

    it('writes through the given transaction', async () => {
      const { service, prisma } = build();
      const tx = {
        chatbotTurn: {
          createMany: vi.fn().mockResolvedValue({ count: 1 }),
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
      };
      await service.record(TURN, tx as never);
      expect(tx.chatbotTurn.createMany).toHaveBeenCalledTimes(1);
      expect(prisma.chatbotTurn.createMany).not.toHaveBeenCalled();
    });

    it.each([
      ['an OK turn without an answer', { answer: null }],
      ['a bad snowflake', { channelId: 'abc' }],
      ['a negative token count', { inputTokens: -1 }],
      ['an unknown source', { llmSource: 'other' as never }],
      ['a failure reason that is free text', { failureReason: 'boom: key sk-123' as never }],
    ])('refuses %s', async (_label, patch) => {
      const { service, prisma } = build();
      await expect(service.record({ ...TURN, ...patch })).rejects.toBeInstanceOf(ServiceError);
      expect(prisma.chatbotTurn.createMany).not.toHaveBeenCalled();
    });

    it('cuts a question and an answer over the caps instead of refusing them', async () => {
      const { service, prisma } = build();
      await service.record({
        ...TURN,
        question: 'q'.repeat(CHATBOT_TURN_QUESTION_MAX_CHARS + 10),
        answer: 'a'.repeat(CHATBOT_TURN_ANSWER_MAX_CHARS + 10),
      });
      const [call] = prisma.chatbotTurn.createMany.mock.calls as [[{ data: ChatbotTurnRecord[] }]];
      const stored = call[0].data[0];
      expect(stored?.question).toBe(`${'q'.repeat(CHATBOT_TURN_QUESTION_MAX_CHARS - 1)}…`);
      expect(stored?.answer).toHaveLength(CHATBOT_TURN_ANSWER_MAX_CHARS);
      expect(stored?.answer?.endsWith('…')).toBe(true);
    });

    it('does not leave half a surrogate pair at the cut', async () => {
      const { service, prisma } = build();
      // The 4-byte character straddles the cut point.
      const question = `${'q'.repeat(CHATBOT_TURN_QUESTION_MAX_CHARS - 2)}😀${'q'.repeat(10)}`;
      await service.record({ ...TURN, question });
      const [call] = prisma.chatbotTurn.createMany.mock.calls as [[{ data: ChatbotTurnRecord[] }]];
      const stored = call[0].data[0]?.question ?? '';
      expect(stored.endsWith('…')).toBe(true);
      expect(/\p{Surrogate}/u.test(stored)).toBe(false);
    });

    it('accepts a failed turn without an answer', async () => {
      const { service, prisma } = build();
      await service.record({
        ...TURN,
        status: 'FAILED',
        answer: null,
        failureReason: 'unreachable',
      });
      expect(prisma.chatbotTurn.createMany).toHaveBeenCalledTimes(1);
    });

    it('refuses a snapshot over the size cap', async () => {
      const { service, prisma } = build();
      const context = { ...TURN.context, system: 'x'.repeat(CHATBOT_TURN_CONTEXT_MAX_BYTES) };
      await expect(service.record({ ...TURN, context })).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_FAILED,
      });
      expect(prisma.chatbotTurn.createMany).not.toHaveBeenCalled();
    });
  });

  describe('recentFor', () => {
    it('asks for the member, in this server, answered, within retention, newest first', async () => {
      const { service, prisma } = build();
      const now = new Date('2026-10-16T05:00:00Z');
      await service.recentFor(GUILD, USER, now);
      expect(prisma.chatbotTurn.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            guild: { discordId: GUILD },
            userId: USER,
            status: 'OK',
            createdAt: { gte: new Date('2026-07-18T05:00:00Z') },
          }) as unknown,
          take: CHATBOT_RECENT_TURNS,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        }),
      );
    });

    it('returns the kept turns oldest first', async () => {
      const { service } = build([
        recent('q3', 'a3', 3),
        recent('q2', 'a2', 2),
        recent('q1', 'a1', 1),
      ]);
      const turns = await service.recentFor(GUILD, USER);
      expect(turns.map((turn) => turn.question)).toEqual(['q1', 'q2', 'q3']);
    });

    it('drops the older turns once the character budget is spent', async () => {
      const filler = 'x'.repeat(CHATBOT_RECENT_TURNS_MAX_CHARS - 10);
      const { service } = build([
        recent('new', filler, 3),
        recent('mid', 'y', 2),
        recent('old', 'z', 1),
      ]);
      const turns = await service.recentFor(GUILD, USER);
      // new + mid use cap - 3 characters; old would push past the cap by one.
      expect(turns.map((turn) => turn.question)).toEqual(['mid', 'new']);
    });

    it('keeps nothing rather than skipping the newest turn for an older one', async () => {
      const big = 'x'.repeat(CHATBOT_RECENT_TURNS_MAX_CHARS);
      const { service } = build([recent('new', big, 2), recent('old', 'short', 1)]);
      await expect(service.recentFor(GUILD, USER)).resolves.toEqual([]);
    });

    it('rejects a malformed id', async () => {
      const { service } = build();
      await expect(service.recentFor('x', USER)).rejects.toBeInstanceOf(ServiceError);
    });
  });

  describe('get', () => {
    const stored = (context: unknown) => ({
      id: TURN_ID,
      channelId: TURN.channelId,
      userId: USER,
      triggerMessageId: TURN.triggerMessageId,
      replyMessageId: null,
      status: 'OK',
      failureReason: null,
      question: 'q',
      answer: 'a',
      model: null,
      llmSource: 'weird',
      inputTokens: 0,
      outputTokens: 0,
      estimated: false,
      createdAt: new Date('2026-10-16T00:00:00Z'),
      context,
    });

    it('is null for an id that is not a uuid, without a query', async () => {
      const { service, prisma } = build();
      await expect(service.get(GUILD, 'nope')).resolves.toBeNull();
      expect(prisma.chatbotTurn.findFirst).not.toHaveBeenCalled();
    });

    it('asks for the owner too when one is given', async () => {
      const { service, prisma } = build();
      prisma.chatbotTurn.findFirst.mockResolvedValue(null);
      await service.get(GUILD, TURN_ID, USER);
      expect(prisma.chatbotTurn.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: TURN_ID, guild: { discordId: GUILD }, userId: USER },
        }),
      );
    });

    it('is null when this server has no such turn', async () => {
      const { service, prisma } = build();
      prisma.chatbotTurn.findFirst.mockResolvedValue(null);
      await expect(service.get(GUILD, TURN_ID)).resolves.toBeNull();
      expect(prisma.chatbotTurn.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: TURN_ID, guild: { discordId: GUILD } } }),
      );
    });

    it('fills in what an older snapshot lacks', async () => {
      const { service, prisma } = build();
      prisma.chatbotTurn.findFirst.mockResolvedValue(stored({ system: 'old' }));
      const detail = await service.get(GUILD, TURN_ID);
      expect(detail?.context).toEqual({
        system: 'old',
        channelMessages: [],
        memory: {},
        recentTurns: 0,
        attachments: [],
      });
      expect(detail?.llmSource).toBeNull();
      expect(detail?.createdAt).toBe('2026-10-16T00:00:00.000Z');
    });

    it('returns the turn with a null snapshot, and warns, when the snapshot is unreadable', async () => {
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      try {
        const { service, prisma } = build();
        prisma.chatbotTurn.findFirst.mockResolvedValue(stored({ system: 42 }));
        const detail = await service.get(GUILD, TURN_ID);
        expect(detail).toMatchObject({ id: TURN_ID, question: 'q', context: null });
        expect(warn).toHaveBeenCalledTimes(1);
      } finally {
        warn.mockRestore();
      }
    });
  });

  describe('list', () => {
    it('pushes filters, order and the page to the database', async () => {
      const { service, prisma } = build();
      await service.list(GUILD, {
        page: 3,
        pageSize: 10,
        order: 'desc',
        userId: USER,
        status: 'FAILED',
        from: '2026-10-01T00:00:00.000Z',
        q: '50%',
      });
      const where = expect.objectContaining({
        guild: { discordId: GUILD },
        userId: USER,
        status: 'FAILED',
        createdAt: { gte: new Date('2026-10-01T00:00:00.000Z') },
        // The typed % is escaped, so it is text and not a pattern.
        OR: [
          { question: { contains: '50\\%', mode: 'insensitive' } },
          { answer: { contains: '50\\%', mode: 'insensitive' } },
        ],
      }) as unknown;
      expect(prisma.chatbotTurn.findMany).toHaveBeenCalledWith({
        where,
        select: expect.not.objectContaining({ context: expect.anything() as unknown }) as unknown,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: 20,
        take: 10,
      });
      expect(prisma.chatbotTurn.count).toHaveBeenCalledWith({ where });
    });
  });

  describe('delete', () => {
    const actor = { source: 'HTTP' as const, userId: '300000000000000009' };

    it('refuses a request whose ids do not match its scope', async () => {
      const { service } = build();
      await expect(
        service.delete(GUILD, { scope: 'all', userId: USER, dryRun: false }, actor),
      ).rejects.toBeInstanceOf(ServiceError);
      await expect(
        service.delete(GUILD, { scope: 'turn', dryRun: false }, actor),
      ).rejects.toBeInstanceOf(ServiceError);
    });

    it('counts without deleting or auditing on a dry run', async () => {
      const { service, prisma, audit } = build();
      prisma.chatbotTurn.count.mockResolvedValue(7);
      await expect(
        service.delete(GUILD, { scope: 'user', userId: USER, dryRun: true }, actor),
      ).resolves.toEqual({ dryRun: true, count: 7 });
      expect(prisma.chatbotTurn.deleteMany).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('deletes within the server and audits the count', async () => {
      const { service, prisma, audit } = build([{ id: 'a' }, { id: 'b' }]);
      prisma.chatbotTurn.deleteMany.mockResolvedValue({ count: 2 });
      await expect(
        service.delete(GUILD, { scope: 'user', userId: USER, dryRun: false }, actor),
      ).resolves.toEqual({ dryRun: false, count: 2 });
      expect(prisma.chatbotTurn.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { guild: { discordId: GUILD }, userId: USER } }),
      );
      expect(prisma.chatbotTurn.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['a', 'b'] } },
      });
      expect(audit.record).toHaveBeenCalledWith({
        guildId: GUILD,
        actor,
        action: 'chatbot.history_delete',
        params: { scope: 'user', userId: USER, turnId: undefined, count: 2 },
      });
    });

    it('limits a turn to its owner when one is given, and audits the turn id', async () => {
      const { service, prisma, audit } = build();
      await service.delete(
        GUILD,
        { scope: 'turn', turnId: TURN_ID, userId: USER, dryRun: false },
        actor,
      );
      expect(prisma.chatbotTurn.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { guild: { discordId: GUILD }, id: TURN_ID, userId: USER },
        }),
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          params: { scope: 'turn', userId: USER, turnId: TURN_ID, count: 0 },
        }),
      );
    });

    it('deletes a big server in batches of a thousand', async () => {
      const ids = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `id-${i}` }));
      const { service, prisma } = build();
      prisma.chatbotTurn.findMany.mockResolvedValueOnce(ids(1000)).mockResolvedValueOnce(ids(3));
      prisma.chatbotTurn.deleteMany.mockImplementation(
        ({ where }: { where: { id: { in: string[] } } }) =>
          Promise.resolve({ count: where.id.in.length }),
      );
      await expect(service.delete(GUILD, { scope: 'all', dryRun: false }, actor)).resolves.toEqual({
        dryRun: false,
        count: 1003,
      });
      expect(prisma.chatbotTurn.deleteMany).toHaveBeenCalledTimes(2);
    });
  });

  describe('purgeOlderThan', () => {
    const ids = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `id-${i}` }));

    it('deletes in id batches of a thousand until a short batch', async () => {
      const { service, prisma } = build();
      prisma.chatbotTurn.findMany
        .mockResolvedValueOnce(ids(1000))
        .mockResolvedValueOnce(ids(1000))
        .mockResolvedValueOnce(ids(5));
      prisma.chatbotTurn.deleteMany.mockImplementation(
        ({ where }: { where: { id: { in: string[] } } }) =>
          Promise.resolve({ count: where.id.in.length }),
      );
      await expect(service.purgeOlderThan(90, new Date('2026-10-16T00:00:00Z'))).resolves.toBe(
        2005,
      );
      expect(prisma.chatbotTurn.findMany).toHaveBeenCalledTimes(3);
      expect(prisma.chatbotTurn.findMany.mock.calls[0]?.[0]).toMatchObject({
        where: { createdAt: { lt: new Date('2026-07-18T00:00:00Z') } },
        take: 1000,
      });
    });

    it('does nothing when nothing is old enough', async () => {
      const { service, prisma } = build();
      await expect(service.purgeOlderThan(90)).resolves.toBe(0);
      expect(prisma.chatbotTurn.deleteMany).not.toHaveBeenCalled();
    });

    it('refuses a window that is not a positive number of days', async () => {
      const { service } = build();
      await expect(service.purgeOlderThan(0)).rejects.toBeInstanceOf(ServiceError);
      await expect(service.purgeOlderThan(1.5)).rejects.toBeInstanceOf(ServiceError);
    });
  });
});
