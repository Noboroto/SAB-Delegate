import 'reflect-metadata';
import { AUDIT_ACTIONS, CHATBOT_SUMMARY_EVERY_TURNS, type ActorContext } from '@sab/shared';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { requireDatabaseUrl } from '../../../../../vitest-test-database.mjs';
import { AuditService } from '../../common/audit/audit.service.js';
import type { ChannelAccessService } from '../../discord/services/channel-access.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';
import { GuildConfigService } from '../guild-config/guild-config.service.js';
import { LlmChatError, type LlmChatService } from '../llm/llm-chat.service.js';
import type { ChatbotConfigService } from './chatbot-config.service.js';
import { ChatbotMemoryService } from './chatbot-memory.service.js';
import { ChatbotQuotaService } from './chatbot-quota.service.js';
import { periodOf } from './chatbot-period.js';

const ACTOR: ActorContext = { source: 'HTTP', userId: '300000000000000001' };
const TARGET = { baseUrl: 'https://llm.example/v1', model: 'm', apiKey: 'k' };
const GOOD = '{"channel":"kênh mới","user":"người mới"}';

describe('chatbot memory against Postgres', () => {
  let database: TestDatabase;
  let prisma: PrismaService;
  let memory: ChatbotMemoryService;
  let quota: ChatbotQuotaService;
  let guilds: GuildConfigService;
  /** What the stubbed model does on its next call. */
  let reply: () => Promise<{ text: string; usage: object; cut: boolean }>;
  let modelCalls = 0;
  let configured = true;
  let nextGuild = 140000000000001000n;
  let nextUser = 440000000000001000n;
  let nextChannel = 240000000000001000n;

  const newUser = () => String((nextUser += 1n));
  const newChannel = () => String((nextChannel += 1n));
  const newGuild = async (defaultLimit = 100_000) => {
    const discordId = String((nextGuild += 1n));
    const guild = await guilds.ensureGuild(discordId);
    await prisma.chatbotConfig.create({
      data: { guildId: guild.id, defaultMonthlyLimit: defaultLimit },
    });
    return discordId;
  };
  const userRow = (guild: string, user: string) =>
    prisma.chatbotUserMemory.findFirst({ where: { userId: user, guild: { discordId: guild } } });
  const channelRow = (guild: string, channel: string) =>
    prisma.chatbotChannelMemory.findFirst({
      where: { channelId: channel, guild: { discordId: guild } },
    });
  const used = async (guild: string, user: string) =>
    (await quota.limitOf(guild, user, periodOf(new Date()))).used;
  const ask = (guildId: string, channelId: string, userId: string) => ({
    guildId,
    channelId,
    userId,
    speakerName: 'Bình',
    transcript: [{ authorName: 'Anna', text: 'chào' }],
    recentTurns: [],
    question: 'Mình thích trà',
    answer: 'Ghi nhận',
  });
  /** Counts a full round of replies, as the pipeline does before it asks for a rewrite. */
  const noteRound = async (guild: string, user: string, turns = CHATBOT_SUMMARY_EVERY_TURNS) => {
    for (let turn = 0; turn < turns; turn += 1) await memory.noteTurn(guild, user);
  };
  const rewrite = async (guild: string, channel: string, user: string) => {
    await noteRound(guild, user);
    return memory.summarize(ask(guild, channel, user));
  };
  const answers = (text: string, total = 120) => {
    reply = () =>
      Promise.resolve({
        text,
        usage: { inputTokens: total - 20, outputTokens: 20, total, estimated: false },
        cut: false,
      });
  };

  beforeAll(async () => {
    database = await createTestDatabase(requireDatabaseUrl());
    prisma = database.prisma as unknown as PrismaService;
    const audit = new AuditService(prisma);
    guilds = new GuildConfigService(prisma, audit, {
      check: vi.fn().mockResolvedValue('ok'),
    } as unknown as ChannelAccessService);
    quota = new ChatbotQuotaService(prisma, audit, guilds);
    const config = {
      resolveTarget: vi.fn(() =>
        Promise.resolve(configured ? { target: TARGET, source: 'global' } : null),
      ),
    };
    const chat = {
      chat: vi.fn(async () => {
        modelCalls += 1;
        return reply();
      }),
    };
    memory = new ChatbotMemoryService(
      prisma,
      audit,
      guilds,
      config as unknown as ChatbotConfigService,
      quota,
      chat as unknown as LlmChatService,
    );
    answers(GOOD);
  });

  afterAll(async () => {
    await database.dispose();
  });

  describe('noteTurn', () => {
    it('counts 20 parallel replies exactly', async () => {
      const guild = await newGuild();
      const user = newUser();
      await Promise.all(Array.from({ length: 20 }, () => memory.noteTurn(guild, user)));
      expect((await userRow(guild, user))?.turnsSinceSummary).toBe(20);
    });

    it('turns due exactly at the configured count, and the first row has an empty summary', async () => {
      const guild = await newGuild();
      const user = newUser();
      for (let turn = 1; turn < CHATBOT_SUMMARY_EVERY_TURNS; turn += 1) {
        await expect(memory.noteTurn(guild, user)).resolves.toEqual({ due: false });
      }
      await expect(memory.noteTurn(guild, user)).resolves.toEqual({ due: true });
      expect((await userRow(guild, user))?.summary).toBe('');
      await expect(memory.getOwn(guild, user)).resolves.toBeNull();
    });

    it('keeps counters of the same member in two servers apart', async () => {
      const [a, b] = [await newGuild(), await newGuild()];
      const user = newUser();
      await memory.noteTurn(a, user);
      await memory.noteTurn(a, user);
      await memory.noteTurn(b, user);
      expect((await userRow(a, user))?.turnsSinceSummary).toBe(2);
      expect((await userRow(b, user))?.turnsSinceSummary).toBe(1);
    });
  });

  describe('summarize', () => {
    it('writes both rows, consumes the claimed turns and charges the speaker', async () => {
      const guild = await newGuild();
      const [user, channel] = [newUser(), newChannel()];
      answers(GOOD, 120);
      await expect(rewrite(guild, channel, user)).resolves.toBe('updated');

      expect(await memory.read(guild, channel, user)).toEqual({
        channel: 'kênh mới',
        user: 'người mới',
      });
      expect((await userRow(guild, user))?.turnsSinceSummary).toBe(0);
      expect(await used(guild, user)).toBe(120);
    });

    it('is skipped with no call while the member has fewer turns than a round', async () => {
      const guild = await newGuild();
      const user = newUser();
      await noteRound(guild, user, CHATBOT_SUMMARY_EVERY_TURNS - 1);
      const before = modelCalls;
      await expect(memory.summarize(ask(guild, newChannel(), user))).resolves.toBe('skipped');
      expect(modelCalls).toBe(before);
      expect((await userRow(guild, user))?.turnsSinceSummary).toBe(CHATBOT_SUMMARY_EVERY_TURNS - 1);
    });

    it('two concurrent summarize calls make one model call and one charge', async () => {
      const guild = await newGuild();
      const [user, channel] = [newUser(), newChannel()];
      await noteRound(guild, user);
      const before = modelCalls;
      answers(GOOD, 120);
      const results = await Promise.all([
        memory.summarize(ask(guild, channel, user)),
        memory.summarize(ask(guild, channel, user)),
      ]);
      expect([...results].sort()).toEqual(['skipped', 'updated']);
      expect(modelCalls - before).toBe(1);
      expect(await used(guild, user)).toBe(120);
    });

    it('keeps a turn counted while the model is working', async () => {
      const guild = await newGuild();
      const [user, channel] = [newUser(), newChannel()];
      await noteRound(guild, user);
      reply = async () => {
        await memory.noteTurn(guild, user);
        return {
          text: GOOD,
          usage: { inputTokens: 1, outputTokens: 1, total: 2, estimated: false },
          cut: false,
        };
      };
      await expect(memory.summarize(ask(guild, channel, user))).resolves.toBe('updated');
      expect((await userRow(guild, user))?.turnsSinceSummary).toBe(1);
      answers(GOOD);
    });

    it('does not bring back memory the member cleared while the model was working', async () => {
      const guild = await newGuild();
      const [user, channel] = [newUser(), newChannel()];
      await rewrite(guild, channel, user);
      await noteRound(guild, user);
      reply = async () => {
        await memory.clear(guild, { scope: 'user', userId: user }, ACTOR);
        return {
          text: GOOD,
          usage: { inputTokens: 1, outputTokens: 1, total: 2, estimated: false },
          cut: false,
        };
      };
      await expect(memory.summarize(ask(guild, channel, user))).resolves.toBe('updated');
      expect(await userRow(guild, user)).toBeNull();
      answers(GOOD);
    });

    it('does not recreate a channel row cleared while the model was working', async () => {
      const guild = await newGuild();
      const [user, channel] = [newUser(), newChannel()];
      await rewrite(guild, channel, user);
      await noteRound(guild, user);
      reply = async () => {
        await memory.clear(guild, { scope: 'channel', channelId: channel }, ACTOR);
        return {
          text: GOOD,
          usage: { inputTokens: 1, outputTokens: 1, total: 2, estimated: false },
          cut: false,
        };
      };
      await memory.summarize(ask(guild, channel, user));
      expect(await channelRow(guild, channel)).toBeNull();
      expect(await userRow(guild, user)).not.toBeNull();
      answers(GOOD);
    });

    it('keeps the earlier summaries when the model answers with empty ones', async () => {
      const guild = await newGuild();
      const [user, channel] = [newUser(), newChannel()];
      await rewrite(guild, channel, user);
      answers('{"channel":"","user":""}');
      await expect(rewrite(guild, channel, user)).resolves.toBe('updated');
      expect(await memory.read(guild, channel, user)).toEqual({
        channel: 'kênh mới',
        user: 'người mới',
      });
      answers(GOOD);
    });

    it('keeps summaries, bills the tokens and waits a full round after an unusable answer', async () => {
      const guild = await newGuild();
      const [user, channel] = [newUser(), newChannel()];
      await rewrite(guild, channel, user);
      await noteRound(guild, user, CHATBOT_SUMMARY_EVERY_TURNS + 2);

      answers('sorry', 77);
      await expect(memory.summarize(ask(guild, channel, user))).resolves.toBe('failed');
      expect((await userRow(guild, user))?.summary).toBe('người mới');
      expect((await channelRow(guild, channel))?.summary).toBe('kênh mới');
      expect((await userRow(guild, user))?.turnsSinceSummary).toBe(2);
      expect(await used(guild, user)).toBe(120 + 77);
      const before = modelCalls;
      await expect(memory.summarize(ask(guild, channel, user))).resolves.toBe('skipped');
      expect(modelCalls).toBe(before);
      answers(GOOD);
    });

    it('refunds the tokens and returns the turns when the call fails', async () => {
      const guild = await newGuild();
      const user = newUser();
      await noteRound(guild, user);
      reply = () => Promise.reject(new LlmChatError('unreachable'));
      await expect(memory.summarize(ask(guild, newChannel(), user))).resolves.toBe('failed');
      expect(await used(guild, user)).toBe(0);
      expect((await userRow(guild, user))?.turnsSinceSummary).toBe(CHATBOT_SUMMARY_EVERY_TURNS);
      answers(GOOD);
    });

    it('is skipped with no call and the turns kept when the allowance is spent', async () => {
      const guild = await newGuild(0);
      const user = newUser();
      await noteRound(guild, user);
      const before = modelCalls;
      await expect(memory.summarize(ask(guild, newChannel(), user))).resolves.toBe('skipped');
      expect(modelCalls).toBe(before);
      expect((await userRow(guild, user))?.turnsSinceSummary).toBe(CHATBOT_SUMMARY_EVERY_TURNS);
    });

    it('is skipped with no call or claim when no model is configured', async () => {
      const guild = await newGuild();
      const user = newUser();
      await noteRound(guild, user);
      const before = modelCalls;
      configured = false;
      try {
        await expect(memory.summarize(ask(guild, newChannel(), user))).resolves.toBe('skipped');
      } finally {
        configured = true;
      }
      expect(modelCalls).toBe(before);
      expect((await userRow(guild, user))?.turnsSinceSummary).toBe(CHATBOT_SUMMARY_EVERY_TURNS);
    });

    it('stores an oversize answer cut to the cap, inside the table CHECK', async () => {
      const guild = await newGuild();
      const [user, channel] = [newUser(), newChannel()];
      answers(JSON.stringify({ channel: 'c'.repeat(9000), user: 'u'.repeat(9000) }));
      await expect(rewrite(guild, channel, user)).resolves.toBe('updated');
      expect((await userRow(guild, user))?.summary).toHaveLength(1500);
      expect((await channelRow(guild, channel))?.summary).toHaveLength(1500);
      answers(GOOD);
    });
  });

  describe('isolation between servers', () => {
    it('reads, writes and clears never cross, for the same member and channel ids', async () => {
      const [a, b] = [await newGuild(), await newGuild()];
      const [user, channel] = [newUser(), newChannel()];
      answers('{"channel":"A kênh","user":"A người"}');
      await rewrite(a, channel, user);
      answers('{"channel":"B kênh","user":"B người"}');
      await rewrite(b, channel, user);
      answers(GOOD);

      expect(await memory.read(a, channel, user)).toEqual({ channel: 'A kênh', user: 'A người' });
      expect(await memory.read(b, channel, user)).toEqual({ channel: 'B kênh', user: 'B người' });

      await expect(memory.clear(a, { scope: 'all', dryRun: true }, ACTOR)).resolves.toEqual({
        dryRun: true,
        userMemories: 1,
        channelMemories: 1,
      });
      await expect(memory.clear(a, { scope: 'all' }, ACTOR)).resolves.toEqual({
        dryRun: false,
        userMemories: 1,
        channelMemories: 1,
      });
      expect(await memory.read(a, channel, user)).toEqual({ channel: null, user: null });
      expect(await memory.read(b, channel, user)).toEqual({ channel: 'B kênh', user: 'B người' });
    });

    it('a user clear leaves other members and the channels of the server alone', async () => {
      const guild = await newGuild();
      const [one, two, channel] = [newUser(), newUser(), newChannel()];
      await rewrite(guild, channel, one);
      await rewrite(guild, channel, two);

      await expect(
        memory.clear(guild, { scope: 'user', userId: one }, { source: 'DISCORD', userId: one }),
      ).resolves.toEqual({ dryRun: false, userMemories: 1, channelMemories: 0 });
      expect(await userRow(guild, one)).toBeNull();
      expect(await userRow(guild, two)).not.toBeNull();
      expect(await channelRow(guild, channel)).not.toBeNull();
    });

    it('a channel clear leaves member memory and other channels alone', async () => {
      const guild = await newGuild();
      const [user, channelA, channelB] = [newUser(), newChannel(), newChannel()];
      await rewrite(guild, channelA, user);
      await rewrite(guild, channelB, user);

      await expect(
        memory.clear(guild, { scope: 'channel', channelId: channelA }, ACTOR),
      ).resolves.toEqual({ dryRun: false, userMemories: 0, channelMemories: 1 });
      expect(await channelRow(guild, channelA)).toBeNull();
      expect(await channelRow(guild, channelB)).not.toBeNull();
      expect(await userRow(guild, user)).not.toBeNull();
    });
  });

  describe('audit', () => {
    it('writes one row per real clear, with ids and a count and no summary text', async () => {
      const guild = await newGuild();
      const [user, channel] = [newUser(), newChannel()];
      await rewrite(guild, channel, user);
      await memory.clear(guild, { scope: 'user', userId: user, dryRun: true }, ACTOR);
      await memory.clear(guild, { scope: 'user', userId: user }, ACTOR);

      const rows = await prisma.auditLog.findMany({
        where: { guild: { discordId: guild } },
        select: { action: true, params: true },
      });
      expect(rows).toEqual([
        {
          action: AUDIT_ACTIONS.chatbotMemoryClear,
          params: { scope: 'user', userId: user, count: 1 },
        },
      ]);
      expect(JSON.stringify(rows)).not.toContain('người mới');
    });
  });
});
