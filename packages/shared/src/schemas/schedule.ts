import { z } from 'zod';
import { MESSAGE_MAX_LENGTH } from '../constants/limits.js';
import { ScheduledKindSchema } from '../generated/zod/schemas/enums/ScheduledKind.schema.js';
import { ScheduledStatusSchema } from '../generated/zod/schemas/enums/ScheduledStatus.schema.js';
import { ScheduledMessageSchema } from '../generated/zod/schemas/models/ScheduledMessage.schema.js';
import { parseRunAt } from '../utils/parse-when.js';
import { SnowflakeSchema } from './snowflake.js';

/** How much of a scheduled message `/scheduler get` shows as its description. */
export const SCHEDULE_DESCRIPTION_MAX_LENGTH = 200;

/** The most scheduled messages one listing returns (the newest ones). */
export const SCHEDULE_LIST_MAX = 100;

/**
 * Pending messages one server may hold. Each one is a row and a queued job
 * that stays until its time, so an unbounded count lets a leaked API key (or
 * a loop) fill the table.
 */
export const SCHEDULE_PENDING_MAX = 500;

/** How far ahead a message may be scheduled, in days; a day more than a year keeps "same date next year" valid. */
export const SCHEDULE_MAX_HORIZON_DAYS = 366;

/** How many suggestions `scheduler cancel` offers; Discord shows at most 25. */
export const SCHEDULE_AUTOCOMPLETE_MAX = 25;

/**
 * Why a scheduled message did not go out, as stored in `lastError` (the
 * message catalog explains each under `schedule.failure`). Anything else in
 * `lastError` is the label of a transient error that is being retried.
 */
export const ScheduleFailureSchema = z.enum([
  'SOURCE_GONE',
  'SOURCE_EMPTY',
  'CHANNEL_GONE',
  'NO_PERMISSION',
  'GUILD_MISMATCH',
  'SEND_REJECTED',
  'CREATOR_LOST_ACCESS',
  'KEY_REVOKED',
  'GAVE_UP',
]);

export type ScheduleFailure = z.infer<typeof ScheduleFailureSchema>;

/**
 * Which mentions a message may notify, in the shape Discord takes. Discord
 * refuses `parse: ['users']` next to an explicit `users` list (and the same
 * for roles), so the schema refuses it too, before a job fails at send time.
 */
export const AllowedMentionsSchema = z
  .object({
    parse: z
      .array(z.enum(['users', 'roles', 'everyone']))
      .max(3)
      .default([]),
    users: z.array(SnowflakeSchema).max(100).optional(),
    roles: z.array(SnowflakeSchema).max(100).optional(),
  })
  .refine(
    (mentions) =>
      !(mentions.parse.includes('users') && mentions.users !== undefined) &&
      !(mentions.parse.includes('roles') && mentions.roles !== undefined),
    { message: 'parse and an explicit list cannot name the same kind of mention' },
  );

export type AllowedMentions = z.infer<typeof AllowedMentionsSchema>;

/** Notifies nobody: what REST and MCP callers always get, and the column default. */
export const ALLOWED_MENTIONS_NONE: AllowedMentions = { parse: [] };

/**
 * What the previous bot's scheduled messages did: a mention in the text
 * notified whoever it named. Only slash commands keep it, because Discord
 * already limited who could run them.
 */
export const ALLOWED_MENTIONS_ALL: AllowedMentions = {
  parse: ['users', 'roles', 'everyone'],
};

/**
 * When to send, for REST and MCP: an ISO 8601 instant with an offset (or `Z`),
 * a local time with no offset (read as Vietnam time), or a `Date`. Whether it
 * is in the future is the service's call.
 */
export const RunAtSchema = z.union([
  z.date(),
  z.string().transform((text, ctx) => {
    const at = parseRunAt(text);
    if (at === null) {
      ctx.addIssue({ code: 'custom', message: 'runAt must be an ISO 8601 date and time' });
      return z.NEVER;
    }
    return at;
  }),
]);

/** Text that Discord would refuse to send as a message. */
const ScheduleContentSchema = z
  .string()
  .max(MESSAGE_MAX_LENGTH)
  .refine((content) => content.trim() !== '', { message: 'content must not be blank' });

export const ScheduleSendInputSchema = z.object({
  channelId: SnowflakeSchema,
  content: ScheduleContentSchema,
  runAt: RunAtSchema,
  allowedMentions: AllowedMentionsSchema.optional(),
});

export type ScheduleSendInput = z.input<typeof ScheduleSendInputSchema>;

export const ScheduleCopyInputSchema = z.object({
  channelId: SnowflakeSchema,
  /** A message link, a `channelId/messageId` pair, or a bare message id. */
  source: z.string().trim().min(1).max(300),
  /** The channel a bare message id refers to. */
  sourceChannelId: SnowflakeSchema.optional(),
  runAt: RunAtSchema,
  allowedMentions: AllowedMentionsSchema.optional(),
});

export type ScheduleCopyInput = z.input<typeof ScheduleCopyInputSchema>;

/**
 * A scheduled message as the commands and the API show it. `.pick` keeps the
 * job id, the lease and the internal keys of the row from reaching a response
 * when a column is added later.
 */
export const ScheduledMessageViewSchema = ScheduledMessageSchema.pick({
  seq: true,
  kind: true,
  runAt: true,
  status: true,
  attempts: true,
  source: true,
  createdAt: true,
}).extend({
  id: z.uuid(),
  channelId: SnowflakeSchema,
  content: z.string().nullable(),
  sourceChannelId: SnowflakeSchema.nullable(),
  sourceMessageId: SnowflakeSchema.nullable(),
  createdByUserId: SnowflakeSchema,
  lastError: z.string().nullable(),
  allowedMentions: AllowedMentionsSchema,
});

export type ScheduledMessageView = z.infer<typeof ScheduledMessageViewSchema>;

export const ScheduleListQuerySchema = z.object({
  status: ScheduledStatusSchema.optional(),
  limit: z.number().int().min(1).max(SCHEDULE_LIST_MAX).default(SCHEDULE_LIST_MAX),
});

export type ScheduleListQuery = z.input<typeof ScheduleListQuerySchema>;

/**
 * What scheduling did, or with `dryRun` what it would do: `schedule` is null
 * then, and the other fields describe the message as it would be stored.
 * `content` is the text to send, or for a copy the source's text right now.
 */
export const ScheduleCreateResultSchema = z.object({
  dryRun: z.boolean(),
  kind: ScheduledKindSchema,
  channelId: SnowflakeSchema,
  runAt: z.date(),
  content: z.string().nullable(),
  attachmentCount: z.number().int().min(0),
  allowedMentions: AllowedMentionsSchema,
  schedule: ScheduledMessageViewSchema.nullable(),
});

export type ScheduleCreateResult = z.infer<typeof ScheduleCreateResultSchema>;

/**
 * `CANCELED`: it was pending and now is not (with `dryRun`, it would be).
 * `ALREADY_CANCELED`: nothing to do, which is not an error. `NOT_PENDING`: it
 * already went out, failed, or is being sent right now. `NOT_FOUND`: no such number.
 */
export const ScheduleCancelResultSchema = z.object({
  dryRun: z.boolean(),
  code: z.enum(['CANCELED', 'ALREADY_CANCELED', 'NOT_PENDING', 'NOT_FOUND']),
  seq: z.number().int().min(1),
  status: ScheduledStatusSchema.nullable(),
});

export type ScheduleCancelResult = z.infer<typeof ScheduleCancelResultSchema>;

export const ScheduleCancelByKeyResultSchema = z.object({
  /** Pending messages the revoked key had created, now canceled. */
  count: z.number().int().min(0),
});

export type ScheduleCancelByKeyResult = z.infer<typeof ScheduleCancelByKeyResultSchema>;

/** One entry of the `scheduler cancel` suggestions. */
export const SchedulePendingChoiceSchema = z.object({
  seq: z.number().int().min(1),
  kind: ScheduledKindSchema,
  runAt: z.date(),
  preview: z.string(),
});

export type SchedulePendingChoice = z.infer<typeof SchedulePendingChoiceSchema>;
