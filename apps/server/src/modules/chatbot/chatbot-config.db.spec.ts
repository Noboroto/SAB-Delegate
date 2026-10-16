import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { AUDIT_ACTIONS, CHATBOT_MAX_CHANNELS, ErrorCode, type ActorContext } from '@sab/shared';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { requireDatabaseUrl } from '../../../../../vitest-test-database.mjs';
import { AuditService } from '../../common/audit/audit.service.js';
import type { ChannelAccessService } from '../../discord/services/channel-access.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';
import { GameChannelService } from '../game-core/game-channel.service.js';
import { GuildConfigService } from '../guild-config/guild-config.service.js';
import type { LlmChatService } from '../llm/llm-chat.service.js';
import { LlmService } from '../llm/llm.service.js';
import { ChatbotPauseService } from '../llm/chatbot-pause.service.js';
import { ChatbotConfigService } from './chatbot-config.service.js';

const ACTOR: ActorContext = { source: 'HTTP', userId: '300000000000000001' };
const URL_A = 'https://api.example.test/v1';
const URL_B = 'https://other.example.test/v1';

describe('chatbot config against Postgres', () => {
  let database: TestDatabase;
  let prisma: PrismaService;
  let chatbot: ChatbotConfigService;
  let games: GameChannelService;
  let guilds: GuildConfigService;
  let nextGuild = 110000000000001000n;
  let nextChannel = 210000000000001000n;
  /** Generated per run, like every secret a spec uses. */
  const llmSecret = randomBytes(32).toString('hex');
  const keyOf = (label: string) => `${label}-${randomBytes(8).toString('hex')}`;

  const newGuild = () => String((nextGuild += 1n));
  const newChannel = () => String((nextChannel += 1n));
  const keyOfGuild = async (discordId: string) =>
    (await prisma.guild.findUniqueOrThrow({ where: { discordId } })).id;
  const auditActions = async (discordId: string) =>
    (
      await prisma.auditLog.findMany({
        where: { guild: { discordId } },
        select: { action: true },
        orderBy: { createdAt: 'asc' },
      })
    ).map((row) => row.action);

  beforeAll(async () => {
    database = await createTestDatabase(requireDatabaseUrl());
    prisma = database.prisma as unknown as PrismaService;
    const audit = new AuditService(prisma);
    const access = { check: vi.fn().mockResolvedValue('ok') };
    guilds = new GuildConfigService(prisma, audit, access as unknown as ChannelAccessService);
    games = new GameChannelService(
      prisma,
      audit,
      guilds,
      access as unknown as ChannelAccessService,
    );
    const pause = new ChatbotPauseService();
    const llm = new LlmService(
      prisma,
      audit,
      { secret: llmSecret, adminGuildId: newGuild() },
      pause,
    );
    chatbot = new ChatbotConfigService(
      prisma,
      audit,
      guilds,
      access as unknown as ChannelAccessService,
      llm,
      { ping: vi.fn().mockResolvedValue(undefined) } as unknown as LlmChatService,
      pause,
    );
  });

  afterAll(async () => {
    await database.dispose();
  });

  it('keeps servers apart: a channel is one server only, the same member ids never mix', async () => {
    const [one, two] = [newGuild(), newGuild()];
    const channel = newChannel();
    await chatbot.addChannel(one, channel, ACTOR);
    await expect(chatbot.addChannel(two, channel, ACTOR)).rejects.toMatchObject({
      code: ErrorCode.CHANNEL_IN_USE,
    });
    await chatbot.configure(two, { enabled: true }, ACTOR);

    const member = '400000000000000001';
    for (const guild of [one, two]) {
      const key = await keyOfGuild(guild);
      await prisma.chatbotUserMemory.create({
        data: { guildId: key, userId: member, summary: `summary of ${guild}` },
      });
    }
    await expect(chatbot.get(one)).resolves.toMatchObject({ enabled: false, channels: [channel] });
    await expect(chatbot.get(two)).resolves.toMatchObject({ enabled: true, channels: [] });
    await expect(chatbot.routeOf(one, channel)).resolves.toEqual({ enabled: false });
    await expect(chatbot.routeOf(two, channel)).resolves.toBeNull();
    // The refused add left no row in the second server.
    expect(await prisma.chatbotChannel.count({ where: { channelId: channel } })).toBe(1);
  });

  it('is idempotent for a channel the server has, and audits only the first add', async () => {
    const guild = newGuild();
    const channel = newChannel();
    await chatbot.addChannel(guild, channel, ACTOR);
    await chatbot.addChannel(guild, channel, ACTOR);
    expect(await auditActions(guild)).toEqual([AUDIT_ACTIONS.chatbotChannelAdd]);
  });

  it('holds the cap when channels are added at the same time', async () => {
    const guild = newGuild();
    const channels = Array.from({ length: CHATBOT_MAX_CHANNELS + 3 }, newChannel);
    const results = await Promise.allSettled(
      channels.map((channel) => chatbot.addChannel(guild, channel, ACTOR)),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(
      CHATBOT_MAX_CHANNELS,
    );
    for (const result of results) {
      if (result.status === 'rejected') {
        expect(result.reason).toMatchObject({ code: ErrorCode.CHATBOT_CHANNEL_LIMIT_REACHED });
      }
    }
    expect(await prisma.chatbotChannel.count({ where: { guild: { discordId: guild } } })).toBe(
      CHATBOT_MAX_CHANNELS,
    );
  });

  describe('a channel is claimed by one feature', () => {
    it('refuses a chatbot channel to a game, and a game channel to the chatbot', async () => {
      const guild = newGuild();
      const [botChannel, gameChannel] = [newChannel(), newChannel()];
      await chatbot.addChannel(guild, botChannel, ACTOR);
      await expect(games.set(guild, 'COUNTING', botChannel, ACTOR)).resolves.toEqual({
        status: 'TAKEN',
        game: 'CHATBOT',
      });
      await expect(games.set(guild, 'COUNTING', gameChannel, ACTOR)).resolves.toEqual({
        status: 'OK',
      });
      await expect(chatbot.addChannel(guild, gameChannel, ACTOR)).rejects.toMatchObject({
        code: ErrorCode.CHANNEL_IN_USE,
      });
    });

    it('refuses the word chain channel both ways', async () => {
      const guild = newGuild();
      const [botChannel, wordChannel] = [newChannel(), newChannel()];
      await chatbot.addChannel(guild, botChannel, ACTOR);
      await expect(guilds.patch(guild, { wordChannelId: botChannel }, ACTOR)).rejects.toMatchObject(
        { code: ErrorCode.CHANNEL_IN_USE },
      );
      await guilds.patch(guild, { wordChannelId: wordChannel }, ACTOR);
      await expect(chatbot.addChannel(guild, wordChannel, ACTOR)).rejects.toMatchObject({
        code: ErrorCode.CHANNEL_IN_USE,
      });
    });

    it('lets exactly one of a chatbot add and a game set win the same channel', async () => {
      for (let round = 0; round < 8; round += 1) {
        const guild = newGuild();
        const channel = newChannel();
        const [added, set] = await Promise.allSettled([
          chatbot.addChannel(guild, channel, ACTOR),
          games.set(guild, 'COUNTING', channel, ACTOR),
        ]);
        const chatbotWon = added.status === 'fulfilled';
        const gameWon = set.status === 'fulfilled' && set.value.status === 'OK';
        expect(chatbotWon !== gameWon, `round ${round}`).toBe(true);
        expect(await prisma.chatbotChannel.count({ where: { channelId: channel } })).toBe(
          chatbotWon ? 1 : 0,
        );
        expect(await prisma.gameChannel.count({ where: { channelId: channel } })).toBe(
          gameWon ? 1 : 0,
        );
      }
    });

    it('lets exactly one of a chatbot add and a word channel change win the same channel', async () => {
      for (let round = 0; round < 8; round += 1) {
        const guild = newGuild();
        const channel = newChannel();
        const [added, patched] = await Promise.allSettled([
          chatbot.addChannel(guild, channel, ACTOR),
          guilds.patch(guild, { wordChannelId: channel }, ACTOR),
        ]);
        expect(
          (added.status === 'fulfilled') !== (patched.status === 'fulfilled'),
          `round ${round}`,
        ).toBe(true);
      }
    });
  });

  it('removes the channel together with its memory, and leaves the other channels alone', async () => {
    const guild = newGuild();
    const [gone, kept] = [newChannel(), newChannel()];
    await chatbot.addChannel(guild, gone, ACTOR);
    await chatbot.addChannel(guild, kept, ACTOR);
    const key = await keyOfGuild(guild);
    await prisma.chatbotChannelMemory.createMany({
      data: [
        { guildId: key, channelId: gone, summary: 'about the removed channel' },
        { guildId: key, channelId: kept, summary: 'about the kept channel' },
      ],
    });

    await chatbot.removeChannel(guild, gone, ACTOR);
    expect(
      (await prisma.chatbotChannelMemory.findMany({ where: { guildId: key } })).map(
        (row) => row.channelId,
      ),
    ).toEqual([kept]);
    await expect(chatbot.get(guild)).resolves.toMatchObject({ channels: [kept] });
    await expect(chatbot.routeOf(guild, gone)).resolves.toBeNull();

    await chatbot.removeChannel(guild, gone, ACTOR);
    expect(await auditActions(guild)).toEqual([
      AUDIT_ACTIONS.chatbotChannelAdd,
      AUDIT_ACTIONS.chatbotChannelAdd,
      AUDIT_ACTIONS.chatbotChannelRemove,
    ]);
  });

  it('refuses an empty patch without a row, a bump or an audit entry', async () => {
    const guild = newGuild();
    await chatbot.configure(guild, { enabled: true }, ACTOR);
    const before = await prisma.chatbotConfig.findFirstOrThrow({
      where: { guild: { discordId: guild } },
    });
    await expect(chatbot.configure(guild, {}, ACTOR)).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_FAILED,
    });
    const after = await prisma.chatbotConfig.findFirstOrThrow({
      where: { guild: { discordId: guild } },
    });
    expect(after.updatedAt).toEqual(before.updatedAt);
    expect(await auditActions(guild)).toEqual([AUDIT_ACTIONS.chatbotConfigure]);
  });

  it('patches one field without touching the other, and audits the old and new value', async () => {
    const guild = newGuild();
    await chatbot.configure(guild, { enabled: true }, ACTOR);
    await chatbot.configure(guild, { defaultMonthlyLimit: 5_000 }, ACTOR);
    await expect(chatbot.get(guild)).resolves.toMatchObject({
      enabled: true,
      defaultMonthlyLimit: 5_000,
    });
    const rows = await prisma.auditLog.findMany({
      where: { guild: { discordId: guild } },
      select: { params: true },
      orderBy: { createdAt: 'asc' },
    });
    expect(rows.map((row) => row.params)).toEqual([
      { before: { enabled: false }, after: { enabled: true } },
      { before: { defaultLimit: 100_000 }, after: { defaultLimit: 5_000 } },
    ]);
  });

  it('round-trips a guild override without the key ever leaving the server', async () => {
    const guild = newGuild();
    const apiKey = keyOf('sk-roundtrip');
    const view = await chatbot.saveOverride(guild, { baseUrl: URL_A, model: 'gpt', apiKey }, ACTOR);
    expect(view.llm).toMatchObject({
      source: 'guild',
      baseUrl: URL_A,
      model: 'gpt',
      keyLast4: apiKey.slice(-4),
    });

    const stored = await prisma.chatbotConfig.findFirstOrThrow({
      where: { guild: { discordId: guild } },
    });
    expect(stored.llmApiKeyEnc).not.toBeNull();
    expect(stored.llmApiKeyEnc).not.toContain(apiKey);
    const visible = JSON.stringify([view, await chatbot.get(guild)]);
    expect(visible).not.toContain(apiKey);
    expect(visible).not.toContain(stored.llmApiKeyEnc ?? 'unreachable');
    const audited = JSON.stringify(
      await prisma.auditLog.findMany({ where: { guildId: stored.guildId } }),
    );
    expect(audited).not.toContain(apiKey);
    expect(audited).not.toContain(stored.llmApiKeyEnc ?? 'unreachable');

    await expect(chatbot.resolveTarget(guild)).resolves.toEqual({
      source: 'guild',
      target: { baseUrl: URL_A, model: 'gpt', apiKey },
    });

    // The model alone changes; the stored key stays and is not re-sealed.
    await chatbot.saveOverride(guild, { baseUrl: URL_A, model: 'gpt-2' }, ACTOR);
    await expect(chatbot.resolveTarget(guild)).resolves.toMatchObject({
      target: { model: 'gpt-2', apiKey },
    });
    // A new address never inherits the old key.
    await expect(
      chatbot.saveOverride(guild, { baseUrl: URL_B, model: 'gpt' }, ACTOR),
    ).rejects.toMatchObject({ code: ErrorCode.LLM_KEY_REQUIRED });
    await expect(
      chatbot.testOverride(guild, { baseUrl: URL_B, model: 'gpt' }),
    ).rejects.toMatchObject({
      code: ErrorCode.LLM_KEY_REQUIRED,
    });
    await expect(chatbot.testOverride(guild, { baseUrl: URL_A, model: 'gpt' })).resolves.toEqual({
      ok: true,
    });

    const cleared = await chatbot.clearOverride(guild, ACTOR);
    expect(cleared.llm).toMatchObject({ baseUrl: null, model: null, keyLast4: null });
    await expect(chatbot.resolveTarget(guild)).resolves.toBeNull();
    expect(await auditActions(guild)).toEqual([
      AUDIT_ACTIONS.chatbotLlmSet,
      AUDIT_ACTIONS.chatbotLlmSet,
      AUDIT_ACTIONS.chatbotLlmClear,
    ]);
    // Clearing what is not there writes nothing more.
    await chatbot.clearOverride(guild, ACTOR);
    expect(await auditActions(guild)).toHaveLength(3);
  });

  it('never restores a cleared override when a key-less save races the clear', async () => {
    for (let round = 0; round < 8; round += 1) {
      const guild = newGuild();
      await chatbot.saveOverride(
        guild,
        { baseUrl: URL_A, model: 'gpt', apiKey: keyOf('sk-race') },
        ACTOR,
      );
      await Promise.allSettled([
        chatbot.saveOverride(guild, { baseUrl: URL_A, model: 'gpt-2' }, ACTOR),
        chatbot.clearOverride(guild, ACTOR),
      ]);
      const row = await prisma.chatbotConfig.findFirstOrThrow({
        where: { guild: { discordId: guild } },
      });
      // The clear always succeeds, so whatever order they ran in, nothing is left.
      expect(row.llmBaseUrl, `round ${round}`).toBeNull();
      expect(row.llmApiKeyEnc).toBeNull();
    }
  });

  it('does not fall back to the shared key when the own key can no longer be read', async () => {
    const guild = newGuild();
    await chatbot.saveOverride(
      guild,
      { baseUrl: URL_A, model: 'gpt', apiKey: keyOf('sk-unreadable') },
      ACTOR,
    );
    await prisma.chatbotConfig.updateMany({
      where: { guild: { discordId: guild } },
      data: { llmApiKeyEnc: 'v1:not:a:key' },
    });
    await expect(chatbot.resolveTarget(guild)).resolves.toBeNull();
    await expect(chatbot.get(guild)).resolves.toMatchObject({
      llm: { source: 'guild', keyLast4: null },
    });
  });

  it('deletes everything of a server with the server', async () => {
    const guild = newGuild();
    const channel = newChannel();
    await chatbot.addChannel(guild, channel, ACTOR);
    await chatbot.saveOverride(
      guild,
      { baseUrl: URL_A, model: 'gpt', apiKey: keyOf('sk-cascade') },
      ACTOR,
    );
    const key = await keyOfGuild(guild);
    await prisma.chatbotChannelMemory.create({
      data: { guildId: key, channelId: channel, summary: 'remembered' },
    });

    await prisma.guild.delete({ where: { id: key } });
    for (const count of [
      prisma.chatbotConfig.count({ where: { guildId: key } }),
      prisma.chatbotChannel.count({ where: { guildId: key } }),
      prisma.chatbotChannelMemory.count({ where: { guildId: key } }),
    ]) {
      expect(await count).toBe(0);
    }
  });
});
