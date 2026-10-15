import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { LeaderboardService } from '../game-core/leaderboard.service.js';
import {
  MAX_ATTEMPTS,
  parseMove,
  type CountingOutcome,
  type GameTx,
  type Opening,
} from './mini-game.types.js';

/** Only a whole number written plainly counts ("007" does not); anything else is chat. */
const NUMBER = /^(?:0|[1-9]\d{0,8})$/u;

const FRESH = { count: 0, lastUserId: '', best: 0 };

/**
 * The counting game: the channel counts 1, 2, 3… one number per message, never
 * the same player twice in a row. A wrong number or a second number in a row
 * starts the count over; the record survives. Each number counted is a point.
 *
 * A move is applied only if the count is still exactly as it was read (the
 * `updateMany` changes nothing otherwise), so two players sending the same
 * number at once cannot both be counted.
 */
@Injectable()
export class CountingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leaderboard: LeaderboardService,
  ) {}

  async submit(guildId: string, input: unknown): Promise<CountingOutcome> {
    const { id, move } = parseMove(guildId, input);
    const text = move.content.trim();
    if (!NUMBER.test(text)) return { status: 'NOTHING' };
    const number = Number(text);

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const row = await this.prisma.guild.findUnique({
        where: { discordId: id },
        select: {
          id: true,
          gameChannels: { where: { game: 'COUNTING' }, select: { channelId: true } },
          counting: { select: { count: true, lastUserId: true, best: true } },
        },
      });
      if (row === null || row.gameChannels[0]?.channelId !== move.channelId) {
        return { status: 'NOTHING' };
      }
      const state = row.counting ?? FRESH;
      // The count already stands at this number by this player: another
      // process on the same token (two containers overlapping in a deploy)
      // counted this very message first, or the player sent it twice. Judging
      // it would reset the count under the number just accepted.
      if (state.count === number && state.lastUserId === move.authorId) {
        return { status: 'NOTHING' };
      }

      let outcome: CountingOutcome;
      let next: { count: number; lastUserId: string; best?: number };
      if (state.count > 0 && state.lastUserId === move.authorId) {
        outcome = { status: 'SAME_USER', best: state.best };
        next = { count: 0, lastUserId: '' };
      } else if (number !== state.count + 1) {
        outcome = { status: 'WRONG_NUMBER', expected: state.count + 1, best: state.best };
        next = { count: 0, lastUserId: '' };
      } else {
        outcome = { status: 'COUNTED', count: number };
        next = { count: number, lastUserId: move.authorId, best: Math.max(state.best, number) };
      }

      const applied = await this.prisma.$transaction(async (tx) => {
        await tx.countingState.createMany({ data: [{ guildId: row.id }], skipDuplicates: true });
        const claimed = await tx.countingState.updateMany({
          where: { guildId: row.id, count: state.count, lastUserId: state.lastUserId },
          data: next,
        });
        if (claimed.count === 0) return false;
        if (outcome.status === 'COUNTED') {
          await this.leaderboard.award(tx, row.id, 'COUNTING', move.authorId);
        }
        return true;
      });
      if (applied) return outcome;
    }
    throw new Error('A number kept losing the race for the count');
  }

  /** Starts the count over at 1; the record stays. */
  async restart(tx: GameTx, guildKey: string): Promise<Opening> {
    await tx.countingState.createMany({ data: [{ guildId: guildKey }], skipDuplicates: true });
    await tx.countingState.update({
      where: { guildId: guildKey },
      data: { count: 0, lastUserId: '' },
    });
    return { game: 'COUNTING' };
  }
}
