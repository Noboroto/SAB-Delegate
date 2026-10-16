import 'reflect-metadata';
import {
  AUDIT_ACTIONS,
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
  const backdate = (triggerMessageId: string, at: Date) =>
    prisma.chatbotTurn.update({ where: { triggerMessageId }, data: { createdAt: at } });
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

  describe('record', () => {
    it('keeps an answered turn as it is when the message is redelivered and fails', async () => {
      const guild = newGuild();
      const first = turn(guild, { answer: 'the answer' });
      await history.record(first);
      await history.record({
        ...first,
        status: 'FAILED',
        answer: null,
        failureReason: 'unreachable',
        question: 'changed',
        replyMessageId: null,
      });
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

    it('only fills in a reply message id the first write lacked', async () => {
      const guild = newGuild();
      const first = turn(guild, { replyMessageId: null });
      await history.record(first);
      const reply = newMessage();
      await history.record({ ...first, replyMessageId: reply, answer: 'other' });
      await history.record({ ...first, replyMessageId: newMessage() });
      const item = (await history.list(guild, page)).items[0];
      expect(item).toMatchObject({ replyMessageId: reply, answer: 'answer' });
    });

    it('leaves the turn of another server alone when a message id collides', async () => {
      const [a, b] = [newGuild(), newGuild()];
      const mine = turn(a, { replyMessageId: null, answer: 'mine' });
      await history.record(mine);
      await history.record({ ...mine, guildId: b, answer: 'theirs', replyMessageId: newMessage() });
      const row = await prisma.chatbotTurn.findUniqueOrThrow({
        where: { triggerMessageId: mine.triggerMessageId },
      });
      expect(row).toMatchObject({
        guildId: await keyOfGuild(a),
        answer: 'mine',
        replyMessageId: null,
      });
      expect((await history.list(b, page)).total).toBe(0);
    });

    it('cuts a question and an answer over the caps with a visible mark', async () => {
      const guild = newGuild();
      const input = turn(guild, {
        question: 'q'.repeat(CHATBOT_TURN_QUESTION_MAX_CHARS + 50),
        answer: 'a'.repeat(CHATBOT_TURN_ANSWER_MAX_CHARS + 50),
      });
      await history.record(input);
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
      await history.record(input);
      const stored = await prisma.chatbotTurn.findUniqueOrThrow({
        where: { triggerMessageId: input.triggerMessageId },
      });
      const detail = await history.get(guild, stored.id);
      expect(detail?.context).toEqual(input.context);
    });

    it('writes inside the caller transaction and rolls back with it', async () => {
      const guild = newGuild();
      const input = turn(guild);
      await expect(
        prisma.$transaction(async (tx) => {
          await history.record(input, tx);
          throw new Error('abort');
        }),
      ).rejects.toThrow('abort');
      expect(
        await prisma.chatbotTurn.count({ where: { triggerMessageId: input.triggerMessageId } }),
      ).toBe(0);
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
        await history.record(input);
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
      await history.record(mine);
      await history.record(theirs);

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
      await history.record(input);
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
        await history.record(input);
        await backdate(input.triggerMessageId, new Date(now.getTime() - spec.age * DAY_MS));
      }
      await history.record(turn(guild, { question: 'someone else' }));
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
      await history.record(atEdge);
      await history.record(past);
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
      for (const input of [...mine, other]) await history.record(input);

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

    it('lets a turn be deleted only by its owner when an owner is given, and audits the turn id', async () => {
      const guild = newGuild();
      const input = turn(guild);
      await history.record(input);
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
      await history.record(turn(guild));
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
      for (const input of [...old, ...fresh]) await history.record(input);
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
      await history.record(atEdge);
      await history.record(past);
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
      const key = (await history.record(turn(guild)), await keyOfGuild(guild));
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

  describe('table constraints', () => {
    const insert = async (patch: Record<string, unknown>) => {
      const guild = newGuild();
      const key = (await history.record(turn(guild)), await keyOfGuild(guild));
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
      await history.record(input);
      await prisma.guild.delete({ where: { discordId: guild } });
      expect(
        await prisma.chatbotTurn.count({ where: { triggerMessageId: input.triggerMessageId } }),
      ).toBe(0);
    });
  });
});
