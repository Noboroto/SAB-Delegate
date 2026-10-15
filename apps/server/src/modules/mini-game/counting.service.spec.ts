import 'reflect-metadata';
import { ErrorCode } from '@sab/shared';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { LeaderboardService } from '../game-core/leaderboard.service.js';
import { CountingService } from './counting.service.js';

const GUILD = '100000000000000001';
const CHANNEL = '200000000000000001';
const OTHER_CHANNEL = '200000000000000002';
const ALICE = '300000000000000001';
const BOB = '300000000000000002';

type Counting = { count: number; lastUserId: string; best: number };

type Setup = {
  /** `null`: the server never played, so there is no state row. */
  state?: Partial<Counting> | null;
  channelId?: string | null;
  guild?: null;
};

function build(setup: Setup = {}) {
  const store = {
    state: setup.state === null ? null : { count: 0, lastUserId: '', best: 0, ...setup.state },
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
              counting: store.state === null ? null : { ...store.state },
            },
      ),
    ),
  };
  const countingState = {
    createMany: vi.fn(() => {
      store.state ??= { count: 0, lastUserId: '', best: 0 };
      return Promise.resolve({ count: 1 });
    }),
    updateMany: vi.fn(
      ({
        where,
        data,
      }: {
        where: { count: number; lastUserId: string };
        data: Partial<Counting>;
      }) => {
        hooks.beforeUpdate();
        const state = store.state;
        if (
          state === null ||
          state.count !== where.count ||
          state.lastUserId !== where.lastUserId
        ) {
          return Promise.resolve({ count: 0 });
        }
        Object.assign(state, data);
        return Promise.resolve({ count: 1 });
      },
    ),
    update: vi.fn(({ data }: { data: Partial<Counting> }) => {
      Object.assign(store.state ?? {}, data);
      return Promise.resolve({});
    }),
  };
  const tx = { countingState };
  const prisma = {
    guild,
    $transaction: vi.fn((run: (client: typeof tx) => Promise<unknown>) => run(tx)),
  };
  const leaderboard = { award: vi.fn().mockResolvedValue(undefined) };
  const service = new CountingService(
    prisma as unknown as PrismaService,
    leaderboard as unknown as LeaderboardService,
  );
  return { service, store, guild, countingState, prisma, leaderboard, hooks, tx };
}

const move = (content: string, authorId = ALICE, channelId = CHANNEL) => ({
  channelId,
  authorId,
  content,
});

describe('CountingService.submit: what counts as a move', () => {
  it.each([
    '',
    ' ',
    'hello',
    '1 2',
    '1.5',
    '-1',
    '1e3',
    '12345678901',
    '#1',
    'one',
    '٣',
    '007',
    '01',
    '00',
    '001',
  ])('ignores %j without reading anything', async (content) => {
    const { service, guild } = build();
    await expect(service.submit(GUILD, move(content))).resolves.toEqual({ status: 'NOTHING' });
    expect(guild.findUnique).not.toHaveBeenCalled();
  });

  it('accepts a number with spaces around it', async () => {
    const { service, store } = build();
    await expect(service.submit(GUILD, move('  1 '))).resolves.toEqual({
      status: 'COUNTED',
      count: 1,
    });
    expect(store.state?.count).toBe(1);
  });

  it('reads a lone 0 as a number, and as a wrong one', async () => {
    const { service } = build();
    await expect(service.submit(GUILD, move('0'))).resolves.toMatchObject({
      status: 'WRONG_NUMBER',
      expected: 1,
    });
  });

  it('ignores a number in another channel, in a server without one, or for an unknown server', async () => {
    for (const setup of [{}, { channelId: null }, { guild: null }] as Setup[]) {
      const { service, countingState } = build(setup);
      const channelId =
        setup.channelId === undefined && setup.guild === undefined ? OTHER_CHANNEL : CHANNEL;
      await expect(service.submit(GUILD, move('1', ALICE, channelId))).resolves.toEqual({
        status: 'NOTHING',
      });
      expect(countingState.updateMany).not.toHaveBeenCalled();
    }
  });

  it('rejects ids that are not snowflakes', async () => {
    const { service } = build();
    await expect(service.submit('guild', move('1'))).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_FAILED,
    });
    await expect(service.submit(GUILD, { ...move('1'), authorId: 'me' })).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_FAILED,
    });
  });
});

describe('CountingService.submit: the count', () => {
  it('counts 1 on a server that has no state row yet', async () => {
    const { service, store, leaderboard, tx } = build({ state: null });
    await expect(service.submit(GUILD, move('1'))).resolves.toEqual({
      status: 'COUNTED',
      count: 1,
    });
    expect(store.state).toEqual({ count: 1, lastUserId: ALICE, best: 1 });
    expect(leaderboard.award).toHaveBeenCalledTimes(1);
    expect(leaderboard.award).toHaveBeenCalledWith(tx, 'guild-key', 'COUNTING', ALICE);
  });

  it('counts the next number from another player and awards exactly one point', async () => {
    const { service, store, leaderboard } = build({
      state: { count: 4, lastUserId: ALICE, best: 9 },
    });
    await expect(service.submit(GUILD, move('5', BOB))).resolves.toEqual({
      status: 'COUNTED',
      count: 5,
    });
    expect(store.state).toEqual({ count: 5, lastUserId: BOB, best: 9 });
    expect(leaderboard.award).toHaveBeenCalledTimes(1);
    expect(leaderboard.award).toHaveBeenCalledWith(expect.anything(), 'guild-key', 'COUNTING', BOB);
  });

  it('raises the record only when the count passes it', async () => {
    const { service, store } = build({ state: { count: 9, lastUserId: ALICE, best: 9 } });
    await service.submit(GUILD, move('10', BOB));
    expect(store.state?.best).toBe(10);
  });

  it('starts over on a wrong number, keeps the record and awards nothing', async () => {
    const { service, store, leaderboard } = build({
      state: { count: 4, lastUserId: ALICE, best: 12 },
    });
    await expect(service.submit(GUILD, move('7', BOB))).resolves.toEqual({
      status: 'WRONG_NUMBER',
      expected: 5,
      best: 12,
    });
    expect(store.state).toEqual({ count: 0, lastUserId: '', best: 12 });
    expect(leaderboard.award).not.toHaveBeenCalled();
  });

  it('starts over when the same player counts twice in a row, even with the right number', async () => {
    const { service, store, leaderboard } = build({
      state: { count: 4, lastUserId: ALICE, best: 12 },
    });
    await expect(service.submit(GUILD, move('5', ALICE))).resolves.toEqual({
      status: 'SAME_USER',
      best: 12,
    });
    expect(store.state).toEqual({ count: 0, lastUserId: '', best: 12 });
    expect(leaderboard.award).not.toHaveBeenCalled();
  });

  it('answers a wrong first number with the number it wanted', async () => {
    const { service } = build({ state: { count: 0, lastUserId: '', best: 3 } });
    await expect(service.submit(GUILD, move('2'))).resolves.toEqual({
      status: 'WRONG_NUMBER',
      expected: 1,
      best: 3,
    });
  });

  it('ignores the very number that already stands, sent again by the same player', async () => {
    const { service, store, leaderboard, countingState } = build({
      state: { count: 5, lastUserId: ALICE, best: 5 },
    });
    await expect(service.submit(GUILD, move('5', ALICE))).resolves.toEqual({ status: 'NOTHING' });
    expect(store.state).toEqual({ count: 5, lastUserId: ALICE, best: 5 });
    expect(countingState.updateMany).not.toHaveBeenCalled();
    expect(leaderboard.award).not.toHaveBeenCalled();
  });

  it('still judges the standing number when another player repeats it', async () => {
    const { service } = build({ state: { count: 5, lastUserId: ALICE, best: 5 } });
    await expect(service.submit(GUILD, move('5', BOB))).resolves.toMatchObject({
      status: 'WRONG_NUMBER',
      expected: 6,
    });
  });
});

describe('CountingService.submit: concurrent moves', () => {
  it('judges again against the new count when it loses the race', async () => {
    const { service, store, leaderboard, hooks, guild } = build({
      state: { count: 4, lastUserId: ALICE, best: 4 },
    });
    // The first judging reads count 4; before it writes, Bob's 5 lands.
    let raced = false;
    hooks.beforeUpdate = () => {
      if (raced) return;
      raced = true;
      Object.assign(store.state ?? {}, { count: 5, lastUserId: BOB, best: 5 });
    };
    await expect(service.submit(GUILD, move('5', BOB))).resolves.toEqual({ status: 'NOTHING' });
    // Second read sees 5 by Bob: the same message again, so it is ignored.
    expect(guild.findUnique).toHaveBeenCalledTimes(2);
    expect(leaderboard.award).not.toHaveBeenCalled();
  });

  it('counts a number that lost to a different player on the count they left', async () => {
    const { service, store, leaderboard, hooks } = build({
      state: { count: 4, lastUserId: ALICE, best: 4 },
    });
    let raced = false;
    hooks.beforeUpdate = () => {
      if (raced) return;
      raced = true;
      Object.assign(store.state ?? {}, { count: 5, lastUserId: BOB, best: 5 });
    };
    // Carol's 6 was judged against 4 (wrong), but by the retry the count is 5.
    const CAROL = '300000000000000003';
    await expect(service.submit(GUILD, move('6', CAROL))).resolves.toEqual({
      status: 'COUNTED',
      count: 6,
    });
    expect(store.state).toEqual({ count: 6, lastUserId: CAROL, best: 6 });
    expect(leaderboard.award).toHaveBeenCalledTimes(1);
  });

  it('gives up with an error after sixteen lost races instead of looping forever', async () => {
    const { service, countingState, leaderboard } = build({
      state: { count: 4, lastUserId: ALICE, best: 4 },
    });
    countingState.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.submit(GUILD, move('5', BOB))).rejects.toThrow(/kept losing the race/u);
    expect(countingState.updateMany).toHaveBeenCalledTimes(16);
    expect(leaderboard.award).not.toHaveBeenCalled();
  });
});

describe('CountingService.restart', () => {
  it('starts the count over at 1 and keeps the record', async () => {
    const { service, store, tx } = build({ state: { count: 7, lastUserId: ALICE, best: 9 } });
    await expect(service.restart(tx as never, 'guild-key')).resolves.toEqual({ game: 'COUNTING' });
    expect(store.state).toEqual({ count: 0, lastUserId: '', best: 9 });
  });

  it('makes the row for a server that never played', async () => {
    const { service, store, tx } = build({ state: null });
    await service.restart(tx as never, 'guild-key');
    expect(store.state).toEqual({ count: 0, lastUserId: '', best: 0 });
  });
});
