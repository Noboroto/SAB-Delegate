import { z } from 'zod';

/**
 * A Discord id: a decimal string of 17 to 20 digits. Mentions such as `<@123>`
 * and numbers are rejected on purpose; ids stay strings because they exceed the
 * safe integer range.
 */
export const SnowflakeSchema = z
  .string()
  .trim()
  .regex(/^\d{17,20}$/, 'must be a Discord snowflake');

export type Snowflake = z.infer<typeof SnowflakeSchema>;
