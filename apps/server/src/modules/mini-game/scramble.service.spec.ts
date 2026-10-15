import 'reflect-metadata';
import { ErrorCode } from '@sab/shared';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { LeaderboardService } from '../game-core/leaderboard.service.js';
import type { GameWordsService } from './game-words.service.js';
import { ScrambleService } from './scramble.service.js';
import { compactWord } from './vietnamese.js';

const GUILD = '100000000000000001';
const CHANNEL = '200000000000000001';
const OTHER_CHANNEL = '200000000000000002';
const ALICE = '300000000000000001';

type Puzzle = { answer: string; puzzle: string; round: number };

type Setup = {
  /** `null`: no puzzle has been made for the server yet. */
  puzzle?: Partial<Puzzle> | null;
  channelId?: string | null;
  guild?: null;
  words?: string[];
  /** Words `pickVietnamese` hands out, in order. */
  picks?: string[];
};

const WORDS = ['học sinh', 'sinh học', 'con mèo', 'hoà bình'];

function build(setup: Setup = {}) {
  const store = {
    puzzle:
      setup.puzzle === null
        ? null
        : { answer: 'học sinh', puzzle: 'H / Ọ / C', round: 3, ...setup.puzzle },
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
              scramble: store.puzzle === null ? null : { ...store.puzzle },
            },
      ),
    ),
  };
  const scrambleState = {
    findUnique: vi.fn(() => Promise.resolve(store.puzzle === null ? null : { ...store.puzzle })),
    createMany: vi.fn(({ data }: { data: Array<{ answer: string; puzzle: string }> }) => {
      store.puzzle ??= { answer: data[0]?.answer ?? '', puzzle: data[0]?.puzzle ?? '', round: 0 };
      return Promise.resolve({ count: 1 });
    }),
    updateMany: vi.fn(
      ({
        where,
        data,
      }: {
        where: { round: number };
        data: { answer: string; puzzle: string; round: { increment: number } };
      }) => {
        hooks.beforeUpdate();
        if (store.puzzle === null || store.puzzle.round !== where.round) {
          return Promise.resolve({ count: 0 });
        }
        store.puzzle = {
          answer: data.answer,
          puzzle: data.puzzle,
          round: store.puzzle.round + data.round.increment,
        };
        return Promise.resolve({ count: 1 });
      },
    ),
    update: vi.fn(
      ({ data }: { data: { answer: string; puzzle: string; round: { increment: number } } }) => {
        const round = (store.puzzle?.round ?? 0) + data.round.increment;
        store.puzzle = { answer: data.answer, puzzle: data.puzzle, round };
        return Promise.resolve({});
      },
    ),
  };
  const tx = { scrambleState };
  const prisma = {
    guild,
    $transaction: vi.fn((run: (client: typeof tx) => Promise<unknown>) => run(tx)),
  };
  const leaderboard = { award: vi.fn().mockResolvedValue(undefined) };
  const picks = [...(setup.picks ?? ['con mèo'])];
  const known = new Set((setup.words ?? WORDS).map(compactWord));
  const words = {
    isVietnameseWord: vi.fn((text: string) => Promise.resolve(known.has(compactWord(text)))),
    pickVietnamese: vi.fn(() =>
      Promise.resolve(picks.length > 1 ? (picks.shift() as string) : (picks[0] as string)),
    ),
  };
  const service = new ScrambleService(
    prisma as unknown as PrismaService,
    leaderboard as unknown as LeaderboardService,
    words as unknown as GameWordsService,
  );
  return { service, store, guild, scrambleState, prisma, leaderboard, words, hooks, tx };
}

const move = (content: string, authorId = ALICE, channelId = CHANNEL) => ({
  channelId,
  authorId,
  content,
});

describe('ScrambleService.submit: what counts as a move', () => {
  it.each(['', '   ', 'x'.repeat(41)])('ignores %j without reading anything', async (content) => {
    const { service, guild } = build();
    await expect(service.submit(GUILD, move(content))).resolves.toEqual({ status: 'NOTHING' });
    expect(guild.findUnique).not.toHaveBeenCalled();
  });

  it('ignores a message in another channel, in a server without one, or before any puzzle', async () => {
    for (const setup of [{}, { channelId: null }, { guild: null }, { puzzle: null }] as Setup[]) {
      const { service, scrambleState, leaderboard } = build(setup);
      const channelId =
        setup.channelId === undefined && setup.guild === undefined && setup.puzzle === undefined
          ? OTHER_CHANNEL
          : CHANNEL;
      await expect(service.submit(GUILD, move('học sinh', ALICE, channelId))).resolves.toEqual({
        status: 'NOTHING',
      });
      expect(scrambleState.updateMany).not.toHaveBeenCalled();
      expect(leaderboard.award).not.toHaveBeenCalled();
    }
  });

  it('rejects ids that are not snowflakes', async () => {
    const { service } = build();
    await expect(service.submit('guild', move('học sinh'))).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_FAILED,
    });
    await expect(
      service.submit(GUILD, { ...move('học sinh'), channelId: 'here' }),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
  });

  it('ignores an answer made of other letters without checking the word list', async () => {
    const { service, words, leaderboard } = build();
    await expect(service.submit(GUILD, move('con mèo'))).resolves.toEqual({ status: 'NOTHING' });
    expect(words.isVietnameseWord).not.toHaveBeenCalled();
    expect(leaderboard.award).not.toHaveBeenCalled();
  });

  it('ignores a guess with the right letters that is not a listed word', async () => {
    const { service, store, leaderboard } = build({ words: ['con mèo'] });
    await expect(service.submit(GUILD, move('sinh học'))).resolves.toEqual({ status: 'NOTHING' });
    expect(store.puzzle?.round).toBe(3);
    expect(leaderboard.award).not.toHaveBeenCalled();
  });
});

describe('ScrambleService.submit: a right answer', () => {
  it('solves the puzzle, awards one point and returns the next puzzle', async () => {
    const { service, store, leaderboard, tx } = build({ picks: ['con mèo'] });
    const result = await service.submit(GUILD, move('học sinh'));
    expect(result).toMatchObject({
      status: 'SOLVED',
      guess: 'học sinh',
      next: { game: 'SCRAMBLE', answer: 'con mèo', previous: 'học sinh' },
    });
    expect(store.puzzle).toMatchObject({ answer: 'con mèo', round: 4 });
    expect(leaderboard.award).toHaveBeenCalledTimes(1);
    expect(leaderboard.award).toHaveBeenCalledWith(tx, 'guild-key', 'SCRAMBLE', ALICE);
  });

  it('accepts another listed word made of the same letters', async () => {
    const { service, leaderboard } = build();
    await expect(service.submit(GUILD, move('sinh học'))).resolves.toMatchObject({
      status: 'SOLVED',
      guess: 'sinh học',
    });
    expect(leaderboard.award).toHaveBeenCalledTimes(1);
  });

  it('accepts case, extra spaces and the other tone placement', async () => {
    const { service } = build({
      puzzle: { answer: 'hoà bình', puzzle: 'x' },
      words: ['hoà bình'],
    });
    await expect(service.submit(GUILD, move('  HÒA   Bình '))).resolves.toMatchObject({
      status: 'SOLVED',
      guess: 'hòa bình',
    });
  });

  it('draws again when the next puzzle would repeat the one just solved', async () => {
    const { service, words } = build({ picks: ['học sinh', 'con mèo'] });
    const result = await service.submit(GUILD, move('học sinh'));
    expect(words.pickVietnamese).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ next: { answer: 'con mèo' } });
  });

  it('shows the next puzzle shuffled, never as the answer itself', async () => {
    const { service } = build({ picks: ['con mèo'] });
    const result = await service.submit(GUILD, move('học sinh'));
    if (result.status !== 'SOLVED') throw new Error('expected SOLVED');
    expect(result.next.letters).toMatch(/ \/ /u);
    expect(compactWord(result.next.letters.replaceAll(' / ', '').toLowerCase())).not.toBe(
      compactWord('con mèo'),
    );
  });
});

describe('ScrambleService.submit: concurrent answers', () => {
  it('gives the point to one of two right answers sent at once', async () => {
    const { service, leaderboard, hooks, store } = build({ picks: ['con mèo'] });
    // The rival's win lands between this one's read and its write.
    let raced = false;
    hooks.beforeUpdate = () => {
      if (raced) return;
      raced = true;
      store.puzzle = { answer: 'hoà bình', puzzle: 'x', round: 4 };
    };
    await expect(service.submit(GUILD, move('học sinh'))).resolves.toEqual({ status: 'NOTHING' });
    // Judged again against the puzzle the winner left: the letters no longer fit.
    expect(leaderboard.award).not.toHaveBeenCalled();
  });

  it('gives up with an error after sixteen lost races', async () => {
    const { service, scrambleState, leaderboard } = build();
    scrambleState.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.submit(GUILD, move('học sinh'))).rejects.toThrow(/kept losing the race/u);
    expect(scrambleState.updateMany).toHaveBeenCalledTimes(16);
    expect(leaderboard.award).not.toHaveBeenCalled();
  });
});

describe('ScrambleService.restart', () => {
  it('replaces the puzzle, advances the round and reports the answer it replaced', async () => {
    const { service, store, tx } = build({ picks: ['con mèo'] });
    const opening = await service.restart(tx as never, 'guild-key');
    expect(opening).toMatchObject({ game: 'SCRAMBLE', answer: 'con mèo', previous: 'học sinh' });
    expect(store.puzzle).toMatchObject({ answer: 'con mèo', round: 4 });
  });

  it('makes the first puzzle for a server that never had one', async () => {
    const { service, store, tx } = build({ puzzle: null, picks: ['con mèo'] });
    const opening = await service.restart(tx as never, 'guild-key');
    expect(opening).toMatchObject({ answer: 'con mèo', previous: null });
    expect(store.puzzle).toMatchObject({ answer: 'con mèo' });
  });
});
