import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  ErrorCode,
  LEADERBOARD_SIZE,
  SnowflakeSchema,
  type Leaderboard,
  type MiniGame,
} from '@sab/shared';
import { ServiceError } from '../../common/errors/service-error.js';
import { PrismaService } from '../../prisma/prisma.service.js';

type ScoreDb = Pick<Prisma.TransactionClient, 'gameScore'>;

/**
 * All-time points per player, per game, per server. Points are only ever
 * awarded inside the transaction that commits the winning move, so a move the
 * database refuses (a lost race, a replayed message) never scores.
 */
@Injectable()
export class LeaderboardService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * One point to `userId`. `guildKey` is the internal server key. The row is
   * made with `INSERT .. ON CONFLICT DO NOTHING` first, so two first wins of
   * the same player in two games' transactions never fail on the unique key.
   */
  async award(tx: ScoreDb, guildKey: string, game: MiniGame, userId: string): Promise<void> {
    await tx.gameScore.createMany({
      data: [{ guildId: guildKey, game, userId }],
      skipDuplicates: true,
    });
    await tx.gameScore.update({
      where: { guildId_game_userId: { guildId: guildKey, game, userId } },
      data: { points: { increment: 1 } },
    });
  }

  /**
   * The best `LEADERBOARD_SIZE` players and the asking one. Players with equal
   * points share a rank; among them the one who reached it first is listed
   * first.
   */
  async board(guildId: string, game: MiniGame, userId: string): Promise<Leaderboard> {
    const discordId = SnowflakeSchema.safeParse(guildId);
    if (!discordId.success) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
    const where = { guild: { discordId: discordId.data }, game, points: { gt: 0 } };

    const rows = await this.prisma.gameScore.findMany({
      where,
      // `id` (uuidv7, time-ordered) settles rows written in the same millisecond.
      orderBy: [{ points: 'desc' }, { updatedAt: 'asc' }, { id: 'asc' }],
      take: LEADERBOARD_SIZE,
      select: { userId: true, points: true },
    });
    // Sorted by points, so every higher score sits before a row: its rank is
    // one past the number of rows with more points, which is where the first
    // row with its points stands.
    const top = rows.map((row) => ({
      ...row,
      rank: rows.findIndex((other) => other.points === row.points) + 1,
    }));

    const listed = top.find((row) => row.userId === userId);
    if (listed !== undefined) return { top, you: listed };

    const mine = await this.prisma.gameScore.findFirst({
      where: { ...where, userId },
      select: { userId: true, points: true },
    });
    if (mine === null) return { top, you: null };
    const higher = await this.prisma.gameScore.count({
      where: { ...where, points: { gt: mine.points } },
    });
    return { top, you: { ...mine, rank: higher + 1 } };
  }
}
