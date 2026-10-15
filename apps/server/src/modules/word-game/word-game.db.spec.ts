import 'reflect-metadata';
import { AUDIT_ACTIONS, WordStatus, type ActorContext } from '@sab/shared';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { requireDatabaseUrl } from '../../../../../vitest-test-database.mjs';
import { AuditService } from '../../common/audit/audit.service.js';
import type { ChannelAccessService } from '../../discord/services/channel-access.service.js';
import type { GuildLocaleService } from '../../i18n/guild-locale.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';
import { LeaderboardService } from '../game-core/leaderboard.service.js';
import { GuildConfigService } from '../guild-config/guild-config.service.js';
import { DictionaryService } from './dictionary.service.js';
import { WordGameService } from './word-game.service.js';

const ACTOR: ActorContext = { source: 'DISCORD', userId: '100000000000000002' };
const CHANNEL = '200000000000000001';
const WORDS = ['apple', 'egg', 'eagle', 'elk', 'ear', 'eel', 'goat'];

/** Distinct players; ids only have to be snowflakes. */
const player = (n: number) => String(300000000000000000n + BigInt(n));

describe('WordGameService against Postgres', () => {
  let database: TestDatabase;
  let prisma: PrismaService;
  let service: WordGameService;
  let nextGuild = 100000000000000500n;

  const newGuild = () => String((nextGuild += 1n));
  const move = (content: string, authorId: string) => ({ channelId: CHANNEL, authorId, content });

  /** A server with the game channel set and a fresh round. */
  async function startedGuild(): Promise<string> {
    const guildId = newGuild();
    await service.configure(guildId, { channelId: CHANNEL }, ACTOR);
    return guildId;
  }

  async function stateOf(guildId: string) {
    return prisma.wordGameState.findFirstOrThrow({
      where: { guild: { discordId: guildId } },
      include: { usedWords: { select: { word: true } } },
    });
  }

  beforeAll(async () => {
    database = await createTestDatabase(requireDatabaseUrl());
    prisma = database.prisma as unknown as PrismaService;
    const audit = new AuditService(prisma);
    const access = { check: vi.fn().mockResolvedValue('ok') } as unknown as ChannelAccessService;
    const guilds = new GuildConfigService(prisma, audit, access);
    service = new WordGameService(
      prisma,
      audit,
      guilds,
      new DictionaryService(() => Promise.resolve(WORDS)),
      { resolve: vi.fn().mockResolvedValue('en') } as unknown as GuildLocaleService,
      {} as never,
      new LeaderboardService(prisma),
    );
  });

  afterAll(async () => {
    await database.dispose();
  });

  it('plays a short chain and keeps count, last word and used words in step', async () => {
    const guildId = await startedGuild();
    await expect(service.submitWord(guildId, move('Apple', player(1)))).resolves.toMatchObject({
      status: WordStatus.SUCCESS,
      count: 1,
    });
    await expect(service.submitWord(guildId, move('egg', player(2)))).resolves.toMatchObject({
      status: WordStatus.SUCCESS,
      count: 2,
    });
    await expect(service.submitWord(guildId, move('goat', player(2)))).resolves.toMatchObject({
      status: WordStatus.SAME_AUTHOR,
    });
    await expect(service.submitWord(guildId, move('apple', player(3)))).resolves.toMatchObject({
      status: WordStatus.SAME_WORD,
    });
    await expect(service.submitWord(guildId, move('banana', player(3)))).resolves.toMatchObject({
      status: WordStatus.NOT_LINK,
      starter: 'g',
    });

    const state = await stateOf(guildId);
    expect(state).toMatchObject({
      started: false,
      count: 2,
      lastWord: 'egg',
      lastUserId: player(2),
    });
    expect(state.usedWords.map((row) => row.word).sort()).toEqual(['apple', 'egg']);
  });

  it('lets exactly one of two identical words win, however they interleave', async () => {
    for (let round = 0; round < 15; round += 1) {
      const guildId = await startedGuild();
      const results = await Promise.all([
        service.submitWord(guildId, move('apple', player(1))),
        service.submitWord(guildId, move('apple', player(2))),
      ]);
      expect(results.map((result) => result.status).sort(), `round ${round}`).toEqual(
        [WordStatus.SAME_WORD, WordStatus.SUCCESS].sort(),
      );
      const state = await stateOf(guildId);
      expect(state.count).toBe(1);
      expect(state.usedWords).toEqual([{ word: 'apple' }]);
    }
  });

  it('never counts a move twice or loses one when many arrive at once', async () => {
    const guildId = await startedGuild();
    const words = ['apple', 'egg', 'eagle', 'elk', 'ear', 'eel', 'goat', 'egg', 'apple', 'elk'];
    const results = await Promise.all(
      words.map((word, index) => service.submitWord(guildId, move(word, player(index + 1)))),
    );

    const accepted = results.filter((result) => result.status === WordStatus.SUCCESS);
    const state = await stateOf(guildId);
    expect(accepted.length).toBeGreaterThanOrEqual(1);
    expect(state.count).toBe(accepted.length);
    expect(state.usedWords).toHaveLength(accepted.length);
    expect(new Set(state.usedWords.map((row) => row.word)).size).toBe(accepted.length);
    // Every accepted move got its own count: no two callers saw the same number.
    expect(new Set(accepted.map((result) => result.count)).size).toBe(accepted.length);
  });

  it('never goes past the limit, and only the word that reaches it ends the game', async () => {
    const guildId = await startedGuild();
    await prisma.guildConfig.updateMany({
      where: { guild: { discordId: guildId } },
      data: { wordMaxWords: 200 },
    });
    const before = await stateOf(guildId);
    await prisma.wordGameUsedWord.create({ data: { stateId: before.id, word: 'apple' } });
    await prisma.wordGameState.update({
      where: { id: before.id },
      data: { started: false, count: 199, lastWord: 'apple', lastUserId: player(1) },
    });

    const results = await Promise.all(
      ['egg', 'eagle', 'elk', 'ear', 'eel'].map((word, index) =>
        service.submitWord(guildId, move(word, player(index + 2))),
      ),
    );
    const statuses = results.map((result) => result.status).sort();
    expect(statuses).toEqual(
      [
        WordStatus.SUCCESS,
        WordStatus.MAX_WORD,
        WordStatus.MAX_WORD,
        WordStatus.MAX_WORD,
        WordStatus.MAX_WORD,
      ].sort(),
    );
    const winner = results.find((result) => result.status === WordStatus.SUCCESS);
    expect(winner).toMatchObject({ count: 200, maxWords: 200, finished: true });

    await expect(service.submitWord(guildId, move('goat', player(9)))).resolves.toMatchObject({
      status: WordStatus.MAX_WORD,
      count: 200,
    });
    const state = await stateOf(guildId);
    expect(state.count).toBe(200);
    // The word that was already there and the one that reached the limit.
    expect(state.usedWords).toHaveLength(2);
  });

  it('refuses the same word twice at the database, whatever the application did', async () => {
    const guildId = await startedGuild();
    await service.submitWord(guildId, move('apple', player(1)));
    const state = await stateOf(guildId);
    await expect(
      prisma.wordGameUsedWord.create({ data: { stateId: state.id, word: 'apple' } }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('starts a new round on a new channel: clears the words, audits, and a dry run does neither', async () => {
    const guildId = await startedGuild();
    await service.submitWord(guildId, move('apple', player(1)));
    await service.submitWord(guildId, move('egg', player(2)));
    const otherChannel = '200000000000000002';

    const plan = await service.configure(guildId, { channelId: otherChannel }, ACTOR, {
      dryRun: true,
    });
    expect(plan).toMatchObject({ restarted: true, clearedWords: 2, dryRun: true });
    expect((await stateOf(guildId)).usedWords).toHaveLength(2);
    const auditBefore = await prisma.auditLog.count({
      where: { action: AUDIT_ACTIONS.wordGameConfigure, guild: { discordId: guildId } },
    });

    const done = await service.configure(
      guildId,
      { channelId: otherChannel, maxWords: 300 },
      ACTOR,
    );
    expect(done).toMatchObject({
      restarted: true,
      clearedWords: 2,
      after: { channelId: otherChannel, maxWords: 300 },
    });
    const state = await stateOf(guildId);
    expect(state).toMatchObject({ started: true, count: 0, lastWord: '', lastUserId: '' });
    expect(state.usedWords).toEqual([]);

    const rows = await prisma.auditLog.findMany({
      where: { action: AUDIT_ACTIONS.wordGameConfigure, guild: { discordId: guildId } },
    });
    // The first configure of `startedGuild` and this one; the dry run wrote nothing.
    expect(rows).toHaveLength(auditBefore + 1);
    expect(rows.every((row) => row.actorDiscordId === ACTOR.userId && row.ok)).toBe(true);
  });

  it('changing only the limit keeps the round being played', async () => {
    const guildId = await startedGuild();
    await service.submitWord(guildId, move('apple', player(1)));
    await service.configure(guildId, { maxWords: 250 }, ACTOR);
    const state = await stateOf(guildId);
    expect(state).toMatchObject({ started: false, count: 1, lastWord: 'apple' });
    await expect(service.status(guildId)).resolves.toMatchObject({ maxWords: 250, count: 1 });
  });

  it('resets the round and records it; a dry run only counts', async () => {
    const guildId = await startedGuild();
    await service.submitWord(guildId, move('apple', player(1)));

    await expect(service.reset(guildId, ACTOR, { dryRun: true })).resolves.toMatchObject({
      status: 'RESET',
      clearedWords: 1,
      dryRun: true,
    });
    expect((await stateOf(guildId)).count).toBe(1);

    await expect(service.reset(guildId, ACTOR)).resolves.toMatchObject({
      status: 'RESET',
      channelId: CHANNEL,
      clearedWords: 1,
    });
    const state = await stateOf(guildId);
    expect(state).toMatchObject({ started: true, count: 0 });
    expect(state.usedWords).toEqual([]);
    await expect(
      prisma.auditLog.count({
        where: { action: AUDIT_ACTIONS.wordGameReset, guild: { discordId: guildId } },
      }),
    ).resolves.toBe(1);
    await expect(service.listUsedWords(guildId)).resolves.toMatchObject({ items: [] });
  });

  it('has nothing to reset on a server that never chose a channel, and leaves no trace', async () => {
    const guildId = newGuild();
    await prisma.guild.create({ data: { discordId: guildId } });
    await expect(service.reset(guildId, ACTOR)).resolves.toMatchObject({
      status: 'NOT_CONFIGURED',
    });
    await expect(
      prisma.auditLog.count({
        where: { action: AUDIT_ACTIONS.wordGameReset, guild: { discordId: guildId } },
      }),
    ).resolves.toBe(0);
  });

  it('lists the words in the order they were played', async () => {
    const guildId = await startedGuild();
    await service.submitWord(guildId, move('apple', player(1)));
    await service.submitWord(guildId, move('egg', player(2)));
    await service.submitWord(guildId, move('goat', player(1)));
    await expect(service.listUsedWords(guildId, { pageSize: 2 })).resolves.toEqual({
      items: [{ word: 'apple' }, { word: 'egg' }],
      pagination: { page: 1, pageSize: 2, total: 3 },
    });
    await expect(
      service.listUsedWords(guildId, { sort: 'played', order: 'desc', pageSize: 1 }),
    ).resolves.toMatchObject({ items: [{ word: 'goat' }] });
    await expect(service.listUsedWords(guildId, { sort: 'word' })).resolves.toMatchObject({
      items: [{ word: 'apple' }, { word: 'egg' }, { word: 'goat' }],
    });
  });
});
