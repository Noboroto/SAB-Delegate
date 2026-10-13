import {
  BIRTHDAY_CSV_HEADER,
  BirthdayAddSchema,
  SnowflakeSchema,
  isValidMonthDay,
  type BirthdayAdd,
  type BirthdayImportProblem,
} from '@sab/shared';
import { CsvError, parse } from 'csv-parse/sync';

/** Larger files are refused before they are downloaded. */
export const BIRTHDAY_CSV_MAX_BYTES = 1024 * 1024;

/**
 * Reads a birthday CSV. The header must name all five columns exactly; their
 * order is free and extra columns are ignored. Rows that cannot be taken are
 * reported with their line (the header is line 1) instead of stopping the file.
 *
 * Mentions in the DiscordID cell (`<@123>`) are cleaned to the bare id, as the
 * previous bot did. Impossible dates (31 February) and ids that are not
 * snowflakes are refused here: they would never produce a greeting, or the
 * database would reject the row.
 */
export function parseBirthdayCsv(text: string):
  | {
      ok: true;
      /** Data rows in the file, valid or not; the "Y" of "Added X of Y". */
      total: number;
      rows: Array<{ row: number; entry: BirthdayAdd }>;
      problems: BirthdayImportProblem[];
    }
  | { ok: false; reason: 'UNREADABLE' | 'BAD_HEADER' } {
  let records: string[][];
  try {
    records = parse(text, {
      bom: true,
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true,
    });
  } catch (error) {
    if (error instanceof CsvError) return { ok: false, reason: 'UNREADABLE' };
    throw error;
  }

  const [header = [], ...dataRecords] = records;
  const column = new Map(BIRTHDAY_CSV_HEADER.map((name) => [name, header.indexOf(name)]));
  if ([...column.values()].some((index) => index < 0)) return { ok: false, reason: 'BAD_HEADER' };

  const rows: Array<{ row: number; entry: BirthdayAdd }> = [];
  const problems: BirthdayImportProblem[] = [];
  const seen = new Set<string>();

  dataRecords.forEach((record, index) => {
    // +2: the header is line 1, and people count from 1.
    const row = index + 2;
    const cell = (name: (typeof BIRTHDAY_CSV_HEADER)[number]): string =>
      record[column.get(name) ?? -1]?.trim() ?? '';

    const name = cell('Name');
    const studentId = cell('ID');
    const discordId = cell('DiscordID')
      .replaceAll(/[<>@!]/g, '')
      .trim();
    const day = Number(cell('Day'));
    const month = Number(cell('Month'));

    if (!name || !studentId || !discordId) {
      problems.push({ row, kind: 'MISSING_FIELDS' });
    } else if (!isValidMonthDay(month, day)) {
      problems.push({ row, kind: 'INVALID_DATE' });
    } else if (!SnowflakeSchema.safeParse(discordId).success) {
      problems.push({ row, kind: 'INVALID_DISCORD_ID' });
    } else {
      const entry = BirthdayAddSchema.safeParse({ studentId, name, discordId, month, day });
      if (!entry.success) {
        problems.push({ row, kind: 'INVALID_VALUE' });
      } else if (seen.has(entry.data.studentId)) {
        problems.push({ row, kind: 'DUPLICATE_ID', studentId: entry.data.studentId });
      } else {
        seen.add(entry.data.studentId);
        rows.push({ row, entry: entry.data });
      }
    }
  });

  return { ok: true, total: dataRecords.length, rows, problems };
}
