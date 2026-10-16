import 'reflect-metadata';
import {
  AUDIT_ACTIONS,
  ErrorCode,
  CHATBOT_HISTORY_RETENTION_DAYS,
  CHATBOT_TURN_ANSWER_MAX_CHARS,
  CHATBOT_TURN_QUESTION_MAX_CHARS,
  type ActorContext,
  type ChatbotTurnRecord,
} from '@sab/shared';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { requireDatabaseUrl } from '../../../../../vitest-test-database.mjs';
import { AuditService } from '../../common/audit/audit.service.js';
import type { ChannelAccessService } from '../../discord/services/channel-access.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';
import { GuildConfigService } from '../guild-config/guild-config.service.js';
import { ChatbotHistoryService } from './chatbot-history.service.js';

const ACTOR: ActorContext = { source: 'HTTP', userId: '300000000000000001' };
const DAY_MS = 24 * 60 * 60 * 1000;

describe('chatbot history against Postgres', () => {
  let database: TestDatabase;
  let prisma: PrismaService;
  let history: ChatbotHistoryService;
  let nextGuild = 130000000000001000n;
  let nextUser = 430000000000001000n;
  let nextChannel = 230000000000001000n;
  let nextMessage = 330000000000001000n;

  const newGuild = () => String((nextGuild += 1n));
  const newUser = () => String((nextUser += 1n));
  const newChannel = () => String((nextChannel += 1n));
  const newMessage = () => String((nextMessage += 1n));
  const keyOfGuild = async (discordId: string) =>
    (await prisma.guild.findUniqueOrThrow({ where: { discordId } })).id;

  const turn = (guildId: string, patch: Partial<ChatbotTurnRecord> = {}): ChatbotTurnRecord => ({
    guildId,
    channelId: newChannel(),
    userId: newUser(),
    triggerMessageId: newMessage(),
    replyMessageId: newMessage(),
    status: 'OK',
    failureReason: null,
    question: 'question',
    answer: 'answer',
    model: 'model-x',
    llmSource: 'global',
    inputTokens: 10,
    outputTokens: 20,
    estimated: false,
    context: { system: 'sys', channelMessages: [], memory: {}, recentTurns: 0, attachments: [] },
    ...patch,
  });
  /** A finished turn, the way the pipeline leaves one: taken in, then finished. */
  const store = async (input: ChatbotTurnRecord) => {
    await history.claimPending(input);
    await history.finalize(input);
  };
  const backdate = (triggerMessageId: string, at: Date) =>
    prisma.chatbotTurn.update({ where: { triggerMessageId }, data: { createdAt: at } });
  const statusOfTurn = async (triggerMessageId: string) =>
    (await prisma.chatbotTurn.findUniqueOrThrow({ where: { triggerMessageId } })).status;
  const page = { page: 1, pageSize: 50, order: 'desc' as const };

  beforeAll(async () => {
    database = await createTestDatabase(requireDatabaseUrl());
    prisma = database.prisma as unknown as PrismaService;
    const audit = new AuditService(prisma);
    const guilds = new GuildConfigService(prisma, audit, {
      check: vi.fn().mockResolvedValue('ok'),
    } as unknown as ChannelAccessService);
    history = new ChatbotHistoryService(prisma, audit, guilds);
  });

  afterAll(async () => {
    await database.dispose();
  });

  describe('claimPending', () => {
    it('lets exactly one of ten parallel claims of a message win', async () => {
      const guild = newGuild();
      const input = turn(guild);
      const results = await Promise.all(
        Array.from({ length: 10 }, () => history.claimPending(input)),
      );
      expect(results.filter(Boolean)).toHaveLength(1);
      expect(
        await prisma.chatbotTurn.count({ where: { triggerMessageId: input.triggerMessageId } }),
      ).toBe(1);
    });

    it('writes a pending turn with an empty snapshot that reads back parsed', async () => {
      const guild = newGuild();
      const input = turn(guild, { question: 'asked' });
      await expect(history.claimPending(input)).resolves.toBe(true);
      const stored = await prisma.chatbotTurn.findUniqueOrThrow({
        where: { triggerMessageId: input.triggerMessageId },
      });
      expect(stored).toMatchObject({
        status: 'PENDING',
        question: 'asked',
        answer: null,
        replyMessageId: null,
        reservedTokens: 0,
        period: null,
      });
      await expect(history.get(guild, stored.id)).resolves.toMatchObject({
        status: 'PENDING',
        context: { system: '', channelMessages: [] },
      });
    });

    it('does not claim a message another claim already holds, even finished', async () => {
      const guild = newGuild();
      const input = turn(guild);
      await store(input);
      await expect(history.claimPending(input)).resolves.toBe(false);
    });

    it('cuts a question over the cap', async () => {
      const guild = newGuild();
      const input = turn(guild, { question: 'q'.repeat(CHATBOT_TURN_QUESTION_MAX_CHARS + 5) });
      await history.claimPending(input);
      const stored = await prisma.chatbotTurn.findUniqueOrThrow({
        where: { triggerMessageId: input.triggerMessageId },
      });
      expect(stored.question).toHaveLength(CHATBOT_TURN_QUESTION_MAX_CHARS);
    });
  });

  describe('finalize', () => {
    it('keeps an answered turn as it is when a later failure for the same message arrives', async () => {
      const guild = newGuild();
      const first = turn(guild, { answer: 'the answer' });
      await store(first);
      await expect(
        history.finalize({
          ...first,
          status: 'FAILED',
          answer: null,
          failureReason: 'unreachable',
          question: 'changed',
          replyMessageId: null,
        }),
      ).resolves.toBe(false);
      const { items, total } = await history.list(guild, page);
      expect(total).toBe(1);
      expect(items[0]).toMatchObject({
        status: 'OK',
        answer: 'the answer',
        failureReason: null,
        question: 'question',
        replyMessageId: first.replyMessageId,
      });
    });

    it('does not finish an expired turn', async () => {
      const guild = newGuild();
      const input = turn(guild);
      await history.claimPending(input);
      await expect(history.expirePending(input.triggerMessageId)).resolves.toBe(true);
      await expect(history.finalize(input)).resolves.toBe(false);
      const row = await prisma.chatbotTurn.findUniqueOrThrow({
        where: { triggerMessageId: input.triggerMessageId },
      });
      expect(row.status).toBe('EXPIRED');
    });

    it('does nothing when the message has no turn', async () => {
      await expect(history.finalize(turn(newGuild()))).resolves.toBe(false);
    });

    it('zeroes the hold and keeps a reply id stored earlier when it has none of its own', async () => {
      const guild = newGuild();
      const input = turn(guild, { replyMessageId: null });
      await history.claimPending(input);
      await prisma.chatbotTurn.update({
        where: { triggerMessageId: input.triggerMessageId },
        data: { reservedTokens: 500, period: '2026-10' },
      });
      const reply = newMessage();
      await history.markReplied(input.triggerMessageId, reply);
      await expect(history.finalize(input)).resolves.toBe(true);
      const row = await prisma.chatbotTurn.findUniqueOrThrow({
        where: { triggerMessageId: input.triggerMessageId },
      });
      expect(row).toMatchObject({
        status: 'OK',
        replyMessageId: reply,
        reservedTokens: 0,
        period: '2026-10',
      });
    });

    it('leaves the pending turn of another server alone when a message id collides', async () => {
      const [a, b] = [newGuild(), newGuild()];
      const mine = turn(a, { replyMessageId: null, answer: 'mine' });
      await history.claimPending(mine);
      await expect(
        history.finalize({ ...mine, guildId: b, answer: 'theirs', replyMessageId: newMessage() }),
      ).resolves.toBe(false);
      const row = await prisma.chatbotTurn.findUniqueOrThrow({
        where: { triggerMessageId: mine.triggerMessageId },
      });
      expect(row).toMatchObject({
        guildId: await keyOfGuild(a),
        status: 'PENDING',
        answer: null,
        replyMessageId: null,
      });
      expect((await history.list(b, page)).total).toBe(0);
    });

    it('refuses an outcome that is not final', async () => {
      const guild = newGuild();
      const input = turn(guild);
      await history.claimPending(input);
      await expect(
        history.finalize({ ...input, status: 'PENDING' as never, answer: null }),
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
    });

    it('cuts a question and an answer over the caps with a visible mark', async () => {
      const guild = newGuild();
      const input = turn(guild, {
        question: 'q'.repeat(CHATBOT_TURN_QUESTION_MAX_CHARS + 50),
        answer: 'a'.repeat(CHATBOT_TURN_ANSWER_MAX_CHARS + 50),
      });
      await store(input);
      const item = (await history.list(guild, page)).items[0];
      expect(item?.question).toHaveLength(CHATBOT_TURN_QUESTION_MAX_CHARS);
      expect(item?.question.endsWith('…')).toBe(true);
      expect(item?.answer).toHaveLength(CHATBOT_TURN_ANSWER_MAX_CHARS);
      expect(item?.answer?.endsWith('…')).toBe(true);
    });

    it('stores the snapshot and reads it back parsed', async () => {
      const guild = newGuild();
      const input = turn(guild, {
        context: {
          system: 'sys',
          channelMessages: [
            {
              authorName: 'An',
              authorId: newUser(),
              content: 'hi',
              at: '2026-10-16T01:00:00.000Z',
            },
          ],
          memory: { user: 'likes tea' },
          recentTurns: 2,
          attachments: [{ name: 'a.png', kind: 'image', bytes: 12, included: false, note: 'big' }],
        },
      });
      await store(input);
      const stored = await prisma.chatbotTurn.findUniqueOrThrow({
        where: { triggerMessageId: input.triggerMessageId },
      });
      const detail = await history.get(guild, stored.id);
      expect(detail?.context).toEqual(input.context);
    });
  });

  describe('list', () => {
    it('filters by member, channel, status, time and text, and pages in the database', async () => {
      const guild = newGuild();
      const user = newUser();
      const channel = newChannel();
      const base = new Date('2026-10-10T00:00:00Z').getTime();
      const made: ChatbotTurnRecord[] = [];
      for (let i = 0; i < 5; i += 1) {
        const input = turn(guild, {
          userId: i < 3 ? user : newUser(),
          channelId: i % 2 === 0 ? channel : newChannel(),
          status: i === 4 ? 'FAILED' : 'OK',
          answer: i === 4 ? null : 'answer',
          question: i === 1 ? '100% sure_thing' : `question ${i}`,
        });
        await store(input);
        await backdate(input.triggerMessageId, new Date(base + i * DAY_MS));
        made.push(input);
      }
      const questions = async (query: object) =>
        (await history.list(guild, { ...page, ...query })).items.map((item) => item.question);

      expect(await questions({ userId: user })).toEqual([
        'question 2',
        '100% sure_thing',
        'question 0',
      ]);
      expect(await questions({ channelId: channel, order: 'asc' })).toEqual([
        'question 0',
        'question 2',
        'question 4',
      ]);
      expect(await questions({ status: 'FAILED' })).toEqual(['question 4']);
      expect(
        await questions({
          from: new Date(base + 1 * DAY_MS).toISOString(),
          to: new Date(base + 3 * DAY_MS).toISOString(),
          order: 'asc',
        }),
      ).toEqual(['100% sure_thing', 'question 2', 'question 3']);
      // The search is text, not a pattern: a bare % or _ matches nothing special.
      expect(await questions({ q: '100%' })).toEqual(['100% sure_thing']);
      expect(await questions({ q: '%' })).toEqual(['100% sure_thing']);
      expect(await questions({ q: '_' })).toEqual(['100% sure_thing']);

      const second = await history.list(guild, { page: 2, pageSize: 2, order: 'desc' });
      expect(second.total).toBe(5);
      expect(second.items.map((item) => item.question)).toEqual(['question 2', '100% sure_thing']);
      expect(Object.keys(second.items[0] ?? {})).not.toContain('context');
      expect(Object.keys(second.items[0] ?? {})).not.toContain('guildId');
    });

    it('never shows another server a turn, even for the same member and channel ids', async () => {
      const [a, b] = [newGuild(), newGuild()];
      const user = newUser();
      const channel = newChannel();
      const mine = turn(a, { userId: user, channelId: channel, question: 'in a' });
      const theirs = turn(b, { userId: user, channelId: channel, question: 'in b' });
      await store(mine);
      await store(theirs);

      expect(
        (await history.list(a, { ...page, userId: user })).items.map((i) => i.question),
      ).toEqual(['in a']);
      const theirId = (
        await prisma.chatbotTurn.findUniqueOrThrow({
          where: { triggerMessageId: theirs.triggerMessageId },
        })
      ).id;
      await expect(history.get(a, theirId)).resolves.toBeNull();
      await expect(history.recentFor(a, user)).resolves.toHaveLength(1);
      await expect(
        history.delete(a, { scope: 'turn', turnId: theirId, dryRun: false }, ACTOR),
      ).resolves.toEqual({ dryRun: false, count: 0 });
      await expect(
        history.delete(a, { scope: 'user', userId: user, dryRun: false }, ACTOR),
      ).resolves.toMatchObject({ count: 1 });
      expect((await history.list(b, page)).total).toBe(1);
    });
  });

  describe('get', () => {
    it('returns the turn with a null snapshot when the stored one is unreadable', async () => {
      const guild = newGuild();
      const input = turn(guild);
      await store(input);
      const stored = await prisma.chatbotTurn.update({
        where: { triggerMessageId: input.triggerMessageId },
        data: { context: { system: 5 } },
      });
      await expect(history.get(guild, stored.id)).resolves.toMatchObject({
        id: stored.id,
        context: null,
      });
    });
  });

  describe('recentFor', () => {
    it('returns the answered turns of the member within retention, oldest first', async () => {
      const guild = newGuild();
      const user = newUser();
      const now = new Date('2026-10-16T05:00:00Z');
      const specs = [
        { question: 'too old', age: CHATBOT_HISTORY_RETENTION_DAYS + 1 },
        { question: 'older', age: 3 },
        { question: 'newer', age: 1 },
        { question: 'failed', age: 0.5, status: 'FAILED' as const },
      ];
      for (const spec of specs) {
        const input = turn(guild, {
          userId: user,
          question: spec.question,
          status: spec.status ?? 'OK',
          answer: spec.status === undefined ? 'a' : null,
        });
        await store(input);
        await backdate(input.triggerMessageId, new Date(now.getTime() - spec.age * DAY_MS));
      }
      await store(turn(guild, { question: 'someone else' }));
      const turns = await history.recentFor(guild, user, now);
      expect(turns.map((item) => item.question)).toEqual(['older', 'newer']);
      expect(turns[0]?.createdAt).toBe(new Date(now.getTime() - 3 * DAY_MS).toISOString());
    });

    it('includes a turn exactly at the window edge and leaves out one a millisecond older', async () => {
      const guild = newGuild();
      const user = newUser();
      const now = new Date('2026-10-16T05:00:00Z');
      const edge = new Date(now.getTime() - CHATBOT_HISTORY_RETENTION_DAYS * DAY_MS);
      const atEdge = turn(guild, { userId: user, question: 'at edge' });
      const past = turn(guild, { userId: user, question: 'past edge' });
      await store(atEdge);
      await store(past);
      await backdate(atEdge.triggerMessageId, edge);
      await backdate(past.triggerMessageId, new Date(edge.getTime() - 1));
      const turns = await history.recentFor(guild, user, now);
      expect(turns.map((item) => item.question)).toEqual(['at edge']);
    });
  });

  describe('delete', () => {
    it('counts on a dry run, deletes by scope and audits without the text', async () => {
      const guild = newGuild();
      const user = newUser();
      const mine = [turn(guild, { userId: user }), turn(guild, { userId: user })];
      const other = turn(guild);
      for (const input of [...mine, other]) await store(input);

      await expect(
        history.delete(guild, { scope: 'user', userId: user, dryRun: true }, ACTOR),
      ).resolves.toEqual({ dryRun: true, count: 2 });
      expect((await history.list(guild, page)).total).toBe(3);

      await expect(
        history.delete(guild, { scope: 'user', userId: user, dryRun: false }, ACTOR),
      ).resolves.toEqual({ dryRun: false, count: 2 });
      expect((await history.list(guild, page)).total).toBe(1);

      await expect(history.delete(guild, { scope: 'all', dryRun: false }, ACTOR)).resolves.toEqual({
        dryRun: false,
        count: 1,
      });
      const audits = await prisma.auditLog.findMany({
        where: { guildId: await keyOfGuild(guild) },
        select: { action: true, params: true },
        orderBy: { createdAt: 'asc' },
      });
      expect(audits).toEqual([
        {
          action: AUDIT_ACTIONS.chatbotHistoryDelete,
          params: { scope: 'user', userId: user, count: 2 },
        },
        { action: AUDIT_ACTIONS.chatbotHistoryDelete, params: { scope: 'all', count: 1 } },
      ]);
    });

    it('leaves a pending turn alone: dry run, bulk and single deletes all skip it', async () => {
      const guild = newGuild();
      const user = newUser();
      const done = turn(guild, { userId: user });
      const waiting = turn(guild, { userId: user });
      await store(done);
      await history.claimPending(waiting);
      const waitingId = (
        await prisma.chatbotTurn.findUniqueOrThrow({
          where: { triggerMessageId: waiting.triggerMessageId },
        })
      ).id;
      await expect(history.delete(guild, { scope: 'all', dryRun: true }, ACTOR)).resolves.toEqual({
        dryRun: true,
        count: 1,
      });
      await expect(
        history.delete(guild, { scope: 'turn', turnId: waitingId, dryRun: false }, ACTOR),
      ).resolves.toMatchObject({ count: 0 });
      await expect(
        history.delete(guild, { scope: 'user', userId: user, dryRun: false }, ACTOR),
      ).resolves.toMatchObject({ count: 1 });
      expect(await statusOfTurn(waiting.triggerMessageId)).toBe('PENDING');
    });

    it('lets a turn be deleted only by its owner when an owner is given, and audits the turn id', async () => {
      const guild = newGuild();
      const input = turn(guild);
      await store(input);
      const stored = await prisma.chatbotTurn.findUniqueOrThrow({
        where: { triggerMessageId: input.triggerMessageId },
      });
      const request = { scope: 'turn' as const, turnId: stored.id, dryRun: false };
      await expect(history.get(guild, stored.id, newUser())).resolves.toBeNull();
      await expect(history.get(guild, stored.id, input.userId)).resolves.toMatchObject({
        id: stored.id,
      });
      await expect(
        history.delete(guild, { ...request, userId: newUser() }, ACTOR),
      ).resolves.toEqual({ dryRun: false, count: 0 });
      await expect(
        history.delete(guild, { ...request, userId: input.userId }, ACTOR),
      ).resolves.toEqual({ dryRun: false, count: 1 });
      const audits = await prisma.auditLog.findMany({
        where: { guildId: await keyOfGuild(guild) },
        select: { params: true },
        orderBy: { createdAt: 'asc' },
      });
      expect(audits.at(-1)?.params).toEqual({
        scope: 'turn',
        userId: input.userId,
        turnId: stored.id,
        count: 1,
      });
    });

    it('deletes a server in batches of a thousand', async () => {
      const guild = newGuild();
      await store(turn(guild));
      const key = await keyOfGuild(guild);
      await prisma.chatbotTurn.createMany({
        data: Array.from({ length: 1004 }, () => ({
          guildId: key,
          channelId: newChannel(),
          userId: newUser(),
          triggerMessageId: newMessage(),
          status: 'FAILED' as const,
          question: 'q',
          context: { system: 's' },
        })),
      });
      await expect(history.delete(guild, { scope: 'all', dryRun: false }, ACTOR)).resolves.toEqual({
        dryRun: false,
        count: 1005,
      });
      expect(await prisma.chatbotTurn.count({ where: { guildId: key } })).toBe(0);
    });
  });

  describe('purgeOlderThan', () => {
    it('deletes only turns older than the window, in every server, and is idempotent', async () => {
      const [a, b] = [newGuild(), newGuild()];
      const now = new Date('2026-10-16T05:00:00Z');
      const old = [turn(a), turn(b)];
      const fresh = [turn(a), turn(b)];
      for (const input of [...old, ...fresh]) await store(input);
      for (const input of old) {
        await backdate(input.triggerMessageId, new Date(now.getTime() - 91 * DAY_MS));
      }
      for (const input of fresh) {
        await backdate(input.triggerMessageId, new Date(now.getTime() - 89 * DAY_MS));
      }

      // The purge is global and the test database holds other tests' turns, so
      // compare with what is actually past the window right now.
      const due = await prisma.chatbotTurn.count({
        where: { createdAt: { lt: new Date(now.getTime() - 90 * DAY_MS) } },
      });
      expect(due).toBeGreaterThanOrEqual(2);
      await expect(history.purgeOlderThan(90, now)).resolves.toBe(due);
      await expect(history.purgeOlderThan(90, now)).resolves.toBe(0);
      const left = await prisma.chatbotTurn.findMany({
        where: { triggerMessageId: { in: [...old, ...fresh].map((t) => t.triggerMessageId) } },
        select: { triggerMessageId: true },
      });
      expect(left.map((row) => row.triggerMessageId).sort()).toEqual(
        fresh.map((t) => t.triggerMessageId).sort(),
      );
    });

    it('keeps a turn exactly at the window edge and deletes one a millisecond older', async () => {
      const guild = newGuild();
      const now = new Date('2026-10-16T05:00:00Z');
      const edge = new Date(now.getTime() - 90 * DAY_MS);
      const atEdge = turn(guild);
      const past = turn(guild);
      await store(atEdge);
      await store(past);
      await backdate(atEdge.triggerMessageId, edge);
      await backdate(past.triggerMessageId, new Date(edge.getTime() - 1));
      await history.purgeOlderThan(90, now);
      const left = await prisma.chatbotTurn.findMany({
        where: { guildId: await keyOfGuild(guild) },
        select: { triggerMessageId: true },
      });
      expect(left.map((row) => row.triggerMessageId)).toEqual([atEdge.triggerMessageId]);
    });

    it('works through more than one batch', async () => {
      const guild = newGuild();
      const key = (await store(turn(guild)), await keyOfGuild(guild));
      const longAgo = new Date('2020-01-01T00:00:00Z');
      await prisma.chatbotTurn.createMany({
        data: Array.from({ length: 1005 }, () => ({
          guildId: key,
          channelId: newChannel(),
          userId: newUser(),
          triggerMessageId: newMessage(),
          status: 'FAILED' as const,
          question: 'q',
          context: { system: 's' },
          createdAt: longAgo,
        })),
      });
      // Global purge: other tests' old turns count too.
      const due = await prisma.chatbotTurn.count({
        where: { createdAt: { lt: new Date(Date.now() - 90 * DAY_MS) } },
      });
      expect(due).toBeGreaterThanOrEqual(1005);
      await expect(history.purgeOlderThan(90)).resolves.toBe(due);
      expect(await prisma.chatbotTurn.count({ where: { guildId: key } })).toBe(1);
    });
  });

  describe('reply on a pending turn', () => {
    it('stores the first reply id only, and only while pending', async () => {
      const guild = newGuild();
      const input = turn(guild, { replyMessageId: null });
      await history.claimPending(input);
      const [first, second] = [newMessage(), newMessage()];
      await history.markReplied(input.triggerMessageId, first);
      await history.markReplied(input.triggerMessageId, second);
      const row = await prisma.chatbotTurn.findUniqueOrThrow({
        where: { triggerMessageId: input.triggerMessageId },
      });
      expect(row.replyMessageId).toBe(first);
    });
  });

  describe('pendingBefore and expirePending', () => {
    /** Sets both clocks: the idle guard reads `updatedAt`, which any update would reset. */
    const age = (triggerMessageId: string, at: Date) =>
      prisma.chatbotTurn.update({
        where: { triggerMessageId },
        data: { createdAt: at, updatedAt: at },
      });
    const cutoff = new Date('2026-10-16T05:00:00Z');
    const idleBefore = new Date('2026-10-16T05:00:00Z');
    const list = (take: number, after?: { createdAt: Date; id: string }) =>
      history.pendingBefore({ createdBefore: cutoff, idleBefore, take, after });

    it('lists only idle pending turns older than the cutoff, oldest first', async () => {
      const guild = newGuild();
      const made: string[] = [];
      for (let i = 0; i < 5; i += 1) {
        const input = turn(guild);
        await history.claimPending(input);
        await age(input.triggerMessageId, new Date(cutoff.getTime() - (10 - i) * 1000));
        made.push(input.triggerMessageId);
      }
      const finished = turn(guild);
      await store(finished);
      await age(finished.triggerMessageId, new Date(cutoff.getTime() - 60_000));
      const young = turn(guild);
      await history.claimPending(young);
      await age(young.triggerMessageId, cutoff);
      const busy = turn(guild);
      await history.claimPending(busy);
      await prisma.chatbotTurn.update({
        where: { triggerMessageId: busy.triggerMessageId },
        data: { createdAt: new Date(cutoff.getTime() - 5_000), updatedAt: cutoff },
      });

      const ids = (await list(1000)).map((row) => row.triggerMessageId);
      expect(ids.filter((id) => made.includes(id))).toEqual(made);
      for (const left of [young, finished, busy]) expect(ids).not.toContain(left.triggerMessageId);
      expect((await list(1000)).find((row) => row.triggerMessageId === made[0])?.guildId).toBe(
        guild,
      );
    });

    it('pages by keyset without skipping a turn when the last one read has since ended', async () => {
      const guild = newGuild();
      const made: string[] = [];
      for (let i = 0; i < 6; i += 1) {
        const input = turn(guild);
        await history.claimPending(input);
        // Two share a timestamp: the id has to break the tie.
        await age(
          input.triggerMessageId,
          new Date(cutoff.getTime() - (10 - Math.floor(i / 2)) * 1000),
        );
        made.push(input.triggerMessageId);
      }
      const first = (await list(1000)).filter((row) => made.includes(row.triggerMessageId));
      const firstPage = first.slice(0, 3);
      const last = firstPage.at(-1);
      expect(last).toBeDefined();
      // The row a cursor would sit on leaves the pending state between the pages.
      await history.expirePending(last?.triggerMessageId ?? '');
      const rest = (await list(1000, { createdAt: last?.createdAt ?? cutoff, id: last?.id ?? '' }))
        .filter((row) => made.includes(row.triggerMessageId))
        .map((row) => row.triggerMessageId);
      expect(rest).toEqual(first.slice(3).map((row) => row.triggerMessageId));
    });

    it('expires a pending turn once and leaves a finished one alone', async () => {
      const guild = newGuild();
      const pending = turn(guild);
      const done = turn(guild);
      await history.claimPending(pending);
      await store(done);
      await expect(history.expirePending(pending.triggerMessageId)).resolves.toBe(true);
      await expect(history.expirePending(pending.triggerMessageId)).resolves.toBe(false);
      await expect(history.expirePending(done.triggerMessageId)).resolves.toBe(false);
      const statuses = (await history.list(guild, { ...page, order: 'asc' })).items.map(
        (item) => item.status,
      );
      expect(statuses.sort()).toEqual(['EXPIRED', 'OK']);
    });

    it('never feeds a pending or expired turn to the model as an earlier exchange', async () => {
      const guild = newGuild();
      const user = newUser();
      const pending = turn(guild, { userId: user, question: 'pending' });
      const expired = turn(guild, { userId: user, question: 'expired' });
      await history.claimPending(pending);
      await history.claimPending(expired);
      await history.expirePending(expired.triggerMessageId);
      await expect(history.recentFor(guild, user)).resolves.toEqual([]);
      expect((await history.list(guild, page)).total).toBe(2);
      expect((await history.list(guild, { ...page, status: 'PENDING' })).total).toBe(1);
    });
  });

  describe('table constraints', () => {
    const insert = async (patch: Record<string, unknown>) => {
      const guild = newGuild();
      const key = (await store(turn(guild)), await keyOfGuild(guild));
      return prisma.chatbotTurn.create({
        data: {
          guildId: key,
          channelId: newChannel(),
          userId: newUser(),
          triggerMessageId: newMessage(),
          status: 'FAILED',
          question: 'q',
          context: { system: 's' },
          ...patch,
        },
      });
    };

    it('accepts a minimal failed turn', async () => {
      await expect(insert({})).resolves.toMatchObject({ status: 'FAILED', answer: null });
    });

    it('accepts a hold with its period, and no hold without one', async () => {
      await expect(insert({ reservedTokens: 5, period: '2026-10' })).resolves.toMatchObject({
        reservedTokens: 5,
      });
      await expect(insert({ period: '2026-10' })).resolves.toMatchObject({ reservedTokens: 0 });
    });

    it('accepts a pending and an expired turn without an answer', async () => {
      await expect(insert({ status: 'PENDING' })).resolves.toMatchObject({ status: 'PENDING' });
      await expect(insert({ status: 'EXPIRED' })).resolves.toMatchObject({ status: 'EXPIRED' });
    });

    it('accepts a question of 6000 characters and an answer of 12000', async () => {
      await expect(
        insert({ status: 'OK', question: 'x'.repeat(6000), answer: 'y'.repeat(12_000) }),
      ).resolves.toMatchObject({ status: 'OK' });
    });

    it.each([
      ['a channel id that is not a snowflake', { channelId: 'general' }],
      ['a member id that is not a snowflake', { userId: '12' }],
      ['a trigger message id that is not a snowflake', { triggerMessageId: 'abc' }],
      ['a reply message id that is not a snowflake', { replyMessageId: 'abc' }],
      ['an OK turn with no answer', { status: 'OK', answer: null }],
      ['a question over 6000 characters', { question: 'x'.repeat(6001) }],
      ['an answer over 12000 characters', { status: 'OK', answer: 'x'.repeat(12_001) }],
      ['negative input tokens', { inputTokens: -1 }],
      ['negative output tokens', { outputTokens: -1 }],
      ['a negative hold', { reservedTokens: -1 }],
      ['a hold over a billion tokens', { reservedTokens: 1_000_000_001, period: '2026-10' }],
      ['a period that is not a month', { period: '2026-13' }],
      ['a hold without its period', { reservedTokens: 5, period: null }],
    ])('rejects %s', async (_label, patch) => {
      await expect(insert(patch)).rejects.toThrow(
        /ChatbotTurn_\w+_check|23514|violates check constraint/,
      );
    });

    it('refuses a second turn for the same Discord message', async () => {
      const first = await insert({});
      await expect(insert({ triggerMessageId: first.triggerMessageId })).rejects.toThrow(
        /Unique constraint|triggerMessageId/,
      );
    });

    it("deletes a server's turns with the server", async () => {
      const guild = newGuild();
      const input = turn(guild);
      await store(input);
      await prisma.guild.delete({ where: { discordId: guild } });
      expect(
        await prisma.chatbotTurn.count({ where: { triggerMessageId: input.triggerMessageId } }),
      ).toBe(0);
    });
  });
});
