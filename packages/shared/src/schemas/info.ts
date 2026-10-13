import { z } from 'zod';
import { REACTION_EMOJI_MAX_LENGTH } from '../constants/limits.js';
import { SnowflakeSchema } from './snowflake.js';

/** How many of the newest messages of the intro channel are searched for a member's first introduction. */
export const INTRO_SCAN_LIMIT = 10_000;

/** The reason travels in an HTTP header of the audit log, which Discord limits to 512 characters. */
export const INVITE_REASON_MAX_LENGTH = 400;

export const IntroductionQuerySchema = z.object({
  userId: SnowflakeSchema,
});

export type IntroductionQuery = z.infer<typeof IntroductionQuerySchema>;

/**
 * `NO_CHANNEL`: the server has no intro channel set. `NOT_FOUND`: the member
 * wrote nothing in the part of the channel that was searched (`scanned`
 * messages). An unreadable channel is an error, not a result.
 */
export const IntroductionResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('NO_CHANNEL') }),
  z.object({ status: z.literal('NOT_FOUND'), scanned: z.number().int().min(0) }),
  z.object({
    status: z.literal('FOUND'),
    channelId: SnowflakeSchema,
    messageId: SnowflakeSchema,
    url: z.string(),
    content: z.string(),
  }),
]);

export type IntroductionResult = z.infer<typeof IntroductionResultSchema>;

export const ReactorIdsQuerySchema = z.object({
  channelId: SnowflakeSchema,
  messageId: SnowflakeSchema,
  emoji: z.string().trim().min(1).max(REACTION_EMOJI_MAX_LENGTH),
});

export type ReactorIdsQuery = z.infer<typeof ReactorIdsQuerySchema>;

/** `userIds` is empty when nobody reacted with that emoji; bots are not listed. */
export const ReactorIdsResultSchema = z.object({
  url: z.string(),
  emoji: z.string(),
  userIds: z.array(SnowflakeSchema),
});

export type ReactorIdsResult = z.infer<typeof ReactorIdsResultSchema>;

/** With `channelId`, only the members who can see that channel (a thread: its members). */
export const RoleMembersQuerySchema = z.object({
  roleId: SnowflakeSchema,
  channelId: SnowflakeSchema.optional(),
});

export type RoleMembersQuery = z.infer<typeof RoleMembersQuerySchema>;

export const RoleMembersResultSchema = z.object({
  roleId: SnowflakeSchema,
  roleName: z.string(),
  userIds: z.array(SnowflakeSchema),
});

export type RoleMembersResult = z.infer<typeof RoleMembersResultSchema>;

export const InviteCreateSchema = z.object({
  channelId: SnowflakeSchema,
  reason: z.string().trim().min(1).max(INVITE_REASON_MAX_LENGTH).optional(),
});

export type InviteCreate = z.infer<typeof InviteCreateSchema>;

/** A thread has no invite of its own, so `channelId` is the channel the invite really belongs to. */
export const InviteResultSchema = z.object({
  url: z.string(),
  channelId: SnowflakeSchema,
  channelName: z.string(),
});

export type InviteResult = z.infer<typeof InviteResultSchema>;
