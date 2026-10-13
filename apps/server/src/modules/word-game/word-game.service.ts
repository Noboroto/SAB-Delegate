import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  AUDIT_ACTIONS,
  ErrorCode,
  SnowflakeSchema,
  WORD_MAX_WORDS_DEFAULT,
  WordGameConfigSchema,
  WordGameInfoSchema,
  WordGameWordsQuerySchema,
  WordStatus,
  WordSubmitInputSchema,
  type ActorContext,
  type WordGameConfigResult,
  type WordGameInfo,
  type WordGameResetResult,
  type WordGameSettings,
  type WordGameWordsPage,
  type WordSubmitResult,
} from '@sab/shared';
import { Client } from 'discord.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { ServiceError } from '../../common/errors/service-error.js';
import { discordErrorCode } from '../../discord/helpers/reply.js';
import { GuildLocaleService } from '../../i18n/guild-locale.service.js';
import { translatorFor } from '../../i18n/translator.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { GuildConfigService } from '../guild-config/guild-config.service.js';
import { DictionaryService } from './dictionary.service.js';

type Db = Pick<Prisma.TransactionClient, 'guild' | 'wordGameState' | 'wordGameUsedWord'>;

type Round = { started: boolean; count: number; lastWord: string; lastUserId: string };

/** A server that never played has no state row; it reads as a round nobody has started. */
const FRESH_ROUND: Round = { started: true, count: 0, lastWord: '', lastUserId: '' };

type Game = {
  /** Internal key of the server row. */
  guildKey: string;
  channelId: string | null;
  maxWords: number;
  stateId: string | null;
  round: Round;
};

type UsedWordsPlan = { clearedWords: number; sample: string[] };

type Options = { dryRun?: boolean };

type ClaimOutcome = 'CLAIMED' | 'LOST_RACE' | 'ALREADY_PLAYED';

function emptyWipe(): UsedWordsPlan {
  return { clearedWords: 0, sample: [] };
}

/** How many used words a dry run shows as an example of what a new round wipes. */
const SAMPLE_SIZE = 10;

/**
 * A move that loses the compare-and-swap is judged again against the round the
 * winner left. Each loss means another move was accepted, so a handful of
 * rounds is far more than a channel can produce between two reads.
 */
const MAX_ATTEMPTS = 16;

const UNKNOWN_CHANNEL = 10003;
const MISSING_ACCESS = 50001;
const MISSING_PERMISSIONS = 50013;

const GAME_SELECT = {
  id: true,
  config: { select: { wordChannelId: true, wordMaxWords: true } },
  wordGame: {
    select: { id: true, started: true, count: true, lastWord: true, lastUserId: true },
  },
} satisfies Prisma.GuildSelect;

type GameRow = Prisma.GuildGetPayload<{ select: typeof GAME_SELECT }>;

function toGame(row: GameRow): Game {
  const state = row.wordGame;
  return {
    guildKey: row.id,
    channelId: row.config?.wordChannelId ?? null,
    maxWords: row.config?.wordMaxWords ?? WORD_MAX_WORDS_DEFAULT,
    stateId: state?.id ?? null,
    round:
      state === null
        ? FRESH_ROUND
        : {
            started: state.started,
            count: state.count,
            lastWord: state.lastWord,
            lastUserId: state.lastUserId,
          },
  };
}

function settingsOf(game: Game | null): WordGameSettings {
  return {
    channelId: game?.channelId ?? null,
    maxWords: game?.maxWords ?? WORD_MAX_WORDS_DEFAULT,
  };
}

function parseGuildId(guildId: string): string {
  const parsed = SnowflakeSchema.safeParse(guildId);
  if (!parsed.success) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
  return parsed.data;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

/** Thrown inside the transaction so the claim made just before it rolls back too. */
class WordAlreadyPlayed extends Error {}

/**
 * The word-chain game of a server. The slash commands, the REST API and the MCP
 * tools all go through here.
 *
 * Moves are made atomic by the database, not by a lock in the process: a move
 * is judged on a read of the round and then applied only if the round is still
 * exactly as it was read (the `updateMany` below changes nothing otherwise),
 * and the `(round, word)` unique key refuses a word twice. Two bots, two
 * processes or two messages in the same millisecond therefore cannot push the
 * count past the limit or play one word twice.
 */
@Injectable()
export class WordGameService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly guilds: GuildConfigService,
    private readonly dictionary: DictionaryService,
    private readonly locales: GuildLocaleService,
    private readonly client: Client,
  ) {}

  /**
   * Judges one message and, when it is a valid move, records it. Nothing here
   * talks to Discord: the caller reacts and replies after the move is committed.
   *
   * Anything that is not a move in the game channel (several words, an empty
   * message, another channel, a server without a game) is `NOTHING`. The text
   * rules a message out first; then a short-lived cached route does, so chat
   * in every other channel costs no database read. A message that passes both
   * is judged on a fresh read of the round, whatever the cache said.
   *
   * Only a space separates words, as it always has: a tab or a line break is
   * part of the word, which then is not in the dictionary.
   */
  async submitWord(guildId: string, input: unknown): Promise<WordSubmitResult> {
    const id = parseGuildId(guildId);
    const parsed = WordSubmitInputSchema.safeParse(input);
    if (!parsed.success) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
    const { channelId, authorId, content } = parsed.data;

    const word = content.toLowerCase();
    if (word === '' || word.includes(' ')) return this.result(WordStatus.NOTHING, FRESH_ROUND, 0);

    const route = await this.guilds.wordGameRoute(id);
    if (route === null || route.channelId !== channelId) {
      return this.result(WordStatus.NOTHING, FRESH_ROUND, route?.maxWords ?? 0);
    }

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const game = await this.loadGame(this.prisma, id);
      if (game === null || game.channelId !== channelId) {
        return this.result(WordStatus.NOTHING, game?.round ?? FRESH_ROUND, game?.maxWords ?? 0);
      }

      const refusal = await this.judge(game, word, authorId);
      if (refusal !== null) return refusal;

      const outcome = await this.claim(game, word, authorId);
      if (outcome === 'LOST_RACE') continue;
      if (outcome === 'ALREADY_PLAYED') {
        return this.result(WordStatus.SAME_WORD, game.round, game.maxWords);
      }
      const round: Round = {
        started: false,
        count: game.round.count + 1,
        lastWord: word,
        lastUserId: authorId,
      };
      return this.result(WordStatus.SUCCESS, round, game.maxWords);
    }
    throw new Error('A word kept losing the race for the round');
  }

  /**
   * The rules of the game, in the order players meet them: the round is not
   * over, then (past the first word) a different player, a word not played yet,
   * a word that continues the last one, and finally a real word. The first word
   * of a round skips the three middle rules but must still be in the dictionary.
   * `null` means the word is acceptable.
   */
  private async judge(
    game: Game,
    word: string,
    authorId: string,
  ): Promise<WordSubmitResult | null> {
    const { round, maxWords } = game;
    if (round.count >= maxWords) return this.result(WordStatus.MAX_WORD, round, maxWords);

    if (!round.started) {
      if (round.lastUserId === authorId) {
        return this.result(WordStatus.SAME_AUTHOR, round, maxWords);
      }
      if (game.stateId !== null && (await this.isUsed(game.stateId, word))) {
        return this.result(WordStatus.SAME_WORD, round, maxWords);
      }
      const starter = round.lastWord.slice(-1);
      if (!word.startsWith(starter)) {
        return this.result(WordStatus.NOT_LINK, round, maxWords, starter);
      }
    }
    if (!(await this.dictionary.has(word)))
      return this.result(WordStatus.NOT_EXIST, round, maxWords);
    return null;
  }

  /**
   * One short transaction, no Discord call in it. The state row is changed only
   * while it is exactly the round that was judged; if another move got in first
   * nothing is changed and the caller judges again.
   */
  private async claim(game: Game, word: string, authorId: string): Promise<ClaimOutcome> {
    try {
      return await this.prisma.$transaction(async (tx): Promise<ClaimOutcome> => {
        let stateId = game.stateId;
        if (stateId === null) {
          await tx.wordGameState.createMany({
            data: [{ guildId: game.guildKey }],
            skipDuplicates: true,
          });
          const created = await tx.wordGameState.findUniqueOrThrow({
            where: { guildId: game.guildKey },
            select: { id: true },
          });
          stateId = created.id;
        }

        const { round } = game;
        const claimed = await tx.wordGameState.updateMany({
          where: {
            id: stateId,
            count: round.count,
            started: round.started,
            lastWord: round.lastWord,
            lastUserId: round.lastUserId,
          },
          data: { count: { increment: 1 }, started: false, lastWord: word, lastUserId: authorId },
        });
        if (claimed.count === 0) return 'LOST_RACE';

        try {
          await tx.wordGameUsedWord.create({ data: { stateId, word } });
        } catch (error) {
          if (!isUniqueViolation(error)) throw error;
          // The failed insert poisons the transaction; leaving by exception
          // also undoes the claim above.
          throw new WordAlreadyPlayed();
        }
        return 'CLAIMED';
      });
    } catch (error) {
      if (error instanceof WordAlreadyPlayed) return 'ALREADY_PLAYED';
      throw error;
    }
  }

  /**
   * Chooses the channel and/or the limit. A channel starts a new round there
   * (the used words are cleared); a limit alone leaves the round being played
   * alone. With `dryRun` it reports what would change and writes nothing: no
   * row, no audit entry.
   *
   * The channel is checked against Discord before the transaction opens, since
   * a network call must not hold one.
   */
  async configure(
    guildId: string,
    config: unknown,
    actor: ActorContext,
    opts: Options = {},
  ): Promise<WordGameConfigResult> {
    const id = parseGuildId(guildId);
    const parsed = WordGameConfigSchema.safeParse(config);
    if (!parsed.success) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
    const { channelId, maxWords } = parsed.data;
    const restarts = channelId !== undefined;

    if (channelId !== undefined) await this.guilds.assertChannelUsable('wordChannelId', channelId);

    if (opts.dryRun === true) {
      const game = await this.loadGame(this.prisma, id);
      const before = settingsOf(game);
      const wiped = restarts
        ? await this.planWipe(this.prisma, game?.stateId ?? null)
        : emptyWipe();
      return {
        before,
        after: { channelId: channelId ?? before.channelId, maxWords: maxWords ?? before.maxWords },
        restarted: restarts,
        ...wiped,
        dryRun: true,
      };
    }

    const done = await this.prisma.$transaction(async (tx): Promise<WordGameConfigResult> => {
      const guild = await this.guilds.ensureGuild(id, undefined, tx);
      const before = settingsOf(await this.loadGame(tx, id));

      const after = await tx.guildConfig.update({
        where: { guildId: guild.id },
        data: {
          ...(channelId === undefined ? {} : { wordChannelId: channelId }),
          ...(maxWords === undefined ? {} : { wordMaxWords: maxWords }),
        },
        select: { wordChannelId: true, wordMaxWords: true },
      });
      const wiped = restarts ? await this.startRound(tx, guild.id) : emptyWipe();

      const settings: WordGameSettings = {
        channelId: after.wordChannelId,
        maxWords: after.wordMaxWords,
      };
      await this.audit.record(
        {
          guildId: id,
          actor,
          action: AUDIT_ACTIONS.wordGameConfigure,
          params: {
            before: { wordChannelId: before.channelId, wordMaxWords: before.maxWords },
            after: { wordChannelId: settings.channelId, wordMaxWords: settings.maxWords },
            count: wiped.clearedWords,
          },
        },
        tx,
      );
      return { before, after: settings, restarted: restarts, ...wiped, dryRun: false };
    });
    this.guilds.forgetWordGameRoute(id);
    return done;
  }

  /**
   * Starts the round over in the channel already chosen, keeping channel and
   * limit. `NOT_CONFIGURED` (and no write, no audit entry) when the server has
   * no word channel. With `dryRun` it only counts what would be cleared.
   */
  async reset(
    guildId: string,
    actor: ActorContext,
    opts: Options = {},
  ): Promise<WordGameResetResult> {
    const id = parseGuildId(guildId);
    const notConfigured = (dryRun: boolean): WordGameResetResult => ({
      status: 'NOT_CONFIGURED',
      channelId: null,
      ...emptyWipe(),
      dryRun,
    });

    if (opts.dryRun === true) {
      const game = await this.loadGame(this.prisma, id);
      if (game === null || game.channelId === null) return notConfigured(true);
      return {
        status: 'RESET',
        channelId: game.channelId,
        ...(await this.planWipe(this.prisma, game.stateId)),
        dryRun: true,
      };
    }

    const done = await this.prisma.$transaction(async (tx): Promise<WordGameResetResult> => {
      const game = await this.loadGame(tx, id);
      if (game === null || game.channelId === null) return notConfigured(false);
      const wiped = await this.startRound(tx, game.guildKey);
      await this.audit.record(
        {
          guildId: id,
          actor,
          action: AUDIT_ACTIONS.wordGameReset,
          params: { wordChannelId: game.channelId, count: wiped.clearedWords },
        },
        tx,
      );
      return { status: 'RESET', channelId: game.channelId, ...wiped, dryRun: false };
    });
    this.guilds.forgetWordGameRoute(id);
    return done;
  }

  /** The settings and the round being played; `GUILD_NOT_FOUND` for a server the bot never saw. */
  async status(guildId: string): Promise<WordGameInfo> {
    const game = await this.loadGame(this.prisma, parseGuildId(guildId));
    if (game === null) throw new ServiceError(ErrorCode.GUILD_NOT_FOUND);
    return WordGameInfoSchema.parse({
      ...game.round,
      channelId: game.channelId,
      maxWords: game.maxWords,
      finished: game.round.count >= game.maxWords,
    });
  }

  /** The words of the current round, in the order they were played unless told otherwise. */
  async listUsedWords(guildId: string, query: unknown = {}): Promise<WordGameWordsPage> {
    const id = parseGuildId(guildId);
    const parsed = WordGameWordsQuerySchema.safeParse(query);
    if (!parsed.success) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
    const { page, pageSize, sort, order } = parsed.data;

    const game = await this.loadGame(this.prisma, id);
    if (game === null) throw new ServiceError(ErrorCode.GUILD_NOT_FOUND);
    const pagination = { page, pageSize, total: 0 };
    if (game.stateId === null) return { items: [], pagination };

    const where = { stateId: game.stateId };
    const [total, items] = await Promise.all([
      this.prisma.wordGameUsedWord.count({ where }),
      this.prisma.wordGameUsedWord.findMany({
        where,
        select: { word: true },
        // The id is a UUIDv7, so it sorts by the moment the word was played.
        orderBy: sort === 'word' ? [{ word: order }, { id: 'asc' }] : [{ id: order }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { items, pagination: { ...pagination, total } };
  }

  /**
   * Posts the opening message of a round in the game channel. Called after the
   * write that started the round has committed, never inside its transaction.
   */
  async announceStart(guildId: string, channelId: string): Promise<void> {
    const t = translatorFor(await this.locales.resolve(guildId));
    try {
      const channel = await this.client.channels.fetch(channelId);
      if (channel === null || !channel.isSendable()) {
        throw new ServiceError(ErrorCode.DISCORD_CHANNEL_NOT_FOUND);
      }
      await channel.send(t('word-game.start'));
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      const code = discordErrorCode(error);
      if (code === UNKNOWN_CHANNEL) throw new ServiceError(ErrorCode.DISCORD_CHANNEL_NOT_FOUND);
      if (code === MISSING_ACCESS || code === MISSING_PERMISSIONS) {
        throw new ServiceError(ErrorCode.DISCORD_MISSING_PERMISSIONS, { permission: 'send' });
      }
      throw error;
    }
  }

  private result(
    status: WordSubmitResult['status'],
    round: Round,
    maxWords: number,
    starter?: string,
  ): WordSubmitResult {
    return {
      status,
      count: round.count,
      maxWords,
      ...(starter === undefined ? {} : { starter }),
      finished: status === WordStatus.SUCCESS && round.count >= maxWords,
    };
  }

  private async loadGame(db: Pick<Db, 'guild'>, discordId: string): Promise<Game | null> {
    const row = await db.guild.findUnique({ where: { discordId }, select: GAME_SELECT });
    return row === null ? null : toGame(row);
  }

  private async isUsed(stateId: string, word: string): Promise<boolean> {
    const used = await this.prisma.wordGameUsedWord.findUnique({
      where: { stateId_word: { stateId, word } },
      select: { id: true },
    });
    return used !== null;
  }

  /** What a new round would wipe: how many words, and a few of them as an example. */
  private async planWipe(
    db: Pick<Db, 'wordGameUsedWord'>,
    stateId: string | null,
  ): Promise<UsedWordsPlan> {
    if (stateId === null) return emptyWipe();
    const where = { stateId };
    const [clearedWords, rows] = await Promise.all([
      db.wordGameUsedWord.count({ where }),
      db.wordGameUsedWord.findMany({
        where,
        select: { word: true },
        orderBy: { id: 'asc' },
        take: SAMPLE_SIZE,
      }),
    ]);
    return { clearedWords, sample: rows.map((row) => row.word) };
  }

  /**
   * Back to "no word played yet". The state row is changed first: that takes
   * its lock, so a move being claimed at the same moment waits for the reset
   * and then fails its compare-and-swap instead of landing in the cleared round.
   */
  private async startRound(tx: Db, guildKey: string): Promise<UsedWordsPlan> {
    await tx.wordGameState.createMany({ data: [{ guildId: guildKey }], skipDuplicates: true });
    const state = await tx.wordGameState.findUniqueOrThrow({
      where: { guildId: guildKey },
      select: { id: true },
    });
    await tx.wordGameState.update({
      where: { id: state.id },
      data: { started: true, count: 0, lastUserId: '', lastWord: '' },
    });
    const plan = await this.planWipe(tx, state.id);
    const { count } = await tx.wordGameUsedWord.deleteMany({ where: { stateId: state.id } });
    return { clearedWords: count, sample: plan.sample };
  }
}
