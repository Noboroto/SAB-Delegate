import type { Prisma } from '@prisma/client';
import { BIRTHDAY_WISHES } from '@sab/shared';

type WishDb = Pick<Prisma.TransactionClient, '$queryRaw' | 'birthdayWishUsage'>;

/** Conflicts only happen when two pickers race for one server; a few rounds settle it. */
const MAX_ROUNDS = 5;

/**
 * Picks a wish this server has not used in the current cycle, every unused one
 * equally likely, and records it as used in the same statement, so two callers
 * can never take the same wish. When all of them are used the cycle restarts:
 * the usage rows are cleared and the pick is made again. A wish appended to the
 * list later joins every server's pool at once, since "unused" is computed
 * against the list rather than stored.
 *
 * Run it inside a transaction so the reset and the pick that follows it are
 * one step.
 */
export async function pickUnusedWish(
  db: WishDb,
  guildId: string,
  total: number = BIRTHDAY_WISHES.length,
): Promise<number> {
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const picked = await db.$queryRaw<Array<{ wishIndex: number }>>`
      INSERT INTO "BirthdayWishUsage" ("guildId", "wishIndex")
      SELECT ${guildId}::uuid, pick.wish
      FROM (
        SELECT series.wish
        FROM generate_series(0, ${total - 1}::int) AS series(wish)
        WHERE NOT EXISTS (
          SELECT 1 FROM "BirthdayWishUsage" used
          WHERE used."guildId" = ${guildId}::uuid AND used."wishIndex" = series.wish
        )
        ORDER BY random()
        LIMIT 1
      ) AS pick
      ON CONFLICT ("guildId", "wishIndex") DO NOTHING
      RETURNING "wishIndex"
    `;
    const wishIndex = picked[0]?.wishIndex;
    if (wishIndex !== undefined) return wishIndex;

    // Nothing inserted: the pool is empty, or another picker took the wish first.
    const used = await db.birthdayWishUsage.count({
      where: { guildId, wishIndex: { lt: total } },
    });
    if (used >= total) await db.birthdayWishUsage.deleteMany({ where: { guildId } });
  }
  throw new Error('No birthday wish could be picked');
}
