import { z } from 'zod';

/** Largest value of the unsigned 64-bit integer a snowflake is. */
const SNOWFLAKE_MAX = 2n ** 64n - 1n;

/**
 * A Discord id: a decimal string of 17 to 20 digits that fits an unsigned
 * 64-bit integer (20 digits alone admit values up to 99999999999999999999,
 * which no id can be and which Discord answers with an opaque error). Mentions
 * such as `<@123>` and numbers are rejected on purpose; ids stay strings
 * because they exceed the safe integer range.
 */
export const SnowflakeSchema = z
  .string()
  .trim()
  .regex(/^\d{17,20}$/, 'must be a Discord snowflake')
  // Non-digits are already reported by the pattern; BigInt would throw on them.
  .refine((id) => !/^\d+$/.test(id) || BigInt(id) <= SNOWFLAKE_MAX, {
    message: 'must be a Discord snowflake',
  });

export type Snowflake = z.infer<typeof SnowflakeSchema>;
