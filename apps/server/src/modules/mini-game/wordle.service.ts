import { Injectable } from '@nestjs/common';
import { WORDLE_MAX_GUESSES, WORDLE_WORD_LENGTH } from '@sab/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import { LeaderboardService } from '../game-core/leaderboard.service.js';
import { GameWordsService } from './game-words.service.js';
import {
  MAX_ATTEMPTS,
  parseMove,
  type GameTx,
  type Opening,
  type WordleOutcome,
} from './mini-game.types.js';

const GUESS = new RegExp(`^[a-z]{${WORDLE_WORD_LENGTH}}$`, 'u');

/**
 * Wordle played by the whole channel: one board, `WORDLE_MAX_GUESSES` guesses
 * between everyone, nobody guessing twice in a row. A message of exactly one
 * word of the right length is a guess; anything else is chat. The player who
 * finds the word gets a point; a solved or lost board is replaced at once.
 *
 * A guess is applied only to the board it was judged against (same round, same
 * guesses), so two guesses at once cannot both take the same turn.
 */
@Injectable()
export class WordleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leaderboard: LeaderboardService,
    private readonly words: GameWordsService,
  ) {}

  async submit(guildId: string, input: unknown): Promise<WordleOutcome> {
    const { id, move } = parseMove(guildId, input);
    const word = move.content.trim().toLowerCase();
    if (!GUESS.test(word)) return { status: 'NOTHING' };

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const row = await this.prisma.guild.findUnique({
        where: { discordId: id },
        select: {
          id: true,
          gameChannels: { where: { game: 'WORDLE' }, select: { channelId: true } },
          wordle: { select: { answer: true, guesses: true, lastUserId: true, round: true } },
        },
      });
      if (
        row === null ||
        row.wordle === null ||
        row.gameChannels[0]?.channelId !== move.channelId
      ) {
        return { status: 'NOTHING' };
      }
      const state = row.wordle;
      const last = state.guesses.at(-1);
      if (last !== undefined && state.lastUserId === move.authorId) {
        // This very guess already took the turn: another process on the same
        // token judged the message first, or the player sent it twice.
        return { status: last === word ? 'NOTHING' : 'SAME_USER' };
      }
      if (state.guesses.includes(word)) return { status: 'ALREADY_GUESSED' };
      if (!(await this.words.isWordleGuess(word))) return { status: 'NOT_IN_LIST' };

      const guesses = [...state.guesses, word];
      const status =
        word === state.answer
          ? 'SOLVED'
          : guesses.length >= WORDLE_MAX_GUESSES
            ? 'LOST'
            : 'GUESSED';
      const nextAnswer = status === 'GUESSED' ? null : await this.nextAnswer(state.answer);

      const applied = await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.wordleState.updateMany({
          where: {
            guildId: row.id,
            round: state.round,
            lastUserId: state.lastUserId,
            guesses: { equals: state.guesses },
          },
          data:
            nextAnswer === null
              ? { guesses, lastUserId: move.authorId }
              : { answer: nextAnswer, guesses: [], lastUserId: '', round: { increment: 1 } },
        });
        if (claimed.count === 0) return false;
        if (status === 'SOLVED') await this.leaderboard.award(tx, row.id, 'WORDLE', move.authorId);
        return true;
      });
      if (applied) return { status, guesses, answer: state.answer };
    }
    throw new Error('A guess kept losing the race for the board');
  }

  /** A new board in place of the current one, whose answer it returns. */
  async restart(tx: GameTx, guildKey: string): Promise<Opening> {
    const current = await tx.wordleState.findUnique({
      where: { guildId: guildKey },
      select: { answer: true },
    });
    const answer = await this.nextAnswer(current?.answer ?? null);
    await tx.wordleState.createMany({
      data: [{ guildId: guildKey, answer, guesses: [] }],
      skipDuplicates: true,
    });
    // Also right after the insert: a concurrent restart may have made the row.
    await tx.wordleState.update({
      where: { guildId: guildKey },
      data: { answer, guesses: [], lastUserId: '', round: { increment: 1 } },
    });
    return { game: 'WORDLE', previous: current?.answer ?? null };
  }

  private async nextAnswer(previous: string | null): Promise<string> {
    const answer = await this.words.pickWordleAnswer();
    // The same word twice in a row would look like a stuck game.
    return answer === previous ? this.words.pickWordleAnswer() : answer;
  }
}
