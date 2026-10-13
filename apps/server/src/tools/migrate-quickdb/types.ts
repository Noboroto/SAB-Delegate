import { z } from '@sab/shared';

export const LEGACY_FILES = {
  birthday: 'birthday.sqlite',
  config: 'config.sqlite',
  note: 'note.sqlite',
  word: 'word.sqlite',
  dict: 'dict.sqlite',
} as const;

export type LegacyFileKey = keyof typeof LEGACY_FILES;

const LegacyFileKeySchema = z.enum(
  Object.keys(LEGACY_FILES) as [LegacyFileKey, ...LegacyFileKey[]],
);

/** A quick.db row: `id` is the first path segment, `value` the parsed JSON. */
const LegacyRowSchema = z.object({ id: z.string(), value: z.unknown() });
export type LegacyRow = z.infer<typeof LegacyRowSchema>;

export const LegacyDataSchema = z.object({
  /** Rows per source file; a file that is absent reads as no rows. */
  rows: z.object({
    birthday: z.array(LegacyRowSchema),
    config: z.array(LegacyRowSchema),
    note: z.array(LegacyRowSchema),
    word: z.array(LegacyRowSchema),
  }),
  /** Key count of the dictionary object, null when the file or row is absent. */
  dictKeyCount: z.number().int().nullable(),
  /** Source files that do not exist in the directory. */
  missingFiles: z.array(LegacyFileKeySchema),
  /** Rows whose JSON could not be parsed; they are never loaded. */
  unparsableRows: z.number().int(),
});
export type LegacyData = z.infer<typeof LegacyDataSchema>;

/** Codes only: a skip is reported by reason and count, never by value. */
const SKIP_CODES = [
  'GUILD_KEY_INVALID',
  'ROW_NOT_OBJECT',
  'CHANNEL_ID_INVALID',
  'BIRTHDAY_ENTRY_INVALID',
  'BIRTHDAY_DATE_INVALID',
  'BIRTHDAY_DAY_NOT_LIST',
  'BIRTHDAY_DUPLICATE_STUDENT',
  'WISH_INDEX_INVALID',
  'WISH_INDEX_OUT_OF_RANGE',
  'COMPLETED_DATE_INVALID',
  'COMPLETED_DATE_EXPIRED',
  'COMPLETED_DATE_IN_FUTURE',
  'LEGACY_IS_COMPLETED_DROPPED',
  'NOTE_UNATTRIBUTABLE',
  'WORD_EMPTY',
  'WORD_MAX_WORDS_DEFAULTED',
] as const;

export type SkipCode = (typeof SKIP_CODES)[number];

const SkippedSchema = z.partialRecord(z.enum(SKIP_CODES), z.number().int());

const PlannedBirthdaySchema = z.object({
  studentId: z.string(),
  name: z.string(),
  discordId: z.string(),
  month: z.number().int(),
  day: z.number().int(),
});
export type PlannedBirthday = z.infer<typeof PlannedBirthdaySchema>;

const PlannedWordGameSchema = z.object({
  started: z.boolean(),
  lastUserId: z.string(),
  lastWord: z.string(),
  count: z.number().int(),
  words: z.array(z.string()),
});
export type PlannedWordGame = z.infer<typeof PlannedWordGameSchema>;

const PlannedGuildSchema = z.object({
  discordId: z.string(),
  config: z.object({
    introChannelId: z.string().nullable(),
    logChannelId: z.string().nullable(),
    birthdayChannelId: z.string().nullable(),
    wordChannelId: z.string().nullable(),
    wordMaxWords: z.number().int(),
  }),
  /** Business days (YYYY-MM-DD, Asia/Ho_Chi_Minh) to load as DONE. */
  completedDates: z.array(z.string()),
  wishIndexes: z.array(z.number().int()),
  birthdays: z.array(PlannedBirthdaySchema),
  wordGame: PlannedWordGameSchema.nullable(),
});
export type PlannedGuild = z.infer<typeof PlannedGuildSchema>;

export const PlanSchema = z.object({
  guilds: z.array(PlannedGuildSchema),
  skipped: SkippedSchema,
  /** Legacy note rows read; none can be loaded because they carry no guild. */
  noteRows: z.number().int(),
});
export type Plan = z.infer<typeof PlanSchema>;

/** Table names in the order `apply` writes them. */
export const APPLY_ORDER = [
  'Guild',
  'GuildConfig',
  'BirthdayCompletedDate',
  'BirthdayWishUsage',
  'BirthdayEntry',
  'NoteEntry',
  'WordGameState',
  'WordGameUsedWord',
] as const;

export type TableName = (typeof APPLY_ORDER)[number];

const TableCountsSchema = z.record(z.enum(APPLY_ORDER), z.number().int());
export type TableCounts = z.infer<typeof TableCountsSchema>;

const ApplyResultSchema = z.object({
  /** Rows the plan asked to write, per table. */
  planned: TableCountsSchema,
  /** Rows actually inserted; the rest existed already (DO NOTHING). */
  inserted: TableCountsSchema,
  /**
   * Rows of guilds that loaded which were skipped because their natural key
   * already existed (planned minus inserted); a failed guild adds nothing.
   */
  existing: TableCountsSchema,
  /** Target table sizes before anything was written. */
  targetBefore: TableCountsSchema,
  /** Guilds whose transaction failed: hashed key and error label only. */
  failures: z.array(z.object({ guildKey: z.string(), error: z.string() })),
  /** Set when the target was not empty and the run went ahead on request. */
  allowedNonEmpty: z.boolean(),
});
export type ApplyResult = z.infer<typeof ApplyResultSchema>;

const DictionaryCheckSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('OK'), sourceKeys: z.number(), assetKeys: z.number() }),
  z.object({ status: z.literal('MISMATCH'), sourceKeys: z.number(), assetKeys: z.number() }),
  z.object({ status: z.literal('SKIPPED_NO_ASSET') }),
  z.object({ status: z.literal('SKIPPED_NO_SOURCE') }),
]);
export type DictionaryCheck = z.infer<typeof DictionaryCheckSchema>;

export const MigrateOptionsSchema = z.object({
  command: z.literal('migrate'),
  sourceDir: z.string(),
  apply: z.boolean(),
  allowNonEmpty: z.boolean(),
  dictAsset: z.string().nullable(),
});
export type MigrateOptions = z.infer<typeof MigrateOptionsSchema>;

export const ExportClaimsOptionsSchema = z.object({
  command: z.literal('export-claims'),
  targetDir: z.string(),
  days: z.number().int(),
});

export type CliOptions = MigrateOptions | z.infer<typeof ExportClaimsOptionsSchema>;

/** The report: counts and codes only, nothing that identifies a member. */
export const ReportSchema = z.object({
  mode: z.enum(['dry-run', 'apply']),
  flags: z.object({ apply: z.boolean(), allowNonEmpty: z.boolean(), dictAsset: z.boolean() }),
  source: z.object({
    rows: z.object({
      birthday: z.number().int(),
      config: z.number().int(),
      note: z.number().int(),
      word: z.number().int(),
    }),
    dictKeyCount: z.number().int().nullable(),
    missingFiles: z.array(z.string()),
    unparsableRows: z.number().int(),
  }),
  /** Planned vs written, per table, in apply order. */
  tables: z.array(
    z.object({
      table: z.string(),
      planned: z.number().int(),
      inserted: z.number().int().nullable(),
      /** Skipped because the row already existed in the target (reason TARGET_ROW_EXISTS); never overwritten. */
      existing: z.number().int().nullable(),
      targetBefore: z.number().int().nullable(),
    }),
  ),
  skipped: SkippedSchema,
  dictionary: DictionaryCheckSchema,
  failures: ApplyResultSchema.shape.failures,
  /** Whether the run went ahead against a target that already held rows. */
  allowedNonEmpty: z.boolean(),
});
export type Report = z.infer<typeof ReportSchema>;

export const LegacyColumnsSchema = z.object({ id: z.string(), value: z.string() });
export type LegacyColumns = z.infer<typeof LegacyColumnsSchema>;

export const ExportClaimsResultSchema = z.object({
  /** Distinct (guild, day) claims written into the legacy file. */
  claims: z.number().int(),
  /**
   * Day runs still SENDING that were exported too: the new bot was mid-way
   * through that day, so the old bot must not greet it again.
   */
  exportedSending: z.number().int(),
  /** Guilds with claims whose row is missing from the legacy file. */
  guildsNotInLegacy: z.number().int(),
});
export type ExportClaimsResult = z.infer<typeof ExportClaimsResultSchema>;
