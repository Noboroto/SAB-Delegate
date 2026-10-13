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

type ParsedRecord = { record: string[]; info: { bytes: number } };

const LF = 0x0a;
const CR = 0x0d;

/**
 * The line each record starts on, counted from the bytes csv-parse reports as
 * consumed (`info.bytes`: just past the record and its line break) rather than
 * from its own line counter, which drifts after a quoted field that holds a
 * CRLF. Blank lines between records are skipped by the parser but count here,
 * and a quoted field that spans lines moves the next record down by as many
 * lines as it spans: the number is the one a spreadsheet shows.
 */
function startLines(text: string, records: readonly ParsedRecord[]): number[] {
  const bytes = Buffer.from(text);
  const lines: number[] = [];
  let scanned = 0;
  let line = 1;
  let consumed = 0;
  for (const { info } of records) {
    let start = consumed;
    while (bytes[start] === LF || bytes[start] === CR) start += 1;
    while (scanned < start) {
      const byte = bytes[scanned];
      scanned += 1;
      if (byte === CR && bytes[scanned] === LF) scanned += 1;
      if (byte === CR || byte === LF) line += 1;
    }
    lines.push(line);
    consumed = info.bytes;
  }
  return lines;
}

/** Whole numbers only: `Number` would also take "1e1", "0x1", "1.0" and "+1". */
function wholeNumber(text: string): number {
  return /^\d{1,4}$/.test(text) ? Number(text) : Number.NaN;
}

/**
 * Reads a birthday CSV. The header must name all five columns exactly; their
 * order is free and extra columns are ignored. Rows that cannot be taken are
 * reported with the line they start on in the file (the header is line 1, blank
 * lines count) instead of stopping the file.
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
  let records: ParsedRecord[];
  try {
    records = parse(text, {
      bom: true,
      skip_empty_lines: true,
      relax_column_count: true,
      // A stray quote inside an unquoted name (`Nguyen "Bo" Van`) is text, not a
      // reason to refuse the whole file.
      relax_quotes: true,
      trim: true,
      info: true,
      // csv-parse types `info: true` results as plain rows; the shape is documented.
    }) as unknown as ParsedRecord[];
  } catch (error) {
    if (error instanceof CsvError) return { ok: false, reason: 'UNREADABLE' };
    throw error;
  }

  const [headerRecord, ...dataRecords] = records;
  const header = headerRecord?.record ?? [];
  const column = new Map(BIRTHDAY_CSV_HEADER.map((name) => [name, header.indexOf(name)]));
  if ([...column.values()].some((index) => index < 0)) return { ok: false, reason: 'BAD_HEADER' };

  const rows: Array<{ row: number; entry: BirthdayAdd }> = [];
  const problems: BirthdayImportProblem[] = [];
  const seen = new Set<string>();

  const lines = startLines(text, records);
  dataRecords.forEach(({ record }, index) => {
    // `lines[0]` is the header's.
    const row = lines[index + 1] ?? 0;
    const cell = (name: (typeof BIRTHDAY_CSV_HEADER)[number]): string =>
      record[column.get(name) ?? -1]?.trim() ?? '';

    const name = cell('Name');
    const studentId = cell('ID');
    const discordId = cell('DiscordID')
      .replaceAll(/[<>@!]/g, '')
      .trim();
    const day = wholeNumber(cell('Day'));
    const month = wholeNumber(cell('Month'));

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
