import 'reflect-metadata';
import { AUDIT_ACTIONS, ErrorCode, WordStatus, type ActorContext } from '@sab/shared';
import { describe, expect, it, vi } from 'vitest';
import type { AuditService } from '../../common/audit/audit.service.js';
import type { GuildLocaleService } from '../../i18n/guild-locale.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { GuildConfigService } from '../guild-config/guild-config.service.js';
import type { DictionaryService } from './dictionary.service.js';
import { WordGameService } from './word-game.service.js';

const GUILD = '100000000000000001';
const CHANNEL = '200000000000000001';
const OTHER_CHANNEL = '200000000000000002';
const ALICE = '300000000000000001';
const BOB = '300000000000000002';
const ACTOR: ActorContext = { source: 'DISCORD', userId: ALICE };

type Round = { started: boolean; count: number; lastWord: string; lastUserId: string };

type Setup = {
  channelId?: string | null;
  maxWords?: number;
  /** `null`: the server never played, so there is no state row. */
  round?: Partial<Round> | null;
  used?: string[];
  /** `null`: the server is unknown to the bot. */
  guild?: null;
  dictionary?: string[];
};

const WORDS = ['apple', 'egg', 'goat', 'tiger', 'rabbit', 'tea', 'eagle'];

const noop = (): void => undefined;

/**
 * An in-memory stand-in for the handful of Prisma calls the service makes. It
 * rolls a transaction back when the callback throws, which is what lets the
 * specs observe "the claim is undone". The real constraints are checked against
 * Postgres in the `.db.spec.ts` next to this file.
 */
function build(setup: Setup = {}) {
  const store = {
    config:
      setup.guild === null
        ? null
        : {
            wordChannelId: setup.channelId === undefined ? CHANNEL : setup.channelId,
            wordMaxWords: setup.maxWords ?? 1500,
          },
    state:
      setup.round === null
        ? null
        : { id: 'state-1', started: true, count: 0, lastWord: '', lastUserId: '', ...setup.round },
    used: [...(setup.used ?? [])],
  };
  const hooks = { beforeTransaction: noop, conflictOnCreate: false };

  const guild = {
    findUnique: vi.fn(() =>
      Promise.resolve(
        setup.guild === null
          ? null
          : { id: 'guild-key', config: store.config, wordGame: store.state },
      ),
    ),
  };
  const wordGameUsedWord = {
    findUnique: vi.fn(({ where }: { where: { stateId_word: { word: string } } }) =>
      Promise.resolve(store.used.includes(where.stateId_word.word) ? { id: 'u' } : null),
    ),
    create: vi.fn(({ data }: { data: { word: string } }) => {
      if (hooks.conflictOnCreate || store.used.includes(data.word)) {
        return Promise.reject(Object.assign(new Error('unique'), { code: 'P2002' }));
      }
      store.used.push(data.word);
      return Promise.resolve({});
    }),
    count: vi.fn(() => Promise.resolve(store.used.length)),
    findMany: vi.fn(({ take, skip = 0 }: { take?: number; skip?: number; orderBy?: unknown }) =>
      Promise.resolve(
        store.used
          .slice(skip, take === undefined ? undefined : skip + take)
          .map((word) => ({ word })),
      ),
    ),
    deleteMany: vi.fn(() => {
      const count = store.used.length;
      store.used = [];
      return Promise.resolve({ count });
    }),
  };
  const wordGameState = {
    createMany: vi.fn(() => {
      store.state ??= { id: 'state-1', started: true, count: 0, lastWord: '', lastUserId: '' };
      return Promise.resolve({ count: 1 });
    }),
    findUniqueOrThrow: vi.fn(() => Promise.resolve({ id: store.state?.id })),
    updateMany: vi.fn(
      ({
        where,
        data,
      }: {
        where: Round & { id: string };
        data: Omit<Round, 'count'> & { count: { increment: number } };
      }) => {
        const state = store.state;
        const matches =
          state !== null &&
          state.id === where.id &&
          state.count === where.count &&
          state.started === where.started &&
          state.lastWord === where.lastWord &&
          state.lastUserId === where.lastUserId;
        if (!matches) return Promise.resolve({ count: 0 });
        state.count += data.count.increment;
        state.started = data.started;
        state.lastWord = data.lastWord;
        state.lastUserId = data.lastUserId;
        return Promise.resolve({ count: 1 });
      },
    ),
    update: vi.fn(({ data }: { data: Round }) => {
      Object.assign(store.state ?? {}, data);
      return Promise.resolve({});
    }),
  };
  const guildConfig = {
    update: vi.fn(({ data }: { data: { wordChannelId?: string; wordMaxWords?: number } }) => {
      Object.assign(store.config ?? {}, data);
      return Promise.resolve({ ...store.config });
    }),
  };
  const tx = { guild, wordGameUsedWord, wordGameState, guildConfig };
  const prisma = {
    ...tx,
    $transaction: vi.fn(async (run: (client: typeof tx) => Promise<unknown>) => {
      hooks.beforeTransaction();
      const snapshot = structuredClone({ state: store.state, used: store.used });
      try {
        return await run(tx);
      } catch (error) {
        store.state = snapshot.state;
        store.used = snapshot.used;
        throw error;
      }
    }),
  };

  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const guilds = {
    assertChannelUsable: vi.fn().mockResolvedValue(undefined),
    ensureGuild: vi.fn().mockResolvedValue({ id: 'guild-key' }),
    wordGameRoute: vi.fn(() =>
      Promise.resolve(
        store.config?.wordChannelId
          ? { channelId: store.config.wordChannelId, maxWords: store.config.wordMaxWords }
          : null,
      ),
    ),
    forgetWordGameRoute: vi.fn(),
  };
  const known = new Set(setup.dictionary ?? WORDS);
  const dictionary = { has: vi.fn((word: string) => Promise.resolve(known.has(word))) };
  const service = new WordGameService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    guilds as unknown as GuildConfigService,
    dictionary as unknown as DictionaryService,
    { resolve: vi.fn().mockResolvedValue('en') } as unknown as GuildLocaleService,
    {} as never,
  );
  return { service, store, prisma, audit, guilds, dictionary, hooks, ...prisma };
}

const move = (content: string, authorId = BOB, channelId = CHANNEL) => ({
  channelId,
  authorId,
  content,
});

/** A round in which Alice has just played "apple". */
const AFTER_APPLE: Setup = {
  round: { started: false, count: 1, lastWord: 'apple', lastUserId: ALICE },
  used: ['apple'],
};

describe('WordGameService.submitWord: what counts as a move', () => {
  it('ignores a message of several words without reading anything', async () => {
    const { service, guild } = build();
    const result = await service.submitWord(GUILD, move('hello there'));
    expect(result.status).toBe(WordStatus.NOTHING);
    expect(guild.findUnique).not.toHaveBeenCalled();
  });

  it.each(['', ' ', '   ', ' apple', 'apple ', 'a b'])('ignores %j', async (content) => {
    const { service, guild, guilds } = build();
    await expect(service.submitWord(GUILD, move(content))).resolves.toMatchObject({
      status: WordStatus.NOTHING,
    });
    expect(guilds.wordGameRoute).not.toHaveBeenCalled();
    expect(guild.findUnique).not.toHaveBeenCalled();
  });

  it.each(['two\nlines', 'tab\tseparated', 'cat\ndog'])(
    'treats %j as one word that is not in the dictionary',
    async (content) => {
      const { service, store } = build();
      await expect(service.submitWord(GUILD, move(content))).resolves.toMatchObject({
        status: WordStatus.NOT_EXIST,
      });
      expect(store.used).toEqual([]);
    },
  );

  it('does not read the game for a message in another channel or a server without one', async () => {
    for (const setup of [{}, { channelId: null }, { guild: null }] as Setup[]) {
      const { service, guild } = build(setup);
      const channelId =
        setup.channelId === undefined && setup.guild === undefined ? OTHER_CHANNEL : CHANNEL;
      await expect(service.submitWord(GUILD, move('apple', BOB, channelId))).resolves.toMatchObject(
        { status: WordStatus.NOTHING },
      );
      expect(guild.findUnique).not.toHaveBeenCalled();
    }
  });

  it('rejects ids that are not snowflakes', async () => {
    const { service } = build();
    await expect(service.submitWord('guild', move('apple'))).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_FAILED,
    });
    await expect(
      service.submitWord(GUILD, { ...move('apple'), authorId: 'me' }),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
  });
});

describe('WordGameService.submitWord: the first word of a round', () => {
  it('is accepted with only the dictionary to satisfy, whoever played last', async () => {
    const { service, store } = build({
      round: { started: true, count: 0, lastWord: 'egg', lastUserId: ALICE },
    });
    // Same player as before the reset and no link to the old last word: both ignored.
    const result = await service.submitWord(GUILD, move('apple', ALICE));
    expect(result).toMatchObject({ status: WordStatus.SUCCESS, count: 1 });
    expect(store.state).toMatchObject({
      started: false,
      count: 1,
      lastWord: 'apple',
      lastUserId: ALICE,
    });
  });

  it('still has to be a word', async () => {
    const { service, store } = build();
    await expect(service.submitWord(GUILD, move('zzzz'))).resolves.toMatchObject({
      status: WordStatus.NOT_EXIST,
    });
    expect(store.state).toMatchObject({ started: true, count: 0 });
    expect(store.used).toEqual([]);
  });

  it('works for a server whose state row does not exist yet', async () => {
    const { service, store } = build({ round: null });
    await expect(service.submitWord(GUILD, move('apple'))).resolves.toMatchObject({
      status: WordStatus.SUCCESS,
      count: 1,
    });
    expect(store.state).toMatchObject({ started: false, count: 1, lastWord: 'apple' });
    expect(store.used).toEqual(['apple']);
  });

  it('lower-cases what was typed and stores the clean word', async () => {
    const { service, store } = build();
    await service.submitWord(GUILD, move('ApPlE'));
    expect(store.used).toEqual(['apple']);
    expect(store.state?.lastWord).toBe('apple');
  });
});

describe('WordGameService.submitWord: the rules after the first word', () => {
  it('accepts a different player who continues the last word', async () => {
    const { service, store } = build(AFTER_APPLE);
    const result = await service.submitWord(GUILD, move('egg'));
    expect(result).toEqual({
      status: WordStatus.SUCCESS,
      count: 2,
      maxWords: 1500,
      finished: false,
    });
    expect(store.used).toEqual(['apple', 'egg']);
    expect(store.state).toMatchObject({ count: 2, lastWord: 'egg', lastUserId: BOB });
  });

  it('refuses the player who played the previous word', async () => {
    const { service, store } = build(AFTER_APPLE);
    await expect(service.submitWord(GUILD, move('egg', ALICE))).resolves.toMatchObject({
      status: WordStatus.SAME_AUTHOR,
    });
    expect(store.used).toEqual(['apple']);
  });

  it('refuses a word that was already played', async () => {
    const { service } = build({
      round: { started: false, count: 3, lastWord: 'tea', lastUserId: ALICE },
      used: ['apple', 'egg', 'tea'],
    });
    await expect(service.submitWord(GUILD, move('apple'))).resolves.toMatchObject({
      status: WordStatus.SAME_WORD,
    });
  });

  it('refuses a word that does not start with the last letter, and names the letter', async () => {
    const { service, store } = build(AFTER_APPLE);
    await expect(service.submitWord(GUILD, move('goat'))).resolves.toMatchObject({
      status: WordStatus.NOT_LINK,
      starter: 'e',
    });
    expect(store.used).toEqual(['apple']);
  });

  it('refuses a word that is not in the dictionary', async () => {
    const { service } = build(AFTER_APPLE);
    await expect(service.submitWord(GUILD, move('ezzz'))).resolves.toMatchObject({
      status: WordStatus.NOT_EXIST,
    });
  });

  it('reports the first rule broken, in the order players meet them', async () => {
    const { service } = build({
      round: { started: false, count: 2, lastWord: 'egg', lastUserId: ALICE },
      used: ['egg', 'qqq'],
    });
    // Same player, an already played word, no link, not a word: the player rule wins.
    await expect(service.submitWord(GUILD, move('qqq', ALICE))).resolves.toMatchObject({
      status: WordStatus.SAME_AUTHOR,
    });
    // Another player: the already-played rule outranks the link and dictionary rules.
    await expect(service.submitWord(GUILD, move('qqq'))).resolves.toMatchObject({
      status: WordStatus.SAME_WORD,
    });
    // Unplayed, but no link and not a word: the link rule outranks the dictionary.
    await expect(service.submitWord(GUILD, move('xyz'))).resolves.toMatchObject({
      status: WordStatus.NOT_LINK,
    });
  });
});

describe('WordGameService.submitWord: the limit', () => {
  it('says the round is over once the limit is reached, and writes nothing', async () => {
    const { service, store } = build({
      maxWords: 200,
      round: { started: false, count: 200, lastWord: 'apple', lastUserId: ALICE },
      used: ['apple'],
    });
    await expect(service.submitWord(GUILD, move('egg'))).resolves.toMatchObject({
      status: WordStatus.MAX_WORD,
      count: 200,
      finished: false,
    });
    expect(store.state?.count).toBe(200);
    expect(store.used).toEqual(['apple']);
  });

  it('flags the word that reaches the limit', async () => {
    const { service, store } = build({
      maxWords: 200,
      round: { started: false, count: 199, lastWord: 'apple', lastUserId: ALICE },
      used: ['apple'],
    });
    await expect(service.submitWord(GUILD, move('egg'))).resolves.toEqual({
      status: WordStatus.SUCCESS,
      count: 200,
      maxWords: 200,
      finished: true,
    });
    expect(store.state?.count).toBe(200);
  });
});

describe('WordGameService.submitWord: concurrent moves', () => {
  it('judges again against the round the winner left when the round changed under it', async () => {
    const { service, store, hooks } = build(AFTER_APPLE);
    // Between the read and the claim another player gets "egg" in first.
    hooks.beforeTransaction = () => {
      hooks.beforeTransaction = noop;
      store.used.push('egg');
      Object.assign(store.state ?? {}, { count: 2, lastWord: 'egg', lastUserId: BOB });
    };
    // Carol plays "egg" too: it is the same word, now that Bob's is committed.
    const result = await service.submitWord(GUILD, move('egg', '300000000000000003'));
    expect(result.status).toBe(WordStatus.SAME_WORD);
    expect(store.used).toEqual(['apple', 'egg']);
    expect(store.state?.count).toBe(2);
  });

  it('accepts a different word that still links after the round moved on', async () => {
    const { service, store, hooks } = build(AFTER_APPLE);
    hooks.beforeTransaction = () => {
      hooks.beforeTransaction = noop;
      store.used.push('eagle');
      Object.assign(store.state ?? {}, { count: 2, lastWord: 'eagle', lastUserId: BOB });
    };
    // Bob's "eagle" got in between; Carol's "egg" links to it just as it did to "apple".
    const result = await service.submitWord(GUILD, move('egg', '300000000000000003'));
    expect(result).toMatchObject({ status: WordStatus.SUCCESS, count: 3 });
    expect(store.used).toEqual(['apple', 'eagle', 'egg']);
  });

  it('turns a unique-key conflict into SAME_WORD and undoes the claim', async () => {
    const { service, store, hooks } = build(AFTER_APPLE);
    hooks.conflictOnCreate = true;
    const result = await service.submitWord(GUILD, move('egg'));
    expect(result.status).toBe(WordStatus.SAME_WORD);
    expect(store.state).toMatchObject({ count: 1, lastWord: 'apple', lastUserId: ALICE });
  });

  it('gives up with an error instead of looping when the round keeps changing', async () => {
    const { service, store, hooks } = build(AFTER_APPLE);
    hooks.beforeTransaction = () => {
      Object.assign(store.state ?? {}, { count: (store.state?.count ?? 0) + 1 });
    };
    await expect(service.submitWord(GUILD, move('egg'))).rejects.toThrow('kept losing the race');
  });

  it('passes a database failure on', async () => {
    const { service, prisma } = build(AFTER_APPLE);
    prisma.$transaction.mockRejectedValueOnce(new Error('connection lost'));
    await expect(service.submitWord(GUILD, move('egg'))).rejects.toThrow('connection lost');
  });
});

describe('WordGameService.configure', () => {
  it('refuses a request that changes nothing or a limit below 200', async () => {
    const { service, audit } = build();
    for (const config of [{}, { maxWords: 199 }, { maxWords: 1.5 }, { channelId: '<#1>' }, null]) {
      await expect(
        service.configure(GUILD, config, ACTOR),
        JSON.stringify(config),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_FAILED,
      });
    }
    await expect(service.configure('nope', { maxWords: 300 }, ACTOR)).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_FAILED,
    });
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('checks the channel with Discord before opening a transaction, and writes nothing when refused', async () => {
    const { service, guilds, prisma, audit } = build();
    const refusal = Object.assign(new Error('refused'), {
      code: ErrorCode.DISCORD_MISSING_PERMISSIONS,
    });
    guilds.assertChannelUsable.mockRejectedValueOnce(refusal);
    await expect(service.configure(GUILD, { channelId: OTHER_CHANNEL }, ACTOR)).rejects.toBe(
      refusal,
    );
    expect(guilds.assertChannelUsable).toHaveBeenCalledWith('wordChannelId', OTHER_CHANNEL);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('starts a new round in a new channel: clears the words, resets the state, audits', async () => {
    const { service, store, audit } = build(AFTER_APPLE);
    const result = await service.configure(
      GUILD,
      { channelId: OTHER_CHANNEL, maxWords: 400 },
      ACTOR,
    );
    expect(result).toEqual({
      before: { channelId: CHANNEL, maxWords: 1500 },
      after: { channelId: OTHER_CHANNEL, maxWords: 400 },
      restarted: true,
      clearedWords: 1,
      sample: ['apple'],
      dryRun: false,
    });
    expect(store.used).toEqual([]);
    expect(store.state).toMatchObject({ started: true, count: 0, lastWord: '', lastUserId: '' });
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(
      {
        guildId: GUILD,
        actor: ACTOR,
        action: AUDIT_ACTIONS.wordGameConfigure,
        params: {
          before: { wordChannelId: CHANNEL, wordMaxWords: 1500 },
          after: { wordChannelId: OTHER_CHANNEL, wordMaxWords: 400 },
          count: 1,
        },
      },
      expect.anything(),
    );
  });

  it('changes only the limit and keeps the round being played', async () => {
    const { service, store, guilds } = build(AFTER_APPLE);
    const result = await service.configure(GUILD, { maxWords: 300 }, ACTOR);
    expect(result).toMatchObject({
      before: { channelId: CHANNEL, maxWords: 1500 },
      after: { channelId: CHANNEL, maxWords: 300 },
      restarted: false,
      clearedWords: 0,
    });
    expect(store.used).toEqual(['apple']);
    expect(store.state).toMatchObject({ started: false, count: 1, lastWord: 'apple' });
    expect(guilds.assertChannelUsable).not.toHaveBeenCalled();
  });

  it('with dryRun reports the plan and writes nothing: no row, no audit entry', async () => {
    const { service, store, prisma, audit, guildConfig, wordGameState, wordGameUsedWord } =
      build(AFTER_APPLE);
    const result = await service.configure(GUILD, { channelId: OTHER_CHANNEL }, ACTOR, {
      dryRun: true,
    });
    expect(result).toEqual({
      before: { channelId: CHANNEL, maxWords: 1500 },
      after: { channelId: OTHER_CHANNEL, maxWords: 1500 },
      restarted: true,
      clearedWords: 1,
      sample: ['apple'],
      dryRun: true,
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(guildConfig.update).not.toHaveBeenCalled();
    expect(wordGameState.update).not.toHaveBeenCalled();
    expect(wordGameUsedWord.deleteMany).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(store.used).toEqual(['apple']);
    expect(store.config).toMatchObject({ wordChannelId: CHANNEL });
  });

  it('plans the same wipe that the real run then carries out', async () => {
    const { service } = build({ ...AFTER_APPLE, used: ['apple', 'egg', 'goat'] });
    const plan = await service.configure(GUILD, { channelId: OTHER_CHANNEL }, ACTOR, {
      dryRun: true,
    });
    const done = await service.configure(GUILD, { channelId: OTHER_CHANNEL }, ACTOR, {
      dryRun: false,
    });
    expect(done.clearedWords).toBe(plan.clearedWords);
    expect(done.sample).toEqual(plan.sample);
    expect(done.after).toEqual(plan.after);
  });

  it('caps the sample of a long list at ten words', async () => {
    const used = Array.from({ length: 40 }, (_, index) => `w${index}`);
    const { service } = build({ ...AFTER_APPLE, used });
    const plan = await service.configure(GUILD, { channelId: OTHER_CHANNEL }, ACTOR, {
      dryRun: true,
    });
    expect(plan.clearedWords).toBe(40);
    expect(plan.sample).toHaveLength(10);
  });
});

describe('WordGameService: the cached game route', () => {
  it('is dropped after a committed configure and reset, and not after a dry run or a failure', async () => {
    const { service, guilds } = build(AFTER_APPLE);
    await service.configure(GUILD, { maxWords: 300 }, ACTOR, { dryRun: true });
    await service.reset(GUILD, ACTOR, { dryRun: true });
    expect(guilds.forgetWordGameRoute).not.toHaveBeenCalled();

    await service.configure(GUILD, { maxWords: 300 }, ACTOR);
    expect(guilds.forgetWordGameRoute).toHaveBeenCalledTimes(1);
    await service.reset(GUILD, ACTOR);
    expect(guilds.forgetWordGameRoute).toHaveBeenCalledTimes(2);
    expect(guilds.forgetWordGameRoute).toHaveBeenCalledWith(GUILD);

    const failing = build();
    failing.audit.record.mockRejectedValueOnce(new Error('audit down'));
    await expect(failing.service.configure(GUILD, { maxWords: 300 }, ACTOR)).rejects.toThrow();
    expect(failing.guilds.forgetWordGameRoute).not.toHaveBeenCalled();
  });

  it('still judges a move on a fresh read when the route says the channel matches', async () => {
    const { service, guilds, store } = build();
    store.config = null;
    guilds.wordGameRoute.mockResolvedValueOnce({ channelId: CHANNEL, maxWords: 1500 });
    await expect(service.submitWord(GUILD, move('apple'))).resolves.toMatchObject({
      status: WordStatus.NOTHING,
    });
    expect(store.used).toEqual([]);
  });
});

describe('WordGameService.reset', () => {
  it('clears the round and keeps channel and limit, with an audit entry', async () => {
    const { service, store, audit } = build({ ...AFTER_APPLE, maxWords: 300 });
    await expect(service.reset(GUILD, ACTOR)).resolves.toEqual({
      status: 'RESET',
      channelId: CHANNEL,
      clearedWords: 1,
      sample: ['apple'],
      dryRun: false,
    });
    expect(store.used).toEqual([]);
    expect(store.state).toMatchObject({ started: true, count: 0, lastWord: '', lastUserId: '' });
    expect(store.config).toMatchObject({ wordChannelId: CHANNEL, wordMaxWords: 300 });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        guildId: GUILD,
        actor: ACTOR,
        action: AUDIT_ACTIONS.wordGameReset,
        params: { wordChannelId: CHANNEL, count: 1 },
      }),
      expect.anything(),
    );
  });

  it('says so, and writes and audits nothing, for a server without a game channel', async () => {
    for (const setup of [{ channelId: null }, { guild: null }] as Setup[]) {
      const { service, audit, wordGameState } = build(setup);
      await expect(service.reset(GUILD, ACTOR)).resolves.toMatchObject({
        status: 'NOT_CONFIGURED',
        channelId: null,
        dryRun: false,
      });
      expect(wordGameState.update).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    }
  });

  it('with dryRun counts what would be cleared and changes nothing', async () => {
    const { service, store, prisma, audit } = build(AFTER_APPLE);
    await expect(service.reset(GUILD, ACTOR, { dryRun: true })).resolves.toEqual({
      status: 'RESET',
      channelId: CHANNEL,
      clearedWords: 1,
      sample: ['apple'],
      dryRun: true,
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(store.used).toEqual(['apple']);
    expect(store.state).toMatchObject({ count: 1 });
  });

  it('with dryRun still reports that nothing is configured', async () => {
    const { service } = build({ channelId: null });
    await expect(service.reset(GUILD, ACTOR, { dryRun: true })).resolves.toMatchObject({
      status: 'NOT_CONFIGURED',
      dryRun: true,
    });
  });

  it('takes the lock on the state row before it deletes the words', async () => {
    const { service, wordGameState, wordGameUsedWord } = build(AFTER_APPLE);
    await service.reset(GUILD, ACTOR);
    const updateAt = wordGameState.update.mock.invocationCallOrder[0] ?? 0;
    const deleteAt = wordGameUsedWord.deleteMany.mock.invocationCallOrder[0] ?? 0;
    expect(updateAt).toBeGreaterThan(0);
    expect(updateAt).toBeLessThan(deleteAt);
  });
});

describe('WordGameService.status and listUsedWords', () => {
  it('describes the round and whether it is finished', async () => {
    const { service } = build({
      maxWords: 200,
      round: { started: false, count: 200, lastWord: 'apple', lastUserId: ALICE },
    });
    await expect(service.status(GUILD)).resolves.toEqual({
      started: false,
      lastWord: 'apple',
      lastUserId: ALICE,
      channelId: CHANNEL,
      maxWords: 200,
      count: 200,
      finished: true,
    });
  });

  it('reads a server that never played as a round nobody started', async () => {
    const { service } = build({ round: null, channelId: null });
    await expect(service.status(GUILD)).resolves.toMatchObject({
      channelId: null,
      count: 0,
      started: true,
      finished: false,
    });
  });

  it('answers GUILD_NOT_FOUND for a server the bot never saw', async () => {
    const { service } = build({ guild: null });
    await expect(service.status(GUILD)).rejects.toMatchObject({ code: ErrorCode.GUILD_NOT_FOUND });
    await expect(service.listUsedWords(GUILD)).rejects.toMatchObject({
      code: ErrorCode.GUILD_NOT_FOUND,
    });
  });

  it('pages the used words', async () => {
    const { service } = build({
      ...AFTER_APPLE,
      used: ['apple', 'egg', 'goat', 'tiger', 'rabbit'],
    });
    await expect(service.listUsedWords(GUILD, { page: '2', pageSize: '2' })).resolves.toEqual({
      items: [{ word: 'goat' }, { word: 'tiger' }],
      pagination: { page: 2, pageSize: 2, total: 5 },
    });
    await expect(service.listUsedWords(GUILD, { pageSize: 0 })).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_FAILED,
    });
  });

  it('lists nothing for a server without a round', async () => {
    const { service } = build({ round: null });
    await expect(service.listUsedWords(GUILD)).resolves.toEqual({
      items: [],
      pagination: { page: 1, pageSize: 20, total: 0 },
    });
  });
});
