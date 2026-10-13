import { createHash } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { errorLabel } from '../../prisma/pool-factory.js';
import {
  APPLY_ORDER,
  type ApplyResult,
  type Plan,
  type PlannedGuild,
  type TableCounts,
  type TableName,
} from './types.js';

export class TargetNotEmptyError extends Error {
  constructor(readonly nonEmpty: TableName[]) {
    super(
      `Target tables already hold rows (${nonEmpty.join(', ')}); ` +
        'rerun with --allow-non-empty to insert only the missing rows',
    );
    this.name = 'TargetNotEmptyError';
  }
}

/** Short stable stand-in for a guild id in reports and logs. */
function guildKey(discordId: string): string {
  return createHash('sha256').update(discordId).digest('hex').slice(0, 8);
}

const emptyCounts = (): TableCounts =>
  Object.fromEntries(APPLY_ORDER.map((table) => [table, 0])) as TableCounts;

/** Rows per statement: pg allows 65535 bind parameters and a word row binds two. */
const CHUNK = 5_000;

function chunks<T>(rows: readonly T[]): T[][] {
  const result: T[][] = [];
  for (let start = 0; start < rows.length; start += CHUNK)
    result.push(rows.slice(start, start + CHUNK));
  return result;
}

function plannedGuildCounts(guild: PlannedGuild): TableCounts {
  const counts = emptyCounts();
  counts.Guild = 1;
  counts.GuildConfig = 1;
  counts.BirthdayCompletedDate = guild.completedDates.length;
  counts.BirthdayWishUsage = guild.wishIndexes.length;
  counts.BirthdayEntry = guild.birthdays.length;
  if (guild.wordGame) {
    counts.WordGameState = 1;
    counts.WordGameUsedWord = guild.wordGame.words.length;
  }
  return counts;
}

export function plannedCounts(plan: Plan): TableCounts {
  const counts = emptyCounts();
  for (const guild of plan.guilds) {
    const guildCounts = plannedGuildCounts(guild);
    for (const table of APPLY_ORDER) counts[table] += guildCounts[table];
  }
  return counts;
}

export async function countTarget(prisma: PrismaClient): Promise<TableCounts> {
  const [guild, config, completed, wishes, entries, notes, wordStates, usedWords] =
    await Promise.all([
      prisma.guild.count(),
      prisma.guildConfig.count(),
      prisma.birthdayCompletedDate.count(),
      prisma.birthdayWishUsage.count(),
      prisma.birthdayEntry.count(),
      prisma.noteEntry.count(),
      prisma.wordGameState.count(),
      prisma.wordGameUsedWord.count(),
    ]);
  return {
    Guild: guild,
    GuildConfig: config,
    BirthdayCompletedDate: completed,
    BirthdayWishUsage: wishes,
    BirthdayEntry: entries,
    NoteEntry: notes,
    WordGameState: wordStates,
    WordGameUsedWord: usedWords,
  };
}

/**
 * Inserts one guild's rows in a single transaction. Claims go in before the
 * birthday entries so anything reading the guild after the commit sees both,
 * and so the uuidv7 ids of claims sort before those of the entries. Every
 * insert is ON CONFLICT DO NOTHING on the natural key, so rows the new bot
 * already wrote are never overwritten. No Discord call happens inside the
 * transaction.
 */
async function loadGuild(
  tx: Prisma.TransactionClient,
  guild: PlannedGuild,
  doneAt: Date,
  inserted: TableCounts,
): Promise<void> {
  inserted.Guild += (
    await tx.guild.createMany({ data: [{ discordId: guild.discordId }], skipDuplicates: true })
  ).count;
  const { id: guildId } = await tx.guild.findUniqueOrThrow({
    where: { discordId: guild.discordId },
    select: { id: true },
  });

  inserted.GuildConfig += (
    await tx.guildConfig.createMany({
      data: [{ guildId, ...guild.config }],
      skipDuplicates: true,
    })
  ).count;

  if (guild.completedDates.length > 0) {
    inserted.BirthdayCompletedDate += (
      await tx.birthdayCompletedDate.createMany({
        data: guild.completedDates.map((date) => ({
          guildId,
          date: new Date(`${date}T00:00:00.000Z`),
          status: 'DONE' as const,
          doneAt,
        })),
        skipDuplicates: true,
      })
    ).count;
  }

  if (guild.wishIndexes.length > 0) {
    inserted.BirthdayWishUsage += (
      await tx.birthdayWishUsage.createMany({
        data: guild.wishIndexes.map((wishIndex) => ({ guildId, wishIndex })),
        skipDuplicates: true,
      })
    ).count;
  }

  for (const rows of chunks(guild.birthdays)) {
    inserted.BirthdayEntry += (
      await tx.birthdayEntry.createMany({
        data: rows.map((entry) => ({ guildId, ...entry })),
        skipDuplicates: true,
      })
    ).count;
  }

  if (guild.wordGame) {
    const { words, ...state } = guild.wordGame;
    inserted.WordGameState += (
      await tx.wordGameState.createMany({ data: [{ guildId, ...state }], skipDuplicates: true })
    ).count;
    const { id: stateId } = await tx.wordGameState.findUniqueOrThrow({
      where: { guildId },
      select: { id: true },
    });
    for (const rows of chunks(words)) {
      inserted.WordGameUsedWord += (
        await tx.wordGameUsedWord.createMany({
          data: rows.map((word) => ({ stateId, word })),
          skipDuplicates: true,
        })
      ).count;
    }
  }
}

/**
 * Refuses a target that already holds rows unless the caller says otherwise,
 * then loads one transaction per guild. A failing guild rolls back alone and is
 * reported by hashed key and error label; the others still load.
 */
export async function applyPlan(
  prisma: PrismaClient,
  plan: Plan,
  options: { allowNonEmpty: boolean; now?: Date },
): Promise<ApplyResult> {
  const targetBefore = await countTarget(prisma);
  const nonEmpty = APPLY_ORDER.filter((table) => targetBefore[table] > 0);
  if (nonEmpty.length > 0 && !options.allowNonEmpty) throw new TargetNotEmptyError(nonEmpty);

  const inserted = emptyCounts();
  const existing = emptyCounts();
  const failures: ApplyResult['failures'] = [];
  const doneAt = options.now ?? new Date();
  for (const guild of plan.guilds) {
    const guildInserted = emptyCounts();
    try {
      await prisma.$transaction((tx) => loadGuild(tx, guild, doneAt, guildInserted), {
        timeout: 60_000,
      });
      const guildPlanned = plannedGuildCounts(guild);
      for (const table of APPLY_ORDER) {
        inserted[table] += guildInserted[table];
        existing[table] += guildPlanned[table] - guildInserted[table];
      }
    } catch (error) {
      failures.push({ guildKey: guildKey(guild.discordId), error: errorLabel(error) });
    }
  }

  return {
    planned: plannedCounts(plan),
    inserted,
    existing,
    targetBefore,
    failures,
    allowedNonEmpty: nonEmpty.length > 0,
  };
}
