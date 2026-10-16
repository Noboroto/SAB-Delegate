import 'reflect-metadata';
import {
  AUDIT_ACTIONS,
  CHATBOT_SUMMARY_EVERY_TURNS,
  ErrorCode,
  type ActorContext,
} from '@sab/shared';
import { Logger } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditService } from '../../common/audit/audit.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { GuildConfigService } from '../guild-config/guild-config.service.js';
import { LlmChatError, type LlmChatService } from '../llm/llm-chat.service.js';
import type { ChatbotConfigService } from './chatbot-config.service.js';
import { ChatbotMemoryService } from './chatbot-memory.service.js';
import type { ChatbotQuotaService } from './chatbot-quota.service.js';

const GUILD = '100000000000000001';
const CHANNEL = '200000000000000001';
const USER = '400000000000000001';
const ACTOR: ActorContext = { source: 'HTTP', userId: '300000000000000001' };
const TARGET = { baseUrl: 'https://llm.example/v1', model: 'm', apiKey: 'k' };
const USAGE = { inputTokens: 100, outputTokens: 50, total: 150, estimated: false };

type Setup = {
  target?: object | null;
  reserve?: object;
  chatText?: string;
  chatError?: Error;
  channelSummary?: string | null;
  userSummary?: string | null;
  /** `false`: the member has too few counted turns to claim. */
  claim?: boolean;
};

function build(setup: Setup = {}) {
  const tx = {
    chatbotChannelMemory: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 2 }),
    },
    chatbotUserMemory: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 3 }),
    },
  };
  const prisma = {
    guild: { findUnique: vi.fn().mockResolvedValue({ id: 'guild-key' }) },
    chatbotChannelMemory: {
      findFirst: vi
        .fn()
        .mockResolvedValue(
          setup.channelSummary == null
            ? null
            : { id: 'channel-row', summary: setup.channelSummary },
        ),
      count: vi.fn().mockResolvedValue(7),
    },
    chatbotUserMemory: {
      findFirst: vi
        .fn()
        .mockResolvedValue(setup.userSummary == null ? null : { summary: setup.userSummary }),
      count: vi.fn().mockResolvedValue(5),
    },
    // Serves the counter (`turns`) and the claim (`id`, `guildId`, `summary`).
    $queryRaw: vi
      .fn()
      .mockResolvedValue(
        setup.claim === false
          ? []
          : [{ turns: 1, id: 'user-row', guildId: 'guild-uuid', summary: setup.userSummary ?? '' }],
      ),
    $executeRaw: vi.fn().mockResolvedValue(1),
    $transaction: vi.fn((run: (client: typeof tx) => unknown) => Promise.resolve(run(tx))),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const guilds = { ensureGuild: vi.fn().mockResolvedValue({ id: 'ensured-key' }) };
  const config = {
    resolveTarget: vi
      .fn()
      .mockResolvedValue(
        setup.target === undefined ? { target: TARGET, source: 'global' } : setup.target,
      ),
  };
  const quota = {
    reserve: vi.fn().mockResolvedValue(setup.reserve ?? { reserved: 900, period: '2026-10' }),
    settle: vi.fn().mockResolvedValue({}),
    refund: vi.fn().mockResolvedValue(undefined),
  };
  const chat = {
    chat: vi.fn(() =>
      setup.chatError !== undefined
        ? Promise.reject(setup.chatError)
        : Promise.resolve({
            text: setup.chatText ?? '{"channel":"kênh mới","user":"người mới"}',
            usage: USAGE,
            cut: false,
          }),
    ),
  };
  const service = new ChatbotMemoryService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    guilds as unknown as GuildConfigService,
    config as unknown as ChatbotConfigService,
    quota as unknown as ChatbotQuotaService,
    chat as unknown as LlmChatService,
  );
  return { service, prisma, tx, audit, guilds, config, quota, chat };
}

const ASK = {
  guildId: GUILD,
  channelId: CHANNEL,
  userId: USER,
  speakerName: 'Bình',
  transcript: [{ authorName: 'Anna', text: 'chào' }],
  recentTurns: [],
  question: 'Mình thích trà',
  answer: 'Ghi nhận',
};

beforeEach(() => {
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});

describe('ChatbotMemoryService (unit)', () => {
  describe('read and getOwn', () => {
    it('returns both summaries and turns an empty one into null', async () => {
      const { service } = build({ channelSummary: 'kênh', userSummary: '' });
      await expect(service.read(GUILD, CHANNEL, USER)).resolves.toEqual({
        channel: 'kênh',
        user: null,
      });
    });

    it('scopes both lookups to the server by its Discord id', async () => {
      const { service, prisma } = build();
      await service.read(GUILD, CHANNEL, USER);
      expect(prisma.chatbotChannelMemory.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { channelId: CHANNEL, guild: { discordId: GUILD } },
        }),
      );
      expect(prisma.chatbotUserMemory.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: USER, guild: { discordId: GUILD } } }),
      );
    });

    it('rejects ids that are not snowflakes before querying', async () => {
      const { service, prisma } = build();
      await expect(service.read(GUILD, 'nope', USER)).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_FAILED,
      });
      await expect(service.getOwn(GUILD, '1')).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_FAILED,
      });
      expect(prisma.chatbotChannelMemory.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('noteTurn', () => {
    it.each([
      [CHATBOT_SUMMARY_EVERY_TURNS - 1, false],
      [CHATBOT_SUMMARY_EVERY_TURNS, true],
      [CHATBOT_SUMMARY_EVERY_TURNS + 3, true],
    ])('with the counter at %i, due is %s', async (turns, due) => {
      const { service, prisma } = build();
      prisma.$queryRaw.mockResolvedValueOnce([{ turns }]);
      await expect(service.noteTurn(GUILD, USER)).resolves.toEqual({ due });
    });

    it('creates the server row when the bot never recorded it', async () => {
      const { service, prisma, guilds } = build();
      prisma.guild.findUnique.mockResolvedValueOnce(null);
      await service.noteTurn(GUILD, USER);
      expect(guilds.ensureGuild).toHaveBeenCalledWith(GUILD);
    });
  });

  describe('summarize', () => {
    it('is skipped without a model, before anything is claimed', async () => {
      const { service, prisma, quota, chat } = build({ target: null });
      await expect(service.summarize(ASK)).resolves.toBe('skipped');
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
      expect(quota.reserve).not.toHaveBeenCalled();
      expect(chat.chat).not.toHaveBeenCalled();
    });

    it('is skipped with no call when the member has too few turns to claim', async () => {
      const { service, quota, chat } = build({ claim: false });
      await expect(service.summarize(ASK)).resolves.toBe('skipped');
      expect(quota.reserve).not.toHaveBeenCalled();
      expect(chat.chat).not.toHaveBeenCalled();
    });

    it('claims a full round of turns in one statement', async () => {
      const { service, prisma } = build();
      await service.summarize(ASK);
      const sql = (prisma.$queryRaw.mock.calls[0]?.[0] as string[]).join('?');
      expect(sql).toContain('"turnsSinceSummary" - ');
      expect(sql).toContain('"turnsSinceSummary" >= ');
      expect(prisma.$queryRaw.mock.calls[0]).toContain(CHATBOT_SUMMARY_EVERY_TURNS);
    });

    it('gives the turns back and skips silently when the speaker has no allowance left', async () => {
      const { service, chat, prisma } = build({ reserve: { exhausted: true, quota: {} } });
      await expect(service.summarize(ASK)).resolves.toBe('skipped');
      expect(chat.chat).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    });

    it('charges the speaker, settles with the real usage and writes by the ids it saw', async () => {
      const { service, quota, chat, tx, prisma } = build({
        channelSummary: 'kênh cũ',
        userSummary: 'người cũ',
      });
      await expect(service.summarize(ASK)).resolves.toBe('updated');

      expect(quota.reserve).toHaveBeenCalledWith(GUILD, USER, expect.any(Number));
      expect(quota.reserve.mock.calls[0]?.[2]).toBeGreaterThan(600);
      expect(chat.chat).toHaveBeenCalledWith(
        TARGET,
        expect.objectContaining({ maxOutputTokens: 600 }),
      );
      expect(JSON.stringify(chat.chat.mock.calls[0])).toContain('người cũ');
      expect(JSON.stringify(chat.chat.mock.calls[0])).toContain('kênh cũ');
      expect(quota.settle).toHaveBeenCalledWith(GUILD, USER, '2026-10', 900, USAGE.total);
      expect(quota.refund).not.toHaveBeenCalled();
      // The counter is not written again: the claim already consumed the turns.
      expect(prisma.$executeRaw).not.toHaveBeenCalled();

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.chatbotUserMemory.updateMany).toHaveBeenCalledWith({
        where: { id: 'user-row' },
        data: { summary: 'người mới' },
      });
      expect(tx.chatbotChannelMemory.updateMany).toHaveBeenCalledWith({
        where: { id: 'channel-row' },
        data: { summary: 'kênh mới' },
      });
      expect(tx.chatbotChannelMemory.createMany).not.toHaveBeenCalled();
    });

    it('creates the channel row only when it did not exist at the start', async () => {
      const { service, tx } = build();
      await service.summarize(ASK);
      expect(tx.chatbotChannelMemory.createMany).toHaveBeenCalledWith({
        data: [{ guildId: 'guild-uuid', channelId: CHANNEL, summary: 'kênh mới' }],
        skipDuplicates: true,
      });
      expect(tx.chatbotChannelMemory.updateMany).not.toHaveBeenCalled();
    });

    it('keeps a previous summary when the model answers with an empty one', async () => {
      const { service, tx } = build({
        chatText: '{"channel":"","user":""}',
        channelSummary: 'kênh cũ',
        userSummary: 'người cũ',
      });
      await expect(service.summarize(ASK)).resolves.toBe('updated');
      expect(tx.chatbotUserMemory.updateMany).not.toHaveBeenCalled();
      expect(tx.chatbotChannelMemory.updateMany).not.toHaveBeenCalled();
      expect(tx.chatbotChannelMemory.createMany).not.toHaveBeenCalled();
    });

    it('never calls the model from inside the transaction', async () => {
      const { service, prisma, chat, tx } = build();
      let chatCallsAtTransaction = -1;
      prisma.$transaction.mockImplementationOnce((run) => {
        chatCallsAtTransaction = chat.chat.mock.calls.length;
        return Promise.resolve(run(tx));
      });
      await service.summarize(ASK);
      expect(chatCallsAtTransaction).toBe(1);
    });

    it('refunds the tokens and returns the turns when the call fails', async () => {
      const { service, quota, prisma } = build({ chatError: new LlmChatError('unreachable') });
      await expect(service.summarize(ASK)).resolves.toBe('failed');
      expect(quota.refund).toHaveBeenCalledWith(GUILD, USER, '2026-10', 900);
      expect(quota.settle).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    });

    it('refunds, returns the turns and rethrows an error that is not a chat failure', async () => {
      const { service, quota, prisma } = build({ chatError: new TypeError('bug') });
      await expect(service.summarize(ASK)).rejects.toThrow('bug');
      expect(quota.refund).toHaveBeenCalledTimes(1);
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    });

    it('still reports the call failed when the refund itself fails', async () => {
      const { service, quota } = build({ chatError: new LlmChatError('unreachable') });
      quota.refund.mockRejectedValueOnce(new Error('db down'));
      await expect(service.summarize(ASK)).resolves.toBe('failed');
    });

    it.each([
      ['prose', 'I could not do that'],
      ['a missing key', '{"channel":"only"}'],
      ['a non-string value', '{"channel":"c","user":42}'],
    ])('settles the spent tokens and keeps the turns consumed on %s', async (_name, chatText) => {
      const { service, quota, prisma, tx } = build({ chatText });
      await expect(service.summarize(ASK)).resolves.toBe('failed');
      expect(quota.settle).toHaveBeenCalledTimes(1);
      expect(quota.refund).not.toHaveBeenCalled();
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(tx.chatbotUserMemory.updateMany).not.toHaveBeenCalled();
    });

    it('still stores the summaries when settling fails', async () => {
      const { service, quota } = build();
      quota.settle.mockRejectedValueOnce(new Error('db down'));
      await expect(service.summarize(ASK)).resolves.toBe('updated');
    });

    it('truncates an oversize summary before the write', async () => {
      const { service, tx } = build({
        chatText: JSON.stringify({ channel: 'c'.repeat(4000), user: 'u' }),
      });
      await service.summarize(ASK);
      const [args] = tx.chatbotChannelMemory.createMany.mock.calls[0] as [
        { data: [{ summary: string }] },
      ];
      expect(args.data[0].summary.length).toBeLessThanOrEqual(1500);
    });
  });

  describe('clear', () => {
    it('counts without deleting or auditing on a dry run', async () => {
      const { service, prisma, audit } = build();
      await expect(service.clear(GUILD, { scope: 'all', dryRun: true }, ACTOR)).resolves.toEqual({
        dryRun: true,
        userMemories: 5,
        channelMemories: 7,
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('a user clear touches only that member in this server', async () => {
      const { service, tx, audit } = build();
      await expect(service.clear(GUILD, { scope: 'user', userId: USER }, ACTOR)).resolves.toEqual({
        dryRun: false,
        userMemories: 3,
        channelMemories: 0,
      });
      expect(tx.chatbotUserMemory.deleteMany).toHaveBeenCalledWith({
        where: { guild: { discordId: GUILD }, userId: USER },
      });
      expect(tx.chatbotChannelMemory.deleteMany).not.toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledWith(
        {
          guildId: GUILD,
          actor: ACTOR,
          action: AUDIT_ACTIONS.chatbotMemoryClear,
          params: { scope: 'user', userId: USER, channelId: undefined, count: 3 },
        },
        tx,
      );
    });

    it('a channel clear touches only that channel in this server', async () => {
      const { service, tx } = build();
      await expect(
        service.clear(GUILD, { scope: 'channel', channelId: CHANNEL }, ACTOR),
      ).resolves.toEqual({ dryRun: false, userMemories: 0, channelMemories: 2 });
      expect(tx.chatbotChannelMemory.deleteMany).toHaveBeenCalledWith({
        where: { guild: { discordId: GUILD }, channelId: CHANNEL },
      });
      expect(tx.chatbotUserMemory.deleteMany).not.toHaveBeenCalled();
    });

    it('an all clear is scoped to the server only', async () => {
      const { service, tx } = build();
      await service.clear(GUILD, { scope: 'all' }, ACTOR);
      expect(tx.chatbotUserMemory.deleteMany).toHaveBeenCalledWith({
        where: { guild: { discordId: GUILD } },
      });
      expect(tx.chatbotChannelMemory.deleteMany).toHaveBeenCalledWith({
        where: { guild: { discordId: GUILD } },
      });
    });

    it.each([
      ['user scope without an id', { scope: 'user' }],
      ['an id the scope does not take', { scope: 'all', userId: USER }],
      ['an unknown scope', { scope: 'everything' }],
    ])('refuses %s before touching the database', async (_name, request) => {
      const { service, prisma } = build();
      await expect(service.clear(GUILD, request, ACTOR)).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_FAILED,
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.chatbotUserMemory.count).not.toHaveBeenCalled();
    });
  });
});
