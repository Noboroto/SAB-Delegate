import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { PrismaClient } from '@prisma/client';
import { detectColumns } from './read-source.js';
import { ExportClaimsResultSchema, LEGACY_FILES, type ExportClaimsResult } from './types.js';
import { businessDate, shiftDate } from './transform.js';

/** The legacy key: year-month-day with no zero padding. */
function legacyKey(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  return `${year}-${month}-${day}`;
}

/**
 * Rollback aid: copies the birthday runs of the last `days` business days
 * (today included) into the old bot's `completedDates`, so the old bot does
 * not greet again on the day it is switched back on. DONE runs and runs still
 * SENDING both count: a SENDING day was already partly greeted by the new bot.
 * Day keys are the ICT business date, which is the legacy host's own date.
 * Only guilds the legacy file already knows are touched; a guild row is never
 * created there.
 */
export async function exportClaims(
  prisma: PrismaClient,
  options: { targetDir: string; days: number; now?: Date },
): Promise<ExportClaimsResult> {
  const today = businessDate(options.now);
  const from = new Date(`${shiftDate(today, -(options.days - 1))}T00:00:00.000Z`);
  const claims = await prisma.birthdayCompletedDate.findMany({
    where: { status: { in: ['DONE', 'SENDING'] }, date: { gte: from } },
    select: { date: true, status: true, guild: { select: { discordId: true } } },
    orderBy: { date: 'asc' },
  });

  const byGuild = new Map<string, { key: string; sending: boolean }[]>();
  for (const claim of claims) {
    const keys = byGuild.get(claim.guild.discordId) ?? [];
    keys.push({
      key: legacyKey(claim.date.toISOString().slice(0, 10)),
      sending: claim.status === 'SENDING',
    });
    byGuild.set(claim.guild.discordId, keys);
  }

  const db = new DatabaseSync(join(options.targetDir, LEGACY_FILES.birthday));
  const result: ExportClaimsResult = { claims: 0, exportedSending: 0, guildsNotInLegacy: 0 };
  try {
    const columns = detectColumns(db);
    if (!columns) throw new Error('birthday.sqlite has no quick.db "json" table');
    const select = db.prepare(
      `SELECT "${columns.value}" AS value FROM "json" WHERE "${columns.id}" = ?`,
    );
    const update = db.prepare(`UPDATE "json" SET "${columns.value}" = ? WHERE "${columns.id}" = ?`);

    db.exec('BEGIN IMMEDIATE');
    try {
      for (const [discordId, keys] of byGuild) {
        const row = select.get(discordId) as { value: string } | undefined;
        if (!row) {
          result.guildsNotInLegacy++;
          continue;
        }
        const value = JSON.parse(row.value) as Record<string, unknown>;
        const existing = value['completedDates'];
        const completed: Record<string, unknown> =
          existing !== null && typeof existing === 'object' && !Array.isArray(existing)
            ? (existing as Record<string, unknown>)
            : {};
        for (const { key } of keys) completed[key] = true;
        value['completedDates'] = completed;
        update.run(JSON.stringify(value), discordId);
        for (const { sending } of keys) {
          if (sending) result.exportedSending++;
          else result.claims++;
        }
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  } finally {
    db.close();
  }
  return ExportClaimsResultSchema.parse(result);
}
