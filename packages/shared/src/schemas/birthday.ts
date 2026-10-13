import { z } from 'zod';
import { BirthdayEntrySchema } from '../generated/zod/schemas/models/BirthdayEntry.schema.js';
import { isValidMonthDay } from '../utils/month-day.js';
import { SnowflakeSchema } from './snowflake.js';

/** The columns a birthday CSV must have; their order in the file is free. */
export const BIRTHDAY_CSV_HEADER = ['Name', 'ID', 'DiscordID', 'Day', 'Month'] as const;

/** What a person sees when their file is rejected: the header and one example row. */
export const BIRTHDAY_CSV_TEMPLATE = `${BIRTHDAY_CSV_HEADER.join(',')}\nNguyen Van A,SE123456,123456789012345678,15,3\n`;

/** Most rows one REST or MCP import carries; a CSV file is bounded by its size instead. */
export const BIRTHDAY_IMPORT_MAX_ROWS = 500;

/** How many people a preview or a result names; the count says the rest. */
export const BIRTHDAY_SAMPLE_SIZE = 10;

const StudentIdSchema = z.string().trim().min(1).max(64);

/**
 * One person to greet. `month`/`day` must be a real calendar day, with
 * 29 February allowed (the same rule as the database CHECK).
 */
export const BirthdayAddSchema = BirthdayEntrySchema.pick({
  studentId: true,
  name: true,
  discordId: true,
  month: true,
  day: true,
})
  .extend({
    studentId: StudentIdSchema,
    name: z.string().trim().min(1).max(200),
    discordId: SnowflakeSchema,
    month: z.number().int().min(1).max(12),
    day: z.number().int().min(1).max(31),
  })
  .refine((entry) => isValidMonthDay(entry.month, entry.day), {
    message: 'month and day are not a calendar day',
    path: ['day'],
  });

export type BirthdayAdd = z.infer<typeof BirthdayAddSchema>;

/** What a list shows of a person. The internal key and the server never leave the database. */
export const BirthdayEntryViewSchema = BirthdayEntrySchema.pick({
  studentId: true,
  name: true,
  discordId: true,
  month: true,
  day: true,
});

export type BirthdayEntryView = z.infer<typeof BirthdayEntryViewSchema>;

export const BirthdayImportSchema = z.object({
  rows: z.array(BirthdayAddSchema).min(1).max(BIRTHDAY_IMPORT_MAX_ROWS),
});

export type BirthdayImport = z.infer<typeof BirthdayImportSchema>;

/**
 * Who to remove. A student ID wins when both are given; with neither the call
 * answers `NO_SELECTOR` instead of failing, as the command always did.
 */
export const BirthdaySelectorSchema = z.object({
  studentId: StudentIdSchema.optional(),
  discordId: SnowflakeSchema.optional(),
});

export type BirthdaySelector = z.infer<typeof BirthdaySelectorSchema>;

export const BirthdayAddResultSchema = z.object({
  code: z.enum(['ADDED', 'DUPLICATE_ID']),
});

export type BirthdayAddResult = z.infer<typeof BirthdayAddResultSchema>;

/**
 * What a removal did, or with `dryRun` what it would do: `code` is the outcome
 * of a real run and `sample` the first people it names.
 */
export const BirthdayRemoveResultSchema = z.object({
  dryRun: z.boolean(),
  code: z.enum(['REMOVED_BY_STUDENT', 'REMOVED_BY_USER', 'NOT_FOUND', 'NO_SELECTOR']),
  count: z.number().int().min(0),
  sample: z.array(BirthdayEntryViewSchema).max(BIRTHDAY_SAMPLE_SIZE),
});

export type BirthdayRemoveResult = z.infer<typeof BirthdayRemoveResultSchema>;

/**
 * An import only merges: a student ID the server already has is left alone and
 * listed in `duplicates`. With `dryRun`, `added` is what a real run would add.
 */
export const BirthdayImportResultSchema = z.object({
  dryRun: z.boolean(),
  total: z.number().int().min(0),
  added: z.number().int().min(0),
  duplicates: z.array(z.string()),
  sample: z.array(z.string()).max(BIRTHDAY_SAMPLE_SIZE),
});

export type BirthdayImportResult = z.infer<typeof BirthdayImportResultSchema>;

/** Why a CSV row was not taken, so each client can say it in its own words. */
export const BirthdayImportProblemSchema = z.object({
  row: z.number().int().min(1),
  kind: z.enum([
    'MISSING_FIELDS',
    'INVALID_DATE',
    'INVALID_DISCORD_ID',
    'INVALID_VALUE',
    'DUPLICATE_ID',
  ]),
  studentId: z.string().optional(),
});

export type BirthdayImportProblem = z.infer<typeof BirthdayImportProblemSchema>;
