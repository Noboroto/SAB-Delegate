import { z } from 'zod';
import { ApiKeyModeSchema } from '../generated/zod/schemas/enums/ApiKeyMode.schema.js';
import { SnowflakeSchema } from '../schemas/snowflake.js';

/**
 * Who is calling through an API key: the person who owns it, the key itself
 * and whether it may change anything. Carries no secret, so it is safe to log
 * and to pass to every service call.
 */
export const PrincipalSchema = z.object({
  discordUserId: SnowflakeSchema,
  apiKeyId: z.uuid(),
  mode: ApiKeyModeSchema,
});

export type Principal = z.infer<typeof PrincipalSchema>;
