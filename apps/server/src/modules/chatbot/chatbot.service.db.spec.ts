import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { requireDatabaseUrl } from '../../../../../vitest-test-database.mjs';
import { AuditService } from '../../common/audit/audit.service.js';
import type { ChannelAccessService } from '../../discord/services/channel-access.service.js';
import type { DiscordReadyService } from '../../discord/discord-ready.service.js';
import type { GuildLocaleService } from '../../i18n/guild-locale.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';
import { GuildConfigService } from '../guild-config/guild-config.service.js';
import { LlmChatError, type LlmChatService } from '../llm/llm-chat.service.js';
import type { ChatbotConfigService } from './chatbot-config.service.js';
import type { ChatbotContextService } from './chatbot-context.service.js';
import { ChatbotHistoryService } from './chatbot-history.service.js';
import { ChatbotMemoryService } from './chatbot-memory.service.js';
import { ChatbotPauseService } from '../llm/chatbot-pause.service.js';
import { ChatbotQuotaService } from './chatbot-quota.service.js';
import { ChatbotRecoveryService } from './chatbot-recovery.service.js';
import type { ChatbotListener } from './chatbot.listener.js';
import { ChatbotService } from './chatbot.service.js';

// The same member and channel ids in every server: only the server tells them apart.
const USER = '440000000000002001';
const CHANNEL = '240000000000002001';
const BOT = '940000000000002001';

describe('chatbot reply against Postgres', () => {
  let database: TestDatabase;
  let prisma: PrismaService;
  let guilds: GuildConfigService;
  let quota: ChatbotQuotaService;
  let history: ChatbotHistoryService;
  let service: ChatbotService;
  let nextGuild = 150000000000002000n;
  let nextMessage = 350000000000002000n;
  /** Everything the model was given, one entry per call. */
  const prompts: string[] = [];
  /** What the stubbed model does, by server model name. */
  let behaviour: (model: string) => Promise<unknown>;
  let modelCalls = 0;

  const newMessageId = () => String((nextMessage += 1n));
  const newGuild = async (limit: number) => {
    const discordId = String((nextGuild += 1n));
    const guild = await guilds.ensureGuild(discordId);
    await prisma.chatbotConfig.create({ data: { guildId: guild.id, defaultMonthlyLimit: limit } });
    return { discordId, key: guild.id };
  };
  const remember = async (guild: { key: string }, channel: string, user: string) => {
    await prisma.chatbotChannelMemory.createMany({
      data: [{ guildId: guild.key, channelId: CHANNEL, summary: channel }],
    });
    await prisma.chatbotUserMemory.createMany({
      data: [{ guildId: guild.key, userId: USER, summary: user }],
    });
  };
  const fakeMessage = (guildId: string, id = newMessageId()) => {
    const reply = vi.fn((_options: { content: string }) => Promise.resolve({ id: newMessageId() }));
    const message = {
      id,
      guildId,
      channelId: CHANNEL,
      author: { id: USER },
      cleanContent: `câu hỏi trong ${guildId}`,
      guild: { members: { me: { displayName: 'Sabi' } } },
      client: { user: { id: BOT, displayName: 'Sabi' } },
      reply,
      channel: {
        send: vi.fn(() => Promise.resolve({ id: newMessageId() })),
        sendTyping: vi.fn(() => Promise.resolve(undefined)),
      },
    };
    return { message: message as never, reply, id };
  };
  /** A mention as the listener leaves it: the pending turn exists before the pipeline starts. */
  const takeIn = async (guildId: string) => {
    const incoming = fakeMessage(guildId);
    await history.claimPending({
      guildId,
      channelId: CHANNEL,
      userId: USER,
      triggerMessageId: incoming.id,
      question: 'câu hỏi',
    });
    return incoming;
  };
  const turnsOf = (guildId: string) =>
    prisma.chatbotTurn.findMany({ where: { guild: { discordId: guildId } } });
  const turnOf = (triggerMessageId: string) =>
    prisma.chatbotTurn.findUnique({ where: { triggerMessageId } });
  const answers = (model: string) =>
    Promise.resolve({
      text: `trả lời cho ${model}`,
      usage: { inputTokens: 100, outputTokens: 100, total: 200, estimated: false },
      cut: false,
    });
  const used = async (guildId: string) => (await quota.limitOf(guildId, USER)).used;

  beforeAll(async () => {
    database = await createTestDatabase(requireDatabaseUrl());
    prisma = database.prisma as unknown as PrismaService;
    const audit = new AuditService(prisma);
    guilds = new GuildConfigService(prisma, audit, {
      check: vi.fn().mockResolvedValue('ok'),
    } as unknown as ChannelAccessService);
    quota = new ChatbotQuotaService(prisma, audit, guilds);
    history = new ChatbotHistoryService(prisma, audit, guilds);

    const config = {
      resolveTarget: vi.fn((guildId: string) =>
        Promise.resolve({
          target: { baseUrl: 'https://llm.example/v1', model: guildId, apiKey: 'k' },
          source: 'global' as const,
        }),
      ),
    };
    const llm = {
      chat: vi.fn((target: { model: string }, request: object) => {
        modelCalls += 1;
        prompts.push(JSON.stringify(request));
        return behaviour(target.model);
      }),
    };
    const memory = new ChatbotMemoryService(
      prisma,
      audit,
      guilds,
      config as unknown as ChatbotConfigService,
      quota,
      llm as unknown as LlmChatService,
    );
    const context = {
      collectFrom: vi.fn((message: { id: string; guildId: string }) =>
        Promise.resolve({
          botId: BOT,
          botName: 'Sabi',
          guildName: `Máy chủ ${message.guildId}`,
          channelName: 'chat',
          speaker: { id: USER, name: 'Bình' },
          triggerMessageId: message.id,
          triggerText: `câu hỏi trong ${message.guildId}`,
          messages: [],
          replied: null,
          attachments: [],
        }),
      ),
    };
    service = new ChatbotService(
      config as unknown as ChatbotConfigService,
      quota,
      context as unknown as ChatbotContextService,
      memory,
      history,
      llm as unknown as LlmChatService,
      { resolve: vi.fn().mockResolvedValue('vi') } as unknown as GuildLocaleService,
      new ChatbotPauseService(),
    );
    behaviour = answers;
  });

  afterAll(async () => {
    await service.onModuleDestroy();
    await database.dispose();
  });

  it('keeps two servers with the same member and channel ids completely apart', async () => {
    const a = await newGuild(100_000);
    const b = await newGuild(50_000);
    await remember(a, 'KENH-A-BI-MAT', 'NGUOI-A-BI-MAT');
    await remember(b, 'KENH-B-BI-MAT', 'NGUOI-B-BI-MAT');
    const earlier = (guildId: string, label: string) => ({
      guildId,
      channelId: CHANNEL,
      userId: USER,
      triggerMessageId: newMessageId(),
      replyMessageId: newMessageId(),
      status: 'OK' as const,
      failureReason: null,
      question: `HOI-${label}`,
      answer: `DAP-${label}`,
      model: 'm',
      llmSource: 'global' as const,
      inputTokens: 1,
      outputTokens: 1,
      estimated: false,
      context: { system: 's', channelMessages: [], memory: {}, recentTurns: 0, attachments: [] },
    });
    for (const old of [earlier(a.discordId, 'A'), earlier(b.discordId, 'B')]) {
      await history.claimPending(old);
      await history.finalize(old);
    }

    const first = await takeIn(a.discordId);
    await service.handle(first.message);
    const second = await takeIn(b.discordId);
    await service.handle(second.message);

    const [promptA, promptB] = prompts.slice(-2) as [string, string];
    for (const own of ['KENH-A-BI-MAT', 'NGUOI-A-BI-MAT', 'HOI-A', 'DAP-A']) {
      expect(promptA).toContain(own);
    }
    for (const foreign of ['KENH-B-BI-MAT', 'NGUOI-B-BI-MAT', 'HOI-B', 'DAP-B']) {
      expect(promptA).not.toContain(foreign);
    }
    for (const own of ['KENH-B-BI-MAT', 'NGUOI-B-BI-MAT', 'HOI-B', 'DAP-B']) {
      expect(promptB).toContain(own);
    }
    for (const foreign of ['KENH-A-BI-MAT', 'NGUOI-A-BI-MAT', 'HOI-A', 'DAP-A']) {
      expect(promptB).not.toContain(foreign);
    }

    // Each server spent from its own allowance and shows its own total.
    expect(await used(a.discordId)).toBe(200);
    expect(await used(b.discordId)).toBe(200);
    expect(first.reply.mock.calls[0]?.[0].content).toBe(
      `trả lời cho ${a.discordId}\n-# còn lại 99.800 / 100.000`,
    );
    expect(second.reply.mock.calls[0]?.[0].content).toBe(
      `trả lời cho ${b.discordId}\n-# còn lại 49.800 / 50.000`,
    );

    // One new turn per server, written under the server it happened in, with its own memory.
    for (const [guild, trigger, memory] of [
      [a, first.id, 'NGUOI-A-BI-MAT'],
      [b, second.id, 'NGUOI-B-BI-MAT'],
    ] as const) {
      expect(await turnsOf(guild.discordId)).toHaveLength(2);
      const added = await turnOf(trigger);
      expect(added).toMatchObject({ status: 'OK', userId: USER, channelId: CHANNEL });
      expect(JSON.stringify(added?.context)).toContain(memory);
    }

    // The reply was counted in the member's memory of that server only.
    // Counted in the background after the reply; the service must stay open for later tests.
    await vi.waitFor(async () => {
      const counters = await prisma.chatbotUserMemory.findMany({
        where: { userId: USER, guildId: { in: [a.key, b.key] } },
        select: { guildId: true, turnsSinceSummary: true },
      });
      expect(counters.map((row) => row.turnsSinceSummary)).toEqual([1, 1]);
    });
  });

  it('stores one turn per message, however often it is answered', async () => {
    const guild = await newGuild(100_000);
    const again = await takeIn(guild.discordId);
    await service.handle(again.message);
    await service.handle(fakeMessage(guild.discordId, again.id).message);
    expect(await turnsOf(guild.discordId)).toHaveLength(1);
  });

  it('answers an exhausted member without a model call and records the refusal', async () => {
    const guild = await newGuild(300);
    const calls = modelCalls;
    // The reservation is capped by what is left, and the call really cost 200 + 200.
    behaviour = () =>
      Promise.resolve({
        text: 'dài',
        usage: { inputTokens: 200, outputTokens: 200, total: 400, estimated: false },
        cut: false,
      });
    const answered = await takeIn(guild.discordId);
    await service.handle(answered.message);
    expect(modelCalls).toBe(calls + 1);
    expect(await used(guild.discordId)).toBe(400);

    const refused = await takeIn(guild.discordId);
    await service.handle(refused.message);
    expect(modelCalls).toBe(calls + 1);
    expect(refused.reply.mock.calls[0]?.[0].content).toBe(
      'Bạn đã dùng hết token chatbot của tháng này.\n-# còn lại 0 / 300',
    );
    expect((await turnOf(answered.id))?.status).toBe('OK');
    const turn = await turnOf(refused.id);
    expect(turn?.status).toBe('QUOTA_EXHAUSTED');
    expect(turn?.answer).toBeNull();
    behaviour = answers;
  });

  it('gives the reserved tokens back when the model fails and records the failure', async () => {
    const guild = await newGuild(100_000);
    behaviour = () => Promise.reject(new LlmChatError('unreachable'));
    const failed = await takeIn(guild.discordId);
    await service.handle(failed.message);

    expect(await used(guild.discordId)).toBe(0);
    expect(failed.reply.mock.calls[0]?.[0].content).toBe(
      'Mình chưa lấy được câu trả lời lúc này. Bạn thử lại sau một lát nhé.\n-# còn lại 100.000 / 100.000',
    );
    expect(await turnOf(failed.id)).toMatchObject({
      status: 'FAILED',
      failureReason: 'unreachable',
      answer: null,
      llmSource: 'global',
    });
    behaviour = answers;
  });

  it('keeps the hold on the turn while the model is asked and clears it when the reply ends', async () => {
    const guild = await newGuild(100_000);
    const incoming = await takeIn(guild.discordId);
    let during: Awaited<ReturnType<typeof turnOf>> = null;
    behaviour = async (model) => {
      during = await turnOf(incoming.id);
      return answers(model);
    };
    await service.handle(incoming.message);
    const seen = during as Awaited<ReturnType<typeof turnOf>>;
    expect(seen?.status).toBe('PENDING');
    expect(seen?.period).toMatch(/^\d{4}-\d{2}$/u);
    expect(seen?.reservedTokens).toBeGreaterThan(0);
    const ended = await turnOf(incoming.id);
    expect(ended).toMatchObject({ status: 'OK', reservedTokens: 0 });
    expect(ended?.replyMessageId).toMatch(/^\d+$/u);
    expect(await used(guild.discordId)).toBe(200);
    behaviour = answers;
  });

  it('charges nothing more when a restart gave the hold back while the reply was still running', async () => {
    const guild = await newGuild(100_000);
    const incoming = await takeIn(guild.discordId);
    behaviour = async (model) => {
      // What recovery does to a pending turn: take the hold off the row and refund it.
      await quota.refundTurn(guild.discordId, USER, incoming.id);
      return answers(model);
    };
    await service.handle(incoming.message);
    expect(await used(guild.discordId)).toBe(0);
    expect((await turnOf(incoming.id))?.status).toBe('OK');
    behaviour = answers;
  });

  it('does not answer again a turn whose reply went out but was never finished', async () => {
    const guild = await newGuild(100_000);
    const incoming = await takeIn(guild.discordId);
    // The process dies after the reply is sent and before the turn is closed.
    const finalize = vi.spyOn(history, 'finalize').mockRejectedValueOnce(new Error('killed'));
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    await service.handle(incoming.message);
    finalize.mockRestore();
    warn.mockRestore();
    const cut = await turnOf(incoming.id);
    expect(cut?.status).toBe('PENDING');
    expect(cut?.replyMessageId).toMatch(/^\d+$/u);

    const idle = new Date(Date.now() - 600_000);
    await prisma.chatbotTurn.update({
      where: { triggerMessageId: incoming.id },
      data: { createdAt: idle, updatedAt: idle },
    });
    const enqueue = vi.fn(() => Promise.resolve(true));
    const recovery = new ChatbotRecoveryService(
      history,
      quota,
      {
        routeOf: vi.fn(() => Promise.resolve({ enabled: true })),
      } as unknown as ChatbotConfigService,
      { enqueue } as unknown as ChatbotListener,
      { isStopping: () => false } as unknown as DiscordReadyService,
      { user: null, channels: { fetch: vi.fn(() => Promise.resolve(null)) } },
    );
    await recovery.sweep(new Date());
    expect(enqueue).not.toHaveBeenCalled();
    expect((await turnOf(incoming.id))?.status).toBe('EXPIRED');
    // The reply was settled before it was sent, so nothing is left to give back.
    expect(await used(guild.discordId)).toBe(200);
  });
});
