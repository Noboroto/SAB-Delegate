import { z } from 'zod';
import { SnowflakeSchema } from './snowflake.js';

/** More ids than this is a paste gone wrong, not a list somebody typed. */
export const ROLE_ASSIGN_MAX_USER_IDS = 5000;

/** How many members a plan or a result lists by id. */
export const ROLE_ASSIGN_SAMPLE_SIZE = 10;

/** How much of Discord's explanation of a failure is kept per member. */
export const ROLE_ASSIGN_REASON_MAX_LENGTH = 200;

/**
 * Give or take a role for a set of members. The set is the ids in `userIds`
 * plus, when `membersOfRoleId` is given, everyone who holds that role. At least
 * one of the two must name somebody.
 */
export const RoleAssignMembersInputSchema = z
  .object({
    roleId: SnowflakeSchema,
    userIds: z.array(SnowflakeSchema).max(ROLE_ASSIGN_MAX_USER_IDS).default([]),
    membersOfRoleId: SnowflakeSchema.optional(),
    remove: z.boolean().default(false),
  })
  .refine((input) => input.userIds.length > 0 || input.membersOfRoleId !== undefined, {
    message: 'userIds or membersOfRoleId is required',
    path: ['userIds'],
  });

export type RoleAssignMembersInput = z.input<typeof RoleAssignMembersInputSchema>;

/** Give or take a role for everyone who reacted to a message with one emoji. */
export const RoleAssignReactorsInputSchema = z.object({
  roleId: SnowflakeSchema,
  channelId: SnowflakeSchema,
  messageId: SnowflakeSchema,
  emoji: z.string().trim().min(1).max(100),
  remove: z.boolean().default(false),
});

export type RoleAssignReactorsInput = z.input<typeof RoleAssignReactorsInputSchema>;

export const RoleAssignFailureSchema = z.object({
  userId: SnowflakeSchema,
  /** The member's username, for the person reading the report. */
  name: z.string().max(100),
  reason: z.string().max(ROLE_ASSIGN_REASON_MAX_LENGTH),
});

export type RoleAssignFailure = z.infer<typeof RoleAssignFailureSchema>;

/**
 * `OK`: the work ran (or, for a dry run, was planned). `NO_REACTORS`: nobody
 * reacted with that emoji, so there was nothing to do.
 */
export const RoleAssignStatusSchema = z.enum(['OK', 'NO_REACTORS']);

export type RoleAssignStatus = z.infer<typeof RoleAssignStatusSchema>;

export const RoleAssignResultSchema = z.object({
  dryRun: z.boolean(),
  status: RoleAssignStatusSchema,
  /** Members that were (or would be) changed. */
  planned: z.number().int().min(0),
  /** Members whose role actually changed; 0 for a dry run. */
  done: z.number().int().min(0),
  /** Ids that are not members of the server; left out without a word, as before. */
  skipped: z.number().int().min(0),
  sample: z.array(SnowflakeSchema).max(ROLE_ASSIGN_SAMPLE_SIZE),
  failures: z.array(RoleAssignFailureSchema),
});

export type RoleAssignResult = z.infer<typeof RoleAssignResultSchema>;
