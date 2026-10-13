import { z } from 'zod';
import { MESSAGE_MAX_LENGTH } from '../constants/limits.js';
import { MessageRefFailureSchema } from '../utils/message-ref.js';
import { SnowflakeSchema } from './snowflake.js';

/** Discord rejects a thread name longer than this. */
export const THREAD_NAME_MAX_LENGTH = 100;

/**
 * The first post of a thread, before the line that says who made it. The
 * limit leaves room for that line (a mention and a short sentence) inside the
 * 2000 characters one message may hold.
 */
export const THREAD_MESSAGE_MAX_LENGTH = 1900;

/** The line put above the first post is built by the interface and must stay short. */
export const THREAD_BYLINE_MAX_LENGTH = 100;

/**
 * A private thread is named `<prefix>-<username>`, a username takes up to 32
 * characters, and the whole name may not pass `THREAD_NAME_MAX_LENGTH`.
 */
export const PRIVATE_THREAD_PREFIX_MAX_LENGTH = 60;

/**
 * Members one call opens a private thread for. Each thread costs several
 * Discord requests, so the run has to end well inside the 15 minutes an
 * interaction can still be answered.
 */
export const PRIVATE_THREAD_MAX_MEMBERS = 500;

/** How many threads a dry run lists by name; the count always covers all of them. */
export const THREAD_SAMPLE_SIZE = 10;

/**
 * `reason` of a failure that is a code rather than text from Discord. The
 * interface words it in the reader's language; any other reason is the short
 * sentence Discord answered with.
 */
export const THREAD_FAILURE_REASON = {
  /** Replacing the prefix would leave the name empty or past the limit. */
  nameInvalid: 'NAME_INVALID',
  /** The id is not a member of the server. */
  memberNotFound: 'MEMBER_NOT_FOUND',
} as const;

/** Kept as written (line breaks and indentation matter) but never blank. */
const nonBlankMessage = (max: number) =>
  z
    .string()
    .max(max)
    .refine((text) => text.trim() !== '', { message: 'message must not be blank' });

const ThreadNameSchema = z.string().trim().min(1).max(THREAD_NAME_MAX_LENGTH);

/** Why a thread could not be made, or `CREATED`. */
export const ThreadCreateStatusSchema = z.enum([
  'CREATED',
  /** The channel is not a text, announcement or forum channel. */
  'CHANNEL_CANNOT_HOLD_THREADS',
  /** Discord offers private threads in text channels only. */
  'PRIVATE_NEEDS_TEXT_CHANNEL',
]);

export type ThreadCreateStatus = z.infer<typeof ThreadCreateStatusSchema>;

/**
 * Input of `ThreadService.create`. `isPrivate` is ignored in a forum channel,
 * whose posts are always public.
 */
export const ThreadCreateSchema = z.object({
  channelId: SnowflakeSchema,
  name: ThreadNameSchema,
  message: nonBlankMessage(THREAD_MESSAGE_MAX_LENGTH),
  isPrivate: z.boolean().default(false),
  /** Printed above the message, e.g. who made the thread. */
  byline: z.string().trim().min(1).max(THREAD_BYLINE_MAX_LENGTH).optional(),
});

export type ThreadCreate = z.input<typeof ThreadCreateSchema>;

export const ThreadCreateResultSchema = z.object({
  status: ThreadCreateStatusSchema,
  threadId: SnowflakeSchema.nullable(),
});

export type ThreadCreateResult = z.infer<typeof ThreadCreateResultSchema>;

/** Input of `ThreadService.renameByPrefix`: only the leading prefix of each name is replaced. */
export const ThreadRenameSchema = z.object({
  channelId: SnowflakeSchema,
  oldPrefix: z.string().trim().min(1).max(THREAD_NAME_MAX_LENGTH),
  /** May be empty: that removes the prefix. */
  newPrefix: z.string().trim().max(THREAD_NAME_MAX_LENGTH),
});

export type ThreadRename = z.infer<typeof ThreadRenameSchema>;

/** Input of `ThreadService.deleteByPrefix`. */
export const ThreadDeleteSchema = z.object({
  channelId: SnowflakeSchema,
  prefix: z.string().trim().min(1).max(THREAD_NAME_MAX_LENGTH),
});

export type ThreadDelete = z.infer<typeof ThreadDeleteSchema>;

/** `OK`, or `CHANNEL_CANNOT_HOLD_THREADS` when the channel has no threads to list. */
export const ThreadBatchStatusSchema = z.enum(['OK', 'CHANNEL_CANNOT_HOLD_THREADS']);

export type ThreadBatchStatus = z.infer<typeof ThreadBatchStatusSchema>;

export const ThreadMatchSchema = z.object({
  threadId: SnowflakeSchema,
  name: z.string(),
  /** The name a rename would give; absent for a deletion. */
  newName: z.string().optional(),
});

export type ThreadMatch = z.infer<typeof ThreadMatchSchema>;

/**
 * What a dry run of a rename or deletion reports: how many active threads
 * match, how many of those a rename cannot apply to (`invalid`), and the first
 * few by name.
 */
export const ThreadBatchPlanSchema = z.object({
  status: ThreadBatchStatusSchema,
  count: z.number().int().min(0),
  invalid: z.number().int().min(0),
  sample: z.array(ThreadMatchSchema).max(THREAD_SAMPLE_SIZE),
});

export type ThreadBatchPlan = z.infer<typeof ThreadBatchPlanSchema>;

export const ThreadFailureSchema = z.object({
  threadId: SnowflakeSchema,
  name: z.string(),
  reason: z.string(),
});

export type ThreadFailure = z.infer<typeof ThreadFailureSchema>;

/** What a rename or deletion did: `done` of the `count` matches, and why the rest did not. */
export const ThreadBatchResultSchema = z.object({
  status: ThreadBatchStatusSchema,
  count: z.number().int().min(0),
  done: z.number().int().min(0),
  failures: z.array(ThreadFailureSchema),
});

export type ThreadBatchResult = z.infer<typeof ThreadBatchResultSchema>;

const PrivateThreadBaseSchema = z.object({
  channelId: SnowflakeSchema,
  prefix: z.string().trim().min(1).max(PRIVATE_THREAD_PREFIX_MAX_LENGTH),
  message: nonBlankMessage(MESSAGE_MAX_LENGTH),
});

/**
 * Input of `PrivateThreadService.createPrivateThreads`: members by id, by
 * role, or both (duplicates collapse).
 */
export const PrivateThreadCreateSchema = PrivateThreadBaseSchema.extend({
  userIds: z.array(SnowflakeSchema).max(PRIVATE_THREAD_MAX_MEMBERS).default([]),
  roleId: SnowflakeSchema.optional(),
}).refine((input) => input.userIds.length > 0 || input.roleId !== undefined, {
  message: 'userIds or roleId is required',
  path: ['userIds'],
});

export type PrivateThreadCreate = z.input<typeof PrivateThreadCreateSchema>;

/** Input of `PrivateThreadService.createPrivateThreadsFromReactors`. */
export const PrivateThreadFromReactorsSchema = PrivateThreadBaseSchema.extend({
  messageLink: z.string().trim().min(1).max(200),
  emoji: z.string().trim().min(1).max(100),
});

export type PrivateThreadFromReactors = z.input<typeof PrivateThreadFromReactorsSchema>;

export const PrivateThreadStatusSchema = z.enum([
  'OK',
  /** Discord offers private threads in text channels only. */
  'CHANNEL_NOT_TEXT',
  /** Nobody to open a thread for: no member in the list or role, or nobody reacted. */
  'NO_MEMBERS',
  'INVALID_LINK',
  'MESSAGE_NOT_FOUND',
  'NO_ACCESS',
]);

export type PrivateThreadStatus = z.infer<typeof PrivateThreadStatusSchema>;

export const PrivateThreadFailureSchema = z.object({
  userId: SnowflakeSchema,
  reason: z.string(),
});

export type PrivateThreadFailure = z.infer<typeof PrivateThreadFailureSchema>;

export const PrivateThreadResultSchema = z.object({
  status: PrivateThreadStatusSchema,
  /** Present when `status` is `INVALID_LINK`. */
  linkProblem: MessageRefFailureSchema.nullable(),
  total: z.number().int().min(0),
  created: z.number().int().min(0),
  failures: z.array(PrivateThreadFailureSchema),
});

export type PrivateThreadResult = z.infer<typeof PrivateThreadResultSchema>;
