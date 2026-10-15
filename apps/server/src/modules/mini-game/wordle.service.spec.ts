import 'reflect-metadata';
import { ErrorCode, WORDLE_MAX_GUESSES } from '@sab/shared';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { LeaderboardService } from '../game-core/leaderboard.service.js';
import type { GameWordsService } from './game-words.service.js';
import { WordleService } from './wordle.service.js';

const GUILD = '100000000000000001';
const CHANNEL = '200000000000000001';
const OTHER_CHANNEL = '200000000000000002';
const ALICE = '300000000000000001';
const BOB = '300000000000000002';
const CAROL = '300000000000000003';

type Board = { answer: string; guesses: string[]; lastUserId: string; round: number };

type Setup = {
  /** `null`: no board has been made for the server yet. */
  board?: Partial<Board> | null;
  channelId?: string | null;
  guild?: null;
  /** Guesses the word list accepts. */
  listed?: string[];
  picks?: string[];
};

const LISTED = ['crane', 'slate', 'about', 'other', 'fuzzy', 'plumb', 'ghost', 'nacre', 'irate'];

function build(setup: Setup = {}) {
  const store = {
    board:
      setup.board === null
        ? null
        : { answer: 'plumb', guesses: [], lastUserId: '', round: 2, ...setup.board },
  };
  const hooks = { beforeUpdate: (): void => undefined };
  const guild = {
    findUnique: vi.fn(() =>
      Promise.resolve(
        setup.guild === null
          ? null
          : {
              id: 'guild-key',
              gameChannels:
                setup.channelId === null ? [] : [{ channelId: setup.channelId ?? CHANNEL }],
              wordle:
                store.board === null ? null : { ...store.board, guesses: [...store.board.guesses] },
            },
      ),
    ),
  };
  const wordleState = {
    findUnique: vi.fn(() =>
      Promise.resolve(store.board === null ? null : { answer: store.board.answer }),
    ),
    createMany: vi.fn(({ data }: { data: Array<{ answer: string }> }) => {
      store.board ??= { answer: data[0]?.answer ?? '', guesses: [], lastUserId: '', round: 0 };
      return Promise.resolve({ count: 1 });
    }),
    updateMany: vi.fn(
      ({
        where,
        data,
      }: {
        where: { round: number; lastUserId: string; guesses: { equals: string[] } };
        data: Partial<Board> & { round?: { increment: number } };
      }) => {
        hooks.beforeUpdate();
        const board = store.board;
        if (
          board === null ||
          board.round !== where.round ||
          board.lastUserId !== where.lastUserId ||
          board.guesses.join() !== where.guesses.equals.join()
        ) {
          return Promise.resolve({ count: 0 });
        }
        const { round, ...rest } = data;
        Object.assign(board, rest);
        if (round !== undefined) board.round += round.increment;
        return Promise.resolve({ count: 1 });
      },
    ),
    update: vi.fn(({ data }: { data: Partial<Board> & { round?: { increment: number } } }) => {
      const board = store.board;
      if (board === null) return Promise.resolve({});
      const { round, ...rest } = data;
      Object.assign(board, rest);
      if (round !== undefined) board.round += round.increment;
      return Promise.resolve({});
    }),
  };
  const tx = { wordleState };
  const prisma = {
    guild,
    $transaction: vi.fn((run: (client: typeof tx) => Promise<unknown>) => run(tx)),
  };
  const leaderboard = { award: vi.fn().mockResolvedValue(undefined) };
  const listed = new Set(setup.listed ?? LISTED);
  const picks = [...(setup.picks ?? ['ghost'])];
  const words = {
    isWordleGuess: vi.fn((word: string) => Promise.resolve(listed.has(word))),
    pickWordleAnswer: vi.fn(() =>
      Promise.resolve(picks.length > 1 ? (picks.shift() as string) : (picks[0] as string)),
    ),
  };
  const service = new WordleService(
    prisma as unknown as PrismaService,
    leaderboard as unknown as LeaderboardService,
    words as unknown as GameWordsService,
  );
  return { service, store, guild, wordleState, prisma, leaderboard, words, hooks, tx };
}

const move = (content: string, authorId = ALICE, channelId = CHANNEL) => ({
  channelId,
  authorId,
  content,
});

describe('WordleService.submit: what counts as a move', () => {
  it.each(['', 'hi', 'crane!', 'cranes', 'cra ne', 'crane crane', 'cr4ne', 'crâne', '12345'])(
    'ignores %j without reading anything',
    async (content) => {
      const { service, guild } = build();
      await expect(service.submit(GUILD, move(content))).resolves.toEqual({ status: 'NOTHING' });
      expect(guild.findUnique).not.toHaveBeenCalled();
    },
  );

  it('ignores a guess in another channel, in a server without one, or before any board', async () => {
    for (const setup of [{}, { channelId: null }, { guild: null }, { board: null }] as Setup[]) {
      const { service, wordleState, words } = build(setup);
      const channelId =
        setup.channelId === undefined && setup.guild === undefined && setup.board === undefined
          ? OTHER_CHANNEL
          : CHANNEL;
      await expect(service.submit(GUILD, move('crane', ALICE, channelId))).resolves.toEqual({
        status: 'NOTHING',
      });
      expect(wordleState.updateMany).not.toHaveBeenCalled();
      expect(words.isWordleGuess).not.toHaveBeenCalled();
    }
  });

  it('rejects ids that are not snowflakes', async () => {
    const { service } = build();
    await expect(service.submit('guild', move('crane'))).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_FAILED,
    });
  });

  it('reads the guess case-insensitively and with spaces around it', async () => {
    const { service, store } = build();
    await expect(service.submit(GUILD, move('  CrAnE '))).resolves.toMatchObject({
      status: 'GUESSED',
      guesses: ['crane'],
    });
    expect(store.board?.guesses).toEqual(['crane']);
  });
});

describe('WordleService.submit: a guess', () => {
  it('does not spend a turn on a word that is not in the list', async () => {
    const { service, store, wordleState } = build();
    await expect(service.submit(GUILD, move('zzzzz'))).resolves.toEqual({ status: 'NOT_IN_LIST' });
    expect(store.board).toMatchObject({ guesses: [], lastUserId: '' });
    expect(wordleState.updateMany).not.toHaveBeenCalled();
  });

  it('takes a turn with a listed word and returns the board with the answer to score it', async () => {
    const { service, store, leaderboard } = build();
    await expect(service.submit(GUILD, move('crane'))).resolves.toEqual({
      status: 'GUESSED',
      guesses: ['crane'],
      answer: 'plumb',
    });
    expect(store.board).toMatchObject({ guesses: ['crane'], lastUserId: ALICE, round: 2 });
    expect(leaderboard.award).not.toHaveBeenCalled();
  });

  it('refuses the same player twice in a row, and says nothing when it is the same word', async () => {
    const { service, store } = build({ board: { guesses: ['crane'], lastUserId: ALICE } });
    await expect(service.submit(GUILD, move('slate', ALICE))).resolves.toEqual({
      status: 'SAME_USER',
    });
    await expect(service.submit(GUILD, move('crane', ALICE))).resolves.toEqual({
      status: 'NOTHING',
    });
    expect(store.board?.guesses).toEqual(['crane']);
  });

  it('refuses a word the channel already tried, without a turn', async () => {
    const { service, store } = build({ board: { guesses: ['crane'], lastUserId: ALICE } });
    await expect(service.submit(GUILD, move('crane', BOB))).resolves.toEqual({
      status: 'ALREADY_GUESSED',
    });
    expect(store.board?.guesses).toEqual(['crane']);
  });

  it('lets another player continue the board', async () => {
    const { service, store } = build({ board: { guesses: ['crane'], lastUserId: ALICE } });
    await expect(service.submit(GUILD, move('slate', BOB))).resolves.toMatchObject({
      status: 'GUESSED',
      guesses: ['crane', 'slate'],
    });
    expect(store.board?.lastUserId).toBe(BOB);
  });
});

describe('WordleService.submit: the end of a board', () => {
  it('solves on the right word, awards one point and replaces the board', async () => {
    const { service, store, leaderboard, tx } = build({
      board: { guesses: ['crane'], lastUserId: ALICE },
      picks: ['ghost'],
    });
    await expect(service.submit(GUILD, move('plumb', BOB))).resolves.toEqual({
      status: 'SOLVED',
      guesses: ['crane', 'plumb'],
      answer: 'plumb',
    });
    expect(store.board).toEqual({ answer: 'ghost', guesses: [], lastUserId: '', round: 3 });
    expect(leaderboard.award).toHaveBeenCalledTimes(1);
    expect(leaderboard.award).toHaveBeenCalledWith(tx, 'guild-key', 'WORDLE', BOB);
  });

  it('counts the right word on the last turn as a win, not a loss', async () => {
    const earlier = ['crane', 'slate', 'about', 'other', 'fuzzy'];
    expect(earlier).toHaveLength(WORDLE_MAX_GUESSES - 1);
    const { service, leaderboard } = build({ board: { guesses: earlier, lastUserId: ALICE } });
    await expect(service.submit(GUILD, move('plumb', BOB))).resolves.toMatchObject({
      status: 'SOLVED',
    });
    expect(leaderboard.award).toHaveBeenCalledTimes(1);
  });

  it('loses after the last allowed guess: a new board, no point', async () => {
    const full = ['crane', 'slate', 'about', 'other', 'fuzzy'];
    expect(full).toHaveLength(WORDLE_MAX_GUESSES - 1);
    const { service, store, leaderboard } = build({
      board: { guesses: full, lastUserId: ALICE },
      picks: ['ghost'],
    });
    await expect(service.submit(GUILD, move('irate', BOB))).resolves.toEqual({
      status: 'LOST',
      guesses: [...full, 'irate'],
      answer: 'plumb',
    });
    expect(store.board).toEqual({ answer: 'ghost', guesses: [], lastUserId: '', round: 3 });
    expect(leaderboard.award).not.toHaveBeenCalled();
  });

  it('draws again when the new answer would repeat the old one', async () => {
    const { service, store, words } = build({
      board: { guesses: ['crane'], lastUserId: ALICE },
      picks: ['plumb', 'ghost'],
    });
    await service.submit(GUILD, move('plumb', BOB));
    expect(words.pickWordleAnswer).toHaveBeenCalledTimes(2);
    expect(store.board?.answer).toBe('ghost');
  });

  it('lets the first player of a new board be the one who just won', async () => {
    const { service } = build({
      board: { guesses: ['crane'], lastUserId: ALICE },
      picks: ['ghost'],
    });
    await service.submit(GUILD, move('plumb', BOB));
    await expect(service.submit(GUILD, move('crane', BOB))).resolves.toMatchObject({
      status: 'GUESSED',
    });
  });
});

describe('WordleService.submit: concurrent guesses', () => {
  it('judges again when another guess took the turn first', async () => {
    const { service, store, hooks, guild } = build();
    let raced = false;
    hooks.beforeUpdate = () => {
      if (raced) return;
      raced = true;
      Object.assign(store.board ?? {}, { guesses: ['slate'], lastUserId: BOB });
    };
    await expect(service.submit(GUILD, move('crane', CAROL))).resolves.toMatchObject({
      status: 'GUESSED',
      guesses: ['slate', 'crane'],
    });
    expect(guild.findUnique).toHaveBeenCalledTimes(2);
    expect(store.board).toMatchObject({ guesses: ['slate', 'crane'], lastUserId: CAROL });
  });

  it('gives the point to one of two right answers sent at once', async () => {
    const { service, store, hooks, leaderboard } = build({ picks: ['ghost'] });
    let raced = false;
    hooks.beforeUpdate = () => {
      if (raced) return;
      raced = true;
      // Bob solved it first: new board, new round.
      Object.assign(store.board ?? {}, { answer: 'ghost', guesses: [], lastUserId: '', round: 3 });
    };
    await expect(service.submit(GUILD, move('plumb', ALICE))).resolves.toMatchObject({
      status: 'GUESSED',
      answer: 'ghost',
    });
    expect(leaderboard.award).not.toHaveBeenCalled();
  });

  it('gives up with an error after sixteen lost races', async () => {
    const { service, wordleState, leaderboard } = build();
    wordleState.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.submit(GUILD, move('crane'))).rejects.toThrow(/kept losing the race/u);
    expect(wordleState.updateMany).toHaveBeenCalledTimes(16);
    expect(leaderboard.award).not.toHaveBeenCalled();
  });
});

describe('WordleService.restart', () => {
  it('replaces the board and reports the answer it replaced', async () => {
    const { service, store, tx } = build({
      board: { guesses: ['crane'], lastUserId: ALICE },
      picks: ['ghost'],
    });
    await expect(service.restart(tx as never, 'guild-key')).resolves.toEqual({
      game: 'WORDLE',
      previous: 'plumb',
    });
    expect(store.board).toEqual({ answer: 'ghost', guesses: [], lastUserId: '', round: 3 });
  });

  it('makes the first board for a server that never had one', async () => {
    const { service, store, tx } = build({ board: null, picks: ['ghost'] });
    await expect(service.restart(tx as never, 'guild-key')).resolves.toEqual({
      game: 'WORDLE',
      previous: null,
    });
    expect(store.board).toMatchObject({ answer: 'ghost', guesses: [] });
  });
});
