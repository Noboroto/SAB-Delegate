import { z } from 'zod';
import { SnowflakeSchema } from './snowflake.js';

/** Role and channel names are capped at 100; the longest suffix added to the name is `-thread-only`. */
export const ACTIVITY_NAME_MAX_LENGTH = 50;
export const ACTIVITY_EMOJI_MAX_LENGTH = 32;
export const ACTIVITY_SHORT_NAME_LENGTH = 3;

/**
 * The activity to set up. The category is optional: left out, the server's
 * default (`GuildConfig.activityCategoryId`) is used.
 */
export const ActivityCreateSchema = z.object({
  emoji: z.string().trim().min(1).max(ACTIVITY_EMOJI_MAX_LENGTH),
  name: z.string().trim().min(1).max(ACTIVITY_NAME_MAX_LENGTH),
  shortName: z.string().trim().length(ACTIVITY_SHORT_NAME_LENGTH),
  categoryId: SnowflakeSchema.optional(),
});

export type ActivityCreate = z.infer<typeof ActivityCreateSchema>;

/** What was created, so a caller can link to it. */
export const ActivityCreateResultSchema = z.object({
  categoryId: SnowflakeSchema,
  roles: z.object({
    event: SnowflakeSchema,
    multi: SnowflakeSchema,
    mc: SnowflakeSchema,
  }),
  channels: z.object({
    general: SnowflakeSchema,
    threadOnly: SnowflakeSchema,
    voice: SnowflakeSchema,
  }),
});

export type ActivityCreateResult = z.infer<typeof ActivityCreateResultSchema>;
