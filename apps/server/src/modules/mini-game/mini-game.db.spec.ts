import 'reflect-metadata';
import { LEADERBOARD_SIZE } from '@sab/shared';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { requireDatabaseUrl } from '../../../../../vitest-test-database.mjs';
import type { AppStateService } from '../../app-state/app-state.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';
import { LeaderboardService } from '../game-core/leaderboard.service.js';
import type { LlmService } from '../llm/llm.service.js';
import type { DictionaryService } from '../word-game/dictionary.service.js';
import { CountingService } from './counting.service.js';
import { GameWordsService } from './game-words.service.js';
import { ScrambleService } from './scramble.service.js';
import { normalizeWord, VietWordsService } from './viet-words.service.js';
import { WordleService } from './wordle.service.js';

const SCRAMBLE_WORDS = ['học sinh', 'con mèo', 'hoà bình'];
const WORDLE_ANSWERS = ['plumb', 'ghost', 'crane', 'fuzzy'];

/** Distinct players; ids only have to be snowflakes. */
const player = (n: number) => String(300000000000000000n + BigInt(n));

describe('mini games against Postgres', () => {
  let llm: { explainVietnamese: ReturnType<typeof vi.fn> };
  let database: TestDatabase;
  let prisma: PrismaService;
  let leaderboard: LeaderboardService;
  let counting: CountingService;
  let scramble: ScrambleService;
  let wordle: WordleService;
  let nextGuild = 100000000000001000n;

  const newGuild = () => String((nextGuild += 1n));
  /** One channel hosts one game at most across servers, so each server gets its own. */
  const channelOf = (discordId: string) => String(BigInt(discordId) + 900000000000000000n);

  /** A server with `game` played in a channel of its own. */
  async function guildWith(game: 'COUNTING' | 'SCRAMBLE' | 'WORDLE'): Promise<string> {
    const discordId = newGuild();
    const guild = await prisma.guild.create({ data: { discordId } });
    await prisma.gameChannel.create({
      data: { guildId: guild.id, game, channelId: channelOf(discordId) },
    });
    return discordId;
  }

  const keyOf = async (discordId: string) =>
    (await prisma.guild.findUniqueOrThrow({ where: { discordId } })).id;
  const pointsOf = async (discordId: string, game: 'COUNTING' | 'SCRAMBLE' | 'WORDLE') =>
    (
      await prisma.gameScore.findMany({
        where: { guild: { discordId }, game },
        select: { points: true },
      })
    ).reduce((sum, row) => sum + row.points, 0);

  async function openCounting(discordId: string, state?: { count: number; lastUserId: string }) {
    const key = await keyOf(discordId);
    await prisma.countingState.create({ data: { guildId: key, ...state } });
  }

  async function openScramble(discordId: string) {
    const key = await keyOf(discordId);
    const next = await scramble.prepare(discordId);
    await prisma.$transaction((tx) => scramble.restart(tx, key, next));
  }

  async function openWordle(discordId: string, answer = 'plumb') {
    const key = await keyOf(discordId);
    await prisma.wordleState.create({ data: { guildId: key, answer, guesses: [] } });
  }

  const submitTo = (discordId: string) => (content: string, authorId: string) => ({
    channelId: channelOf(discordId),
    authorId,
    content,
  });

  beforeAll(async () => {
    database = await createTestDatabase(requireDatabaseUrl());
    prisma = database.prisma as unknown as PrismaService;
    leaderboard = new LeaderboardService(prisma);
    const words = new GameWordsService(
      { has: () => Promise.resolve(false) } as unknown as DictionaryService,
      { wordleAnswers: () => Promise.resolve(WORDLE_ANSWERS) },
    );
    llm = { explainVietnamese: vi.fn() };
    // The bundled list is not loaded here; the specs' own words are the table.
    const viet = new VietWordsService(prisma, {} as AppStateService, llm as unknown as LlmService);
    vi.spyOn(viet as unknown as { seed: () => Promise<void> }, 'seed').mockResolvedValue();
    await prisma.vietWord.createMany({
      data: SCRAMBLE_WORDS.map((word) => ({
        word,
        normalized: normalizeWord(word),
      })),
      skipDuplicates: true,
    });
    // Consecutive draws always differ, so a new puzzle never repeats the one
    // just solved and the specs do not depend on luck.
    let drawn = 0;
    let english = 0;
    vi.spyOn(viet, 'pickVietnamese').mockImplementation(() =>
      Promise.resolve(SCRAMBLE_WORDS[drawn++ % SCRAMBLE_WORDS.length] as string),
    );
    vi.spyOn(words, 'pickWordleAnswer').mockImplementation(() =>
      Promise.resolve(WORDLE_ANSWERS[english++ % WORDLE_ANSWERS.length] as string),
    );
    counting = new CountingService(prisma, leaderboard);
    scramble = new ScrambleService(prisma, leaderboard, viet);
    wordle = new WordleService(prisma, leaderboard, words);
  });

  afterAll(async () => {
    await database.dispose();
  });

  describe('counting', () => {
    it('counts in turn and keeps the record when the count starts over', async () => {
      const guild = await guildWith('COUNTING');
      const send = submitTo(guild);
      await expect(counting.submit(guild, send('1', player(1)))).resolves.toMatchObject({
        status: 'COUNTED',
      });
      await expect(counting.submit(guild, send('2', player(2)))).resolves.toMatchObject({
        status: 'COUNTED',
      });
      await expect(counting.submit(guild, send('3', player(2)))).resolves.toEqual({
        status: 'SAME_USER',
        best: 2,
      });
      await expect(counting.submit(guild, send('1', player(1)))).resolves.toMatchObject({
        status: 'COUNTED',
      });
      const state = await prisma.countingState.findFirstOrThrow({
        where: { guild: { discordId: guild } },
      });
      expect(state).toMatchObject({ count: 1, lastUserId: player(1), best: 2 });
      expect(await pointsOf(guild, 'COUNTING')).toBe(3);
    });

    it('lets exactly one of two players who send the same number at once be counted', async () => {
      for (let round = 0; round < 15; round += 1) {
        const guild = await guildWith('COUNTING');
        await openCounting(guild);
        const send = submitTo(guild);
        const results = await Promise.all([
          counting.submit(guild, send('1', player(1))),
          counting.submit(guild, send('1', player(2))),
        ]);
        expect(
          results.filter((r) => r.status === 'COUNTED'),
          `round ${round}`,
        ).toHaveLength(1);
        // The other one is judged against the count the first left: a wrong number.
        expect(results.filter((r) => r.status === 'WRONG_NUMBER')).toHaveLength(1);
        expect(await pointsOf(guild, 'COUNTING')).toBe(1);
      }
    });

    it('makes the state row of a new server once when two players count at the same time', async () => {
      for (let round = 0; round < 10; round += 1) {
        const guild = await guildWith('COUNTING');
        const send = submitTo(guild);
        const results = await Promise.all([
          counting.submit(guild, send('1', player(1))),
          counting.submit(guild, send('1', player(2))),
        ]);
        // Judged one after the other: the first "1" counts, the second is a
        // wrong number (2 was due) and starts the count over.
        expect(results.map((r) => r.status).sort(), `round ${round}`).toEqual([
          'COUNTED',
          'WRONG_NUMBER',
        ]);
        expect(await pointsOf(guild, 'COUNTING')).toBe(1);
        const rows = await prisma.countingState.count({ where: { guild: { discordId: guild } } });
        expect(rows).toBe(1);
      }
    });

    it('ignores the same message sent twice by the same player', async () => {
      const guild = await guildWith('COUNTING');
      const send = submitTo(guild);
      const results = await Promise.all([
        counting.submit(guild, send('1', player(1))),
        counting.submit(guild, send('1', player(1))),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual(['COUNTED', 'NOTHING']);
      expect(await pointsOf(guild, 'COUNTING')).toBe(1);
    });

    it('refuses a negative count or record at the database', async () => {
      const guild = await guildWith('COUNTING');
      const key = await keyOf(guild);
      await expect(
        prisma.countingState.create({ data: { guildId: key, count: -1 } }),
      ).rejects.toThrow(/CountingState_count_check|check constraint/iu);
      await expect(
        prisma.countingState.create({ data: { guildId: key, best: -1 } }),
      ).rejects.toThrow(/CountingState_count_check|check constraint/iu);
    });

    it('starts the count over at 1 on restart and keeps the record', async () => {
      const guild = await guildWith('COUNTING');
      await openCounting(guild, { count: 7, lastUserId: player(1) });
      await prisma.countingState.updateMany({
        where: { guild: { discordId: guild } },
        data: { best: 9 },
      });
      const key = await keyOf(guild);
      await prisma.$transaction((tx) => counting.restart(tx, key));
      await expect(
        prisma.countingState.findFirstOrThrow({ where: { guildId: key } }),
      ).resolves.toMatchObject({ count: 0, lastUserId: '', best: 9 });
    });
  });

  describe('scramble', () => {
    it('gives one point when two right answers arrive at once', async () => {
      for (let round = 0; round < 15; round += 1) {
        const guild = await guildWith('SCRAMBLE');
        await openScramble(guild);
        const key = await keyOf(guild);
        const { answer } = await prisma.scrambleState.findFirstOrThrow({ where: { guildId: key } });
        const send = submitTo(guild);
        const results = await Promise.all([
          scramble.submit(guild, send(answer, player(1))),
          scramble.submit(guild, send(answer, player(2))),
        ]);
        expect(results.map((r) => r.status).sort(), `round ${round}`).toEqual([
          'NOTHING',
          'SOLVED',
        ]);
        expect(await pointsOf(guild, 'SCRAMBLE')).toBe(1);
        const after = await prisma.scrambleState.findFirstOrThrow({ where: { guildId: key } });
        expect(after.round).toBe(2);
        expect(after.answer).not.toBe(answer);
      }
    });

    it('ignores a wrong answer and scores a right one from the next puzzle', async () => {
      const guild = await guildWith('SCRAMBLE');
      await openScramble(guild);
      const key = await keyOf(guild);
      const send = submitTo(guild);
      await expect(scramble.submit(guild, send('hello', player(1)))).resolves.toEqual({
        status: 'NOTHING',
      });
      const first = await prisma.scrambleState.findFirstOrThrow({ where: { guildId: key } });
      const solved = await scramble.submit(guild, send(first.answer, player(1)));
      expect(solved.status).toBe('SOLVED');
      const second = await prisma.scrambleState.findFirstOrThrow({ where: { guildId: key } });
      await scramble.submit(guild, send(second.answer, player(1)));
      expect(await pointsOf(guild, 'SCRAMBLE')).toBe(2);
    });

    it('refuses an empty answer or puzzle at the database', async () => {
      const guild = await guildWith('SCRAMBLE');
      const key = await keyOf(guild);
      await expect(
        prisma.scrambleState.create({ data: { guildId: key, answer: '', puzzle: 'A' } }),
      ).rejects.toThrow(/ScrambleState_puzzle_check|check constraint/iu);
    });
  });

  describe('wordle', () => {
    it('lets exactly one of two right guesses sent at once win the point', async () => {
      for (let round = 0; round < 15; round += 1) {
        const guild = await guildWith('WORDLE');
        await openWordle(guild, 'plumb');
        const send = submitTo(guild);
        const results = await Promise.all([
          wordle.submit(guild, send('plumb', player(1))),
          wordle.submit(guild, send('plumb', player(2))),
        ]);
        expect(
          results.filter((r) => r.status === 'SOLVED'),
          `round ${round}`,
        ).toHaveLength(1);
        expect(await pointsOf(guild, 'WORDLE')).toBe(1);
      }
    });

    it('never lets one player take two turns in a row, however the guesses interleave', async () => {
      for (let round = 0; round < 15; round += 1) {
        const guild = await guildWith('WORDLE');
        await openWordle(guild, 'plumb');
        const send = submitTo(guild);
        const results = await Promise.all([
          wordle.submit(guild, send('ghost', player(1))),
          wordle.submit(guild, send('crane', player(1))),
        ]);
        expect(results.map((r) => r.status).sort(), `round ${round}`).toEqual([
          'GUESSED',
          'SAME_USER',
        ]);
        const state = await prisma.wordleState.findFirstOrThrow({
          where: { guild: { discordId: guild } },
        });
        expect(state.guesses).toHaveLength(1);
      }
    });

    it('keeps every guess of different players who guess at once', async () => {
      const guild = await guildWith('WORDLE');
      await openWordle(guild, 'plumb');
      const send = submitTo(guild);
      const results = await Promise.all(
        ['ghost', 'crane', 'fuzzy'].map((word, i) =>
          wordle.submit(guild, send(word, player(i + 1))),
        ),
      );
      const state = await prisma.wordleState.findFirstOrThrow({
        where: { guild: { discordId: guild } },
      });
      // Turns alternate between players, so a player may be refused and nothing is lost.
      const taken = results.filter((r) => r.status === 'GUESSED');
      expect(state.guesses).toHaveLength(taken.length);
      expect(new Set(state.guesses).size).toBe(taken.length);
    });

    it('loses after six guesses and opens a new board', async () => {
      const guild = await guildWith('WORDLE');
      await openWordle(guild, 'plumb');
      const send = submitTo(guild);
      const key = await keyOf(guild);
      await prisma.wordleState.update({
        where: { guildId: key },
        data: { guesses: ['aaaaa', 'bbbbb', 'ccccc', 'ddddd', 'eeeee'], lastUserId: player(9) },
      });
      const result = await wordle.submit(guild, send('ghost', player(1)));
      expect(result).toMatchObject({ status: 'LOST', answer: 'plumb' });
      const after = await prisma.wordleState.findFirstOrThrow({ where: { guildId: key } });
      expect(after).toMatchObject({ guesses: [], lastUserId: '', round: 1 });
      expect(await pointsOf(guild, 'WORDLE')).toBe(0);
    });

    it('refuses a board the database cannot accept (CHECK on answer and guesses)', async () => {
      const guild = await guildWith('WORDLE');
      const key = await keyOf(guild);
      for (const answer of ['', 'plum', 'plumbs', 'PLUMB', 'plum1', 'plümb']) {
        await expect(
          prisma.wordleState.create({ data: { guildId: key, answer, guesses: [] } }),
          answer,
        ).rejects.toThrow(/WordleState_board_check|check constraint/iu);
      }
      await expect(
        prisma.wordleState.create({
          data: {
            guildId: key,
            answer: 'plumb',
            guesses: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
          },
        }),
      ).rejects.toThrow(/WordleState_board_check|check constraint/iu);
    });

    it('accepts a full board of six guesses and a five-letter lower-case answer', async () => {
      const guild = await guildWith('WORDLE');
      const key = await keyOf(guild);
      await expect(
        prisma.wordleState.create({
          data: { guildId: key, answer: 'plumb', guesses: ['a', 'b', 'c', 'd', 'e', 'f'] },
        }),
      ).resolves.toMatchObject({ answer: 'plumb' });
    });

    it('makes a new board on restart and reports the replaced answer', async () => {
      const guild = await guildWith('WORDLE');
      await openWordle(guild, 'plumb');
      const key = await keyOf(guild);
      await prisma.wordleState.update({
        where: { guildId: key },
        data: { guesses: ['ghost'], lastUserId: player(1) },
      });
      const opening = await prisma.$transaction((tx) => wordle.restart(tx, key));
      expect(opening).toEqual({ game: 'WORDLE', previous: 'plumb' });
      const after = await prisma.wordleState.findFirstOrThrow({ where: { guildId: key } });
      expect(after).toMatchObject({ guesses: [], lastUserId: '', round: 1 });
    });
  });

  describe('scores', () => {
    it('refuses a negative score or a user id that is not a snowflake', async () => {
      const guild = await guildWith('COUNTING');
      const key = await keyOf(guild);
      await expect(
        prisma.gameScore.create({
          data: { guildId: key, game: 'COUNTING', userId: player(1), points: -1 },
        }),
      ).rejects.toThrow(/GameScore_points_check|check constraint/iu);
      await expect(
        prisma.gameScore.create({ data: { guildId: key, game: 'COUNTING', userId: 'me' } }),
      ).rejects.toThrow(/GameScore_userId_check|check constraint/iu);
    });

    it('adds the points of the same player in the same transaction without losing one', async () => {
      const guild = await guildWith('COUNTING');
      const key = await keyOf(guild);
      await Promise.all(
        Array.from({ length: 8 }, () =>
          prisma.$transaction((tx) => leaderboard.award(tx, key, 'COUNTING', player(1))),
        ),
      );
      expect(await pointsOf(guild, 'COUNTING')).toBe(8);
    });

    it('keeps the points of each game of a player apart', async () => {
      const guild = await guildWith('COUNTING');
      const key = await keyOf(guild);
      await prisma.$transaction(async (tx) => {
        await leaderboard.award(tx, key, 'COUNTING', player(1));
        await leaderboard.award(tx, key, 'WORDLE', player(1));
        await leaderboard.award(tx, key, 'WORDLE', player(1));
      });
      expect(await pointsOf(guild, 'COUNTING')).toBe(1);
      expect(await pointsOf(guild, 'WORDLE')).toBe(2);
    });

    async function seed(guild: string, scores: Array<[number, number]>) {
      const key = await keyOf(guild);
      // Rows are made one after the other so `updatedAt` orders them.
      for (const [n, points] of scores) {
        await prisma.gameScore.create({
          data: { guildId: key, game: 'COUNTING', userId: player(n), points },
        });
      }
    }

    it('gives players with equal points the same rank and the next rank after them', async () => {
      const guild = await guildWith('COUNTING');
      await seed(guild, [
        [1, 5],
        [2, 5],
        [3, 3],
        [4, 3],
        [5, 1],
      ]);
      const board = await leaderboard.board(guild, 'COUNTING', player(5));
      expect(board.top).toEqual([
        { userId: player(1), points: 5, rank: 1 },
        { userId: player(2), points: 5, rank: 1 },
        { userId: player(3), points: 3, rank: 3 },
        { userId: player(4), points: 3, rank: 3 },
        { userId: player(5), points: 1, rank: 5 },
      ]);
      expect(board.you).toEqual({ userId: player(5), points: 1, rank: 5 });
    });

    it('lists the one who reached equal points first before the others', async () => {
      const guild = await guildWith('COUNTING');
      await seed(guild, [
        [3, 2],
        [1, 2],
        [2, 2],
      ]);
      const board = await leaderboard.board(guild, 'COUNTING', player(1));
      expect(board.top.map((row) => row.userId)).toEqual([player(3), player(1), player(2)]);
      expect(board.top.every((row) => row.rank === 1)).toBe(true);
    });

    it('shows the asking player below the top with their own rank', async () => {
      const guild = await guildWith('COUNTING');
      // 12 players with 12..1 points, then a 13th tied with the last.
      await seed(guild, [
        ...Array.from({ length: 12 }, (_, i): [number, number] => [i + 1, 12 - i]),
        [13, 1],
      ]);
      const board = await leaderboard.board(guild, 'COUNTING', player(13));
      expect(board.top).toHaveLength(LEADERBOARD_SIZE);
      expect(board.top.at(-1)).toEqual({ userId: player(10), points: 3, rank: 10 });
      expect(board.you).toEqual({ userId: player(13), points: 1, rank: 12 });
      const second = await leaderboard.board(guild, 'COUNTING', player(12));
      expect(second.you).toEqual({ userId: player(12), points: 1, rank: 12 });
    });

    it('has no row for a player without points, nor for a score of 0', async () => {
      const guild = await guildWith('COUNTING');
      await seed(guild, [
        [1, 2],
        [2, 0],
      ]);
      const board = await leaderboard.board(guild, 'COUNTING', player(2));
      expect(board.top).toEqual([{ userId: player(1), points: 2, rank: 1 }]);
      expect(board.you).toBeNull();
      await expect(leaderboard.board(guild, 'COUNTING', player(99))).resolves.toMatchObject({
        you: null,
      });
    });

    it('keeps the servers and the games apart', async () => {
      const first = await guildWith('COUNTING');
      const second = await guildWith('COUNTING');
      await seed(first, [[1, 4]]);
      await expect(leaderboard.board(second, 'COUNTING', player(1))).resolves.toEqual({
        top: [],
        you: null,
      });
      await expect(leaderboard.board(first, 'WORDLE', player(1))).resolves.toEqual({
        top: [],
        you: null,
      });
    });
  });

  describe('game channels', () => {
    it('refuses a second game in the same channel, even from another server', async () => {
      const first = await guildWith('COUNTING');
      const other = await prisma.guild.create({ data: { discordId: newGuild() } });
      await expect(
        prisma.gameChannel.create({
          data: { guildId: other.id, game: 'WORDLE', channelId: channelOf(first) },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });

    it('refuses a second channel for the same game in one server', async () => {
      const first = await guildWith('COUNTING');
      const key = await keyOf(first);
      await expect(
        prisma.gameChannel.create({
          data: { guildId: key, game: 'COUNTING', channelId: '200000000000999999' },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });

    it('refuses a channel id that is not a snowflake', async () => {
      const first = await guildWith('COUNTING');
      const key = await keyOf(first);
      await expect(
        prisma.gameChannel.create({ data: { guildId: key, game: 'WORDLE', channelId: 'general' } }),
      ).rejects.toThrow(/GameChannel_channelId_check|check constraint/iu);
    });

    it('removes the state and the scores of a server with it', async () => {
      const guild = await guildWith('COUNTING');
      await openCounting(guild);
      const key = await keyOf(guild);
      await prisma.$transaction((tx) => leaderboard.award(tx, key, 'COUNTING', player(1)));
      await prisma.guild.delete({ where: { id: key } });
      expect(await prisma.countingState.count({ where: { guildId: key } })).toBe(0);
      expect(await prisma.gameScore.count({ where: { guildId: key } })).toBe(0);
      expect(await prisma.gameChannel.count({ where: { guildId: key } })).toBe(0);
    });
  });
  // Last: it fills the table with the whole bundled list, which the specs above
  // must not see.
  describe('Vietnamese words', () => {
    it('asks the LLM once per solved word and stores its answer, even "none"', async () => {
      const viet = new VietWordsService(
        prisma,
        {} as AppStateService,
        llm as unknown as LlmService,
      );
      vi.spyOn(viet as unknown as { seed: () => Promise<void> }, 'seed').mockResolvedValue();
      await prisma.vietWord.createMany({
        data: ['từ thử một', 'từ thử hai', 'từ thử ba'].map((word) => ({
          word,
          normalized: normalizeWord(word),
        })),
      });

      llm.explainVietnamese.mockResolvedValueOnce('nghĩa từ máy');
      await expect(
        Promise.all([viet.explain('từ thử một'), viet.explain('từ thử một')]),
      ).resolves.toEqual(['nghĩa từ máy', 'nghĩa từ máy']);
      await expect(viet.explain('từ thử một')).resolves.toBe('nghĩa từ máy');
      expect(llm.explainVietnamese).toHaveBeenCalledTimes(1);
      await expect(
        prisma.vietWord.findUniqueOrThrow({ where: { word: 'từ thử một' } }),
      ).resolves.toMatchObject({ meaning: 'nghĩa từ máy', meaningSource: 'LLM' });

      llm.explainVietnamese.mockResolvedValueOnce(null);
      await expect(viet.explain('từ thử hai')).resolves.toBeNull();
      await expect(viet.explain('từ thử hai')).resolves.toBeNull();
      expect(llm.explainVietnamese).toHaveBeenCalledTimes(2);
      await expect(
        prisma.vietWord.findUniqueOrThrow({ where: { word: 'từ thử hai' } }),
      ).resolves.toMatchObject({ meaning: null, meaningSource: 'NONE' });

      // No LLM set up (or a failed call): nothing stored, a later solve asks again.
      llm.explainVietnamese.mockResolvedValueOnce(undefined);
      await expect(viet.explain('từ thử ba')).resolves.toBeNull();
      await expect(
        prisma.vietWord.findUniqueOrThrow({ where: { word: 'từ thử ba' } }),
      ).resolves.toMatchObject({ meaningSource: null });
    });

    it('loads the bundled list once and keeps a meaning found later', async () => {
      const kept = new Map<string, string>();
      const appState = {
        get: (key: string) => Promise.resolve(kept.get(key) ?? null),
        set: (key: string, value: string) => {
          kept.set(key, value);
          return Promise.resolve();
        },
      } as unknown as AppStateService;
      await prisma.vietWord.upsert({
        where: { word: 'hậu cần' },
        create: {
          word: 'hậu cần',
          normalized: normalizeWord('hậu cần'),
          meaning: 'nghĩa riêng',
          meaningSource: 'LLM',
        },
        update: { meaning: 'nghĩa riêng', meaningSource: 'LLM' },
      });
      const loader = new VietWordsService(prisma, appState, llm as unknown as LlmService);

      await expect(loader.isVietnameseWord('HẦU  CẬN')).resolves.toBe(true);
      expect(await prisma.vietWord.count()).toBeGreaterThan(49_000);
      await expect(
        prisma.vietWord.findUniqueOrThrow({ where: { word: 'hậu cần' } }),
      ).resolves.toMatchObject({ meaning: 'nghĩa riêng', meaningSource: 'LLM' });
      await expect(
        prisma.vietWord.findUniqueOrThrow({ where: { word: 'hầu cận' } }),
      ).resolves.toMatchObject({ meaningSource: 'WIKTIONARY' });

      // The same assets again: nothing is written.
      const again = new VietWordsService(prisma, appState, llm as unknown as LlmService);
      const write = vi.spyOn(prisma, '$executeRaw');
      await again.isVietnameseWord('hầu cận');
      expect(write).not.toHaveBeenCalled();
      write.mockRestore();
    }, 120_000);
  });
});
