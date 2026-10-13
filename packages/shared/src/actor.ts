import { z } from 'zod';
import { ActorSourceSchema } from './generated/zod/schemas/enums/ActorSource.schema.js';
import { SnowflakeSchema } from './schemas/snowflake.js';

export { ActorSourceSchema };

/**
 * Who is acting and through which door. Every service call takes one, so the
 * audit row names the person and the API key that actually did the work
 * rather than whichever key a transport happened to hold.
 *
 * `userId` is the Discord id of the person; only background work
 * (`SYSTEM`) has none.
 */
export const ActorContextSchema = z
  .object({
    source: ActorSourceSchema,
    userId: SnowflakeSchema.optional(),
    /** Set when the call came in with an API key (REST or MCP). */
    apiKeyId: z.uuid().optional(),
    ip: z.string().trim().max(64).optional(),
    ua: z.string().trim().max(512).optional(),
  })
  .refine((actor) => actor.source === 'SYSTEM' || actor.userId !== undefined, {
    message: 'userId is required unless the source is SYSTEM',
    path: ['userId'],
  });

export type ActorContext = z.infer<typeof ActorContextSchema>;
