import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { LeaderboardService } from '../game-core/leaderboard.service.js';
import { GameWordsService } from './game-words.service.js';
import {
  parseMove,
  type GameTx,
  type ScrambleOpening,
  type ScrambleOutcome,
} from './mini-game.types.js';
import { anagramKey, compactWord, scrambleLetters } from './vietnamese.js';

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
    private readonly words: GameWordsService,
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
    if (anagramKey(guess) !== anagramKey(state.answer)) return { status: 'WRONG' };
    if (!(await this.words.isVietnameseWord(guess))) return { status: 'WRONG' };

    const next = await this.nextPuzzle(state.answer);
    const won = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.scrambleState.updateMany({
        where: { guildId: row.id, round: state.round },
        data: { answer: next.answer, puzzle: next.letters, round: { increment: 1 } },
      });
      if (claimed.count === 0) return false;
      await this.leaderboard.award(tx, row.id, 'SCRAMBLE', move.authorId);
      return true;
    });
    // Lost: the puzzle changed since the read, solved by someone else or
    // skipped. The guess was right for the puzzle it answered, only late, so
    // it is neither judged against the new puzzle nor marked wrong.
    return won ? { status: 'SOLVED', guess, next } : { status: 'NOTHING' };
  }

  /** A new puzzle in place of the current one, whose answer it returns. */
  async restart(tx: GameTx, guildKey: string): Promise<ScrambleOpening> {
    const current = await tx.scrambleState.findUnique({
      where: { guildId: guildKey },
      select: { answer: true },
    });
    const next = await this.nextPuzzle(current?.answer ?? null);
    await tx.scrambleState.createMany({
      data: [{ guildId: guildKey, answer: next.answer, puzzle: next.letters }],
      skipDuplicates: true,
    });
    // Also right after the insert: a concurrent restart may have made the row.
    await tx.scrambleState.update({
      where: { guildId: guildKey },
      data: { answer: next.answer, puzzle: next.letters, round: { increment: 1 } },
    });
    return next;
  }

  private async nextPuzzle(previous: string | null): Promise<ScrambleOpening> {
    let answer = await this.words.pickVietnamese();
    // The same word twice in a row would look like a stuck game.
    if (answer === previous) answer = await this.words.pickVietnamese();
    return { game: 'SCRAMBLE', answer, letters: scrambleLetters(answer), previous };
  }
}
