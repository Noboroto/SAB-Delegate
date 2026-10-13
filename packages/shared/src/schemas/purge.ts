import { z } from 'zod';
import { SnowflakeSchema } from './snowflake.js';

/** The most `purgeLast` selects in one call. */
export const PURGE_COUNT_MAX = 1000;

/**
 * The most messages one range may cover. A range past it is refused rather
 * than cut: the person asked for everything between two messages, and deleting
 * only part of it would leave them guessing which part.
 */
export const PURGE_RANGE_MAX = 5000;

/** How many message ids a dry run lists; the count always covers all of them. */
export const PURGE_SAMPLE_SIZE = 10;

export const PurgeStatusSchema = z.enum([
  'OK',
  /** The `until` message is not in the channel. */
  'UNTIL_NOT_FOUND',
  /** The `from` message is not in the channel. */
  'FROM_NOT_FOUND',
  /** The `until` message is not older than the `from` message. */
  'RANGE_REVERSED',
  /** More than `PURGE_RANGE_MAX` messages lie in the range. */
  'RANGE_TOO_LARGE',
]);

export type PurgeStatus = z.infer<typeof PurgeStatusSchema>;

/**
 * Input of `PurgeService.purgeRange`. The messages after `untilMessageId`
 * (exclusive) up to `fromMessageId` (inclusive; the newest message when
 * absent) go. System messages are never touched.
 */
export const PurgeRangeSchema = z.object({
  channelId: SnowflakeSchema,
  untilMessageId: SnowflakeSchema,
  fromMessageId: SnowflakeSchema.optional(),
});

export type PurgeRange = z.infer<typeof PurgeRangeSchema>;

/**
 * Input of `PurgeService.purgeLast`: the newest `count` messages, counted from
 * `fromMessageId` (inclusive) when given. A dry run reports the newest message
 * it saw; passing that back as `fromMessageId` keeps messages posted since from
 * joining the selection.
 */
export const PurgeLastSchema = z.object({
  channelId: SnowflakeSchema,
  count: z.number().int().min(1).max(PURGE_COUNT_MAX),
  fromMessageId: SnowflakeSchema.optional(),
});

export type PurgeLast = z.infer<typeof PurgeLastSchema>;

/**
 * What a dry run reports. `count` is what the real run would delete,
 * `fromMessageId` the newest message of the selection (null when empty),
 * `olderCount` how many are past the two weeks Discord allows in bulk and go
 * one by one, and `sample` the newest few ids.
 */
export const PurgePlanSchema = z.object({
  status: PurgeStatusSchema,
  count: z.number().int().min(0),
  fromMessageId: SnowflakeSchema.nullable(),
  olderCount: z.number().int().min(0),
  sample: z.array(SnowflakeSchema).max(PURGE_SAMPLE_SIZE),
});

export type PurgePlan = z.infer<typeof PurgePlanSchema>;

/** What a purge did: of the `count` selected, `deleted` are gone and `failed` could not be deleted. */
export const PurgeResultSchema = z.object({
  status: PurgeStatusSchema,
  count: z.number().int().min(0),
  deleted: z.number().int().min(0),
  failed: z.number().int().min(0),
});

export type PurgeResult = z.infer<typeof PurgeResultSchema>;
