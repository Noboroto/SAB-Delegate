import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { LeaderboardService } from '../game-core/leaderboard.service.js';
import { VietWordsService } from './viet-words.service.js';
import {
  parseMove,
  SCRAMBLE_HINT_AFTER,
  type GameTx,
  type ScrambleOpening,
  type ScrambleOutcome,
} from './mini-game.types.js';
import { anagramKey, compactWord, scrambleHint, scrambleLetters } from './vietnamese.js';

/** Letters of a word as the puzzle shows them: tone marks ride on their letter. */
function letterCount(text: string): number {
  return Array.from(compactWord(text)).length;
}

/** Longer than any two- or three-syllable word; longer text is chat. */
const GUESS_MAX_LENGTH = 40;

/**
 * Vua Tiếng Việt: the bot shows the shuffled letters of a Vietnamese word and
 * the first player to write a word of exactly those letters wins the puzzle and
 * a point. Any listed word fits, not only the one drawn, as a set of letters
 * can spell several. A wrong guess of the right length gets a cross; other
 * messages are chat.
 *
 * `round` grows with every puzzle; a win is applied only to the round it was
 * judged against, so two right answers at once give one point and the later
 * one gets no answer.
 */
@Injectable()
export class ScrambleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leaderboard: LeaderboardService,
    private readonly words: VietWordsService,
  ) {}

  async submit(guildId: string, input: unknown): Promise<ScrambleOutcome> {
    const { id, move } = parseMove(guildId, input);
    const guess = move.content.trim().replace(/\s+/gu, ' ').toLowerCase();
    if (guess === '' || guess.length > GUESS_MAX_LENGTH) return { status: 'NOTHING' };

    const row = await this.prisma.guild.findUnique({
      where: { discordId: id },
      select: {
        id: true,
        gameChannels: { where: { game: 'SCRAMBLE' }, select: { channelId: true } },
        scramble: { select: { answer: true, round: true } },
      },
    });
    if (
      row === null ||
      row.scramble === null ||
      row.gameChannels[0]?.channelId !== move.channelId
    ) {
      return { status: 'NOTHING' };
    }
    const state = row.scramble;
    // Only a message as long as the answer reads as a guess and gets a cross;
    // any other length is chat and gets no answer.
    if (letterCount(guess) !== letterCount(state.answer)) return { status: 'NOTHING' };
    const found =
      anagramKey(guess) === anagramKey(state.answer) ? await this.words.find(guess) : null;
    if (found === null) return this.wrong(row.id, state);

    const next = await this.nextPuzzle(state.answer);
    const won = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.scrambleState.updateMany({
        where: { guildId: row.id, round: state.round },
        data: {
          answer: next.answer,
          puzzle: next.letters,
          round: { increment: 1 },
          wrongGuesses: 0,
        },
      });
      if (claimed.count === 0) return false;
      await this.leaderboard.award(tx, row.id, 'SCRAMBLE', move.authorId);
      return true;
    });
    // Lost: the puzzle changed since the read, solved by someone else or
    // skipped. The guess was right for the puzzle it answered, only late, so
    // it is neither judged against the new puzzle nor marked wrong.
    return won
      ? { status: 'SOLVED', guess: found.word, meaning: found.meaning, next }
      : { status: 'NOTHING' };
  }

  /**
   * Counts a wrong guess against the puzzle it answered; the one that reaches
   * `SCRAMBLE_HINT_AFTER` brings the hint. The count only grows, so exactly one
   * guess per puzzle sees that number, even with guesses arriving at once.
   */
  private async wrong(
    guildKey: string,
    state: { answer: string; round: number },
  ): Promise<ScrambleOutcome> {
    const rows = await this.prisma.$queryRaw<{ wrongGuesses: number }[]>`
      UPDATE "ScrambleState" SET "wrongGuesses" = "wrongGuesses" + 1
      WHERE "guildId" = ${guildKey}::uuid AND "round" = ${state.round}
      RETURNING "wrongGuesses"`;
    if (rows[0]?.wrongGuesses !== SCRAMBLE_HINT_AFTER) return { status: 'WRONG' };
    const answer = await this.words.find(state.answer);
    return { status: 'WRONG', hint: scrambleHint(state.answer, answer?.meaning ?? null) };
  }

  /**
   * The puzzle that would replace the current one, drawn before the round's
   * transaction opens: drawing and looking meanings up queries the database, and
   * doing it inside the transaction would hold two connections at once.
   */
  async prepare(guildId: string): Promise<ScrambleOpening> {
    const current = await this.prisma.scrambleState.findFirst({
      where: { guild: { discordId: guildId } },
      select: { answer: true },
    });
    return this.nextPuzzle(current?.answer ?? null);
  }

  /** Puts `next` (from `prepare`) in place of the current puzzle. */
  async restart(tx: GameTx, guildKey: string, next: ScrambleOpening): Promise<ScrambleOpening> {
    await tx.scrambleState.createMany({
      data: [{ guildId: guildKey, answer: next.answer, puzzle: next.letters }],
      skipDuplicates: true,
    });
    // Also right after the insert: a concurrent restart may have made the row.
    await tx.scrambleState.update({
      where: { guildId: guildKey },
      data: {
        answer: next.answer,
        puzzle: next.letters,
        round: { increment: 1 },
        wrongGuesses: 0,
      },
    });
    return next;
  }

  private async nextPuzzle(previous: string | null): Promise<ScrambleOpening> {
    let answer = await this.words.pickVietnamese();
    // The same word twice in a row would look like a stuck game.
    if (answer === previous) answer = await this.words.pickVietnamese();
    const previousMeaning =
      previous === null ? null : ((await this.words.find(previous))?.meaning ?? null);
    return {
      game: 'SCRAMBLE',
      answer,
      letters: scrambleLetters(answer),
      previous,
      previousMeaning,
    };
  }
}
