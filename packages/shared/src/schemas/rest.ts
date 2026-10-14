import { z } from 'zod';
import { DEFAULT_LOCALE, LocaleSchema } from '../utils/locale.js';
import { AuditActionSchema } from '../audit-actions.js';
import { ScheduledStatusSchema } from '../generated/zod/schemas/enums/ScheduledStatus.schema.js';
import { AuditLogSchema } from '../generated/zod/schemas/models/AuditLog.schema.js';
import {
  BirthdayImportProblemSchema,
  BirthdayImportResultSchema,
  BirthdayImportSchema,
  BirthdaySelectorSchema,
} from './birthday.js';
import { GuildSettingsPatchSchema } from './guild-config.js';
import { SEARCH_MAX_LENGTH } from './list-query.js';
import { MentionNonReactorsInputSchema, MentionReactorsInputSchema } from './mention.js';
import { CreateReactionPollSchema, MessageContentSchema, SendMessageSchema } from './messaging.js';
import { NoteKeySchema } from './note.js';
import { PAGE_SIZE_MAX } from './pagination.js';
import { PurgeLastSchema, PurgeRangeSchema } from './purge.js';
import { RoleAssignMembersInputSchema, RoleAssignReactorsInputSchema } from './role-assign.js';
import { SCHEDULE_LIST_MAX, ScheduleCopyInputSchema, ScheduleSendInputSchema } from './schedule.js';
import { SnowflakeSchema } from './snowflake.js';
import { ThreadCreateSchema, ThreadDeleteSchema, ThreadRenameSchema } from './thread.js';
import { WordGameConfigSchema } from './word-game.js';

/*
 * Request and response shapes of the REST API that the slash commands have no
 * use for: the preview flag a write takes, the query forms of the list and
 * delete routes, and the bot profile, audit log and lookup views. Everything
 * else the controllers accept is the service's own input schema.
 */

// ---- preview flags -------------------------------------------------

/** A boolean carried in a query string; absent means false. Anything but "true"/"false" is a 400. */
const QueryFlagSchema = z
  .enum(['true', 'false'])
  .default('false')
  .transform((flag) => flag === 'true');

const dryRunField = z.boolean().default(false);

/**
 * The two flags of a destructive call in a query string, for routes that have
 * no body. The caller adds `requireConfirmation` so that neither flag is a 400.
 */
const destructiveQueryShape = {
  dryRun: QueryFlagSchema,
  confirm: QueryFlagSchema,
} as const;

/** A write that can be previewed but needs no confirmation. */
const dryRunBodyShape = { dryRun: dryRunField } as const;

/** The two flags of a destructive call in a JSON body. */
const destructiveBodyShape = { dryRun: dryRunField, confirm: z.boolean().default(false) } as const;

/**
 * A destructive request either asks for a preview or confirms the real run:
 * sending neither is a 400 on `confirm`, so a stray request cannot delete
 * anything.
 */
export function requireConfirmation<T extends z.ZodType<{ dryRun: boolean; confirm: boolean }>>(
  schema: T,
): T {
  return schema.refine(({ dryRun, confirm }) => dryRun || confirm, {
    message: 'confirm must be true to run; send dryRun to preview',
    path: ['confirm'],
  });
}

// ---- birthdays -----------------------------------------------------------------

/**
 * Removal names exactly one person, by student ID or by Discord user. The
 * slash command lets a student ID win when both are given; over HTTP both (or
 * neither) is a mistake worth a 400 instead of a guess.
 */
export const BirthdayRemoveQuerySchema = requireConfirmation(
  BirthdaySelectorSchema.extend(destructiveQueryShape).refine(
    ({ studentId, discordId }) => (studentId === undefined) !== (discordId === undefined),
    { message: 'send exactly one of studentId or discordId', path: ['studentId'] },
  ),
);

export const BirthdayListQuerySchema = z.object({
  month: z.coerce.number().int().min(1).max(12).optional(),
});

/** Either the text of a CSV file or already split rows; never both. */
export const BirthdayImportRequestSchema = z
  .object({
    csv: z.string().min(1).optional(),
    rows: BirthdayImportSchema.shape.rows.optional(),
    dryRun: dryRunField,
  })
  .refine((request) => (request.csv === undefined) !== (request.rows === undefined), {
    message: 'send either csv or rows',
    path: ['csv'],
  });

/** The import result plus the CSV lines that were not taken. */
export const BirthdayImportReportSchema = BirthdayImportResultSchema.extend({
  problems: z.array(BirthdayImportProblemSchema),
});

export type BirthdayImportReport = z.infer<typeof BirthdayImportReportSchema>;

// ---- notes ---------------------------------------------------------------------

export const NoteListQuerySchema = z.object({ roleId: SnowflakeSchema.optional() });

export const NoteDeleteQuerySchema = requireConfirmation(
  NoteKeySchema.extend(destructiveQueryShape),
);

// ---- word game -----------------------------------------------------------------

export const WordGameConfigRequestSchema = WordGameConfigSchema.safeExtend(dryRunBodyShape);

export const WordGameResetRequestSchema = requireConfirmation(z.object(destructiveBodyShape));

// ---- schedules -----------------------------------------------------------------

/** Largest value of the `Int` column that numbers the messages of a server. */
const SCHEDULE_SEQ_MAX = 2_147_483_647;

/**
 * No `allowedMentions`: the API never pings. A body that names it has the field
 * stripped, so a caller cannot ask for a notification the service would refuse.
 */
const ScheduleSendRequestSchema = ScheduleSendInputSchema.omit({ allowedMentions: true }).extend({
  kind: z.literal('send'),
  ...dryRunBodyShape,
});

const ScheduleCopyRequestSchema = ScheduleCopyInputSchema.omit({ allowedMentions: true }).extend({
  kind: z.literal('copy'),
  ...dryRunBodyShape,
});

export const ScheduleCreateRequestSchema = z.discriminatedUnion('kind', [
  ScheduleSendRequestSchema,
  ScheduleCopyRequestSchema,
]);

export type ScheduleCreateRequest = z.infer<typeof ScheduleCreateRequestSchema>;

export const ScheduleCancelQuerySchema = requireConfirmation(z.object(destructiveQueryShape));

/** A query string carries text, hence the coercion the service's own schema does not do. */
export const ScheduleListRequestSchema = z.object({
  status: ScheduledStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(SCHEDULE_LIST_MAX).default(SCHEDULE_LIST_MAX),
});

/** The number a scheduled message has within its server, as shown in `/scheduler get`. */
export const ScheduleSeqParamSchema = z.object({
  id: z.coerce.number().int().min(1).max(SCHEDULE_SEQ_MAX),
});

// ---- messages ------------------------------------------------------------------

export const SendMessageRequestSchema = SendMessageSchema.extend(dryRunBodyShape);

export const CreateReactionPollRequestSchema = CreateReactionPollSchema.extend(dryRunBodyShape);

/** The message to edit is named by the route; the body is only what it should say. */
export const EditBotMessageRequestSchema = z.object({
  content: MessageContentSchema,
  ...dryRunBodyShape,
});

// ---- mentions, threads, purge, role assignment --------------------------------

export const MentionReactorsRequestSchema = MentionReactorsInputSchema.extend(dryRunBodyShape);

export const MentionNonReactorsRequestSchema =
  MentionNonReactorsInputSchema.extend(dryRunBodyShape);

/**
 * The opening line naming who made the thread is built by the slash command;
 * an API caller cannot write one, so `byline` is not accepted.
 */
export const ThreadCreateRequestSchema = ThreadCreateSchema.omit({ byline: true });

export const ThreadRenameRequestSchema = requireConfirmation(
  ThreadRenameSchema.extend(destructiveBodyShape),
);

export const ThreadDeleteRequestSchema = requireConfirmation(
  ThreadDeleteSchema.extend(destructiveBodyShape),
);

export const PurgeRequestSchema = requireConfirmation(
  z.discriminatedUnion('mode', [
    PurgeRangeSchema.extend({ mode: z.literal('range'), ...destructiveBodyShape }),
    PurgeLastSchema.extend({ mode: z.literal('last'), ...destructiveBodyShape }),
  ]),
);

export const RoleAssignMembersRequestSchema = requireConfirmation(
  RoleAssignMembersInputSchema.safeExtend(destructiveBodyShape),
);

export const RoleAssignReactorsRequestSchema = requireConfirmation(
  RoleAssignReactorsInputSchema.safeExtend(destructiveBodyShape),
);

// ---- settings ------------------------------------------------------------------

export const GuildSettingsPatchRequestSchema = GuildSettingsPatchSchema.extend(dryRunBodyShape);

// ---- bot profile ---------------------------------------------------------------

/** Discord's limit for a nickname. */
const BOT_NICK_MAX_LENGTH = 32;

/** The largest picture the bot accepts for its server avatar, before base64. */
export const BOT_AVATAR_MAX_BYTES = 256 * 1024;

const BOT_AVATAR_BASE64_MAX_LENGTH = Math.ceil(BOT_AVATAR_MAX_BYTES / 3) * 4;

/** How the bot looks in one server: its nickname there and the address of its server avatar. */
export const BotProfileSchema = z.object({
  nick: z.string().nullable(),
  avatarUrl: z.string().nullable(),
});

export type BotProfile = z.infer<typeof BotProfileSchema>;

/**
 * `avatar` is the picture itself in base64 and nothing else: a URL (or a data
 * URI) does not match the pattern, so the server never fetches an address a
 * caller chose. The format is judged from the bytes by the service.
 */
export const BotProfileSetRequestSchema = z
  .object({
    // `null` clears the nickname, so the bot shows its default name again.
    nick: z.string().trim().min(1).max(BOT_NICK_MAX_LENGTH).nullable().optional(),
    avatar: z
      .string()
      .min(1)
      .max(BOT_AVATAR_BASE64_MAX_LENGTH)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/, 'avatar must be base64 image bytes')
      .optional(),
    ...dryRunBodyShape,
  })
  .refine((request) => request.nick !== undefined || request.avatar !== undefined, {
    message: 'nick or avatar is required',
    path: ['nick'],
  });

export type BotProfileSetRequest = z.infer<typeof BotProfileSetRequestSchema>;

/** What changed (or with `dryRun` would change) and how the bot looks afterwards. */
export const BotProfileSetResultSchema = z.object({
  dryRun: z.boolean(),
  changes: z.array(z.enum(['nick', 'avatar'])),
  profile: BotProfileSchema,
});

export type BotProfileSetResult = z.infer<typeof BotProfileSetResultSchema>;

// ---- overview, audit log, command catalog -------------------------------------

/** What the dashboard shows of the bot's health; nothing about other servers. */
export const SystemOverviewSchema = z.object({
  uptimeMs: z.number().int().min(0),
  wsPing: z.number().int().min(-1),
});

export type SystemOverview = z.infer<typeof SystemOverviewSchema>;

export const AuditLogsQuerySchema = z.object({
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(50),
  action: AuditActionSchema.optional(),
  since: z.iso
    .datetime({ offset: true })
    .transform((instant) => new Date(instant))
    .optional(),
});

/** `.pick` keeps the server key of the row out of the response if a column is added later. */
export const AuditLogViewSchema = AuditLogSchema.pick({
  id: true,
  source: true,
  actorDiscordId: true,
  apiKeyId: true,
  action: true,
  params: true,
  ok: true,
  error: true,
  createdAt: true,
});

export type AuditLogView = z.infer<typeof AuditLogViewSchema>;

/** Newest first; pass `nextCursor` back as `cursor` for the next page. */
export const AuditLogPageSchema = z.object({
  items: z.array(AuditLogViewSchema),
  nextCursor: z.string().nullable(),
});

export type AuditLogPage = z.infer<typeof AuditLogPageSchema>;

export const CommandsQuerySchema = z.object({ locale: LocaleSchema.default(DEFAULT_LOCALE) });

/** A subcommand reached through its full path, e.g. `birthday remove`. */
const CommandCatalogSubcommandSchema = z.object({
  name: z.string(),
  description: z.string(),
});

export const CommandCatalogEntrySchema = z.object({
  name: z.string(),
  description: z.string(),
  /** Discord's default-permission bit set as a decimal string; null when everyone may use it. */
  defaultMemberPermissions: z.string().nullable(),
  guildOnly: z.boolean(),
  subcommands: z.array(CommandCatalogSubcommandSchema),
});

export type CommandCatalogEntry = z.infer<typeof CommandCatalogEntrySchema>;

// ---- Discord lookups for the dashboard's pickers -------------------------------

/** Most members one search returns. */
export const LOOKUP_MEMBERS_LIMIT = 25;

export const LookupChannelSchema = z.object({
  id: SnowflakeSchema,
  name: z.string(),
  /** Discord's channel type number. */
  type: z.number().int(),
  parentId: SnowflakeSchema.nullable(),
  position: z.number().int(),
});

export const LookupRoleSchema = z.object({
  id: SnowflakeSchema,
  name: z.string(),
  color: z.number().int(),
  position: z.number().int(),
  managed: z.boolean(),
});

export const LookupMemberSchema = z.object({
  id: SnowflakeSchema,
  username: z.string(),
  displayName: z.string(),
  bot: z.boolean(),
});

export const LookupMembersQuerySchema = z.object({
  q: z.string().trim().min(1).max(SEARCH_MAX_LENGTH),
});

export type LookupChannel = z.infer<typeof LookupChannelSchema>;
export type LookupRole = z.infer<typeof LookupRoleSchema>;
export type LookupMember = z.infer<typeof LookupMemberSchema>;
