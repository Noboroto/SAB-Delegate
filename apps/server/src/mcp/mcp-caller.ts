import { PrincipalSchema, z, type ActorContext } from '@sab/shared';

/**
 * Who a tool call acts for, resolved once per HTTP request and baked into the
 * closures of that request's server. A tool cannot act for anyone else because
 * nothing ambient (no AsyncLocalStorage, no request-scoped provider) holds a
 * second identity.
 */
export const McpCallerSchema = PrincipalSchema.extend({
  /** Taken from the request and stored in audit rows, so bounded here. */
  ip: z.string().trim().max(64),
  userAgent: z.string().trim().max(512).nullable(),
});

export type McpCaller = z.infer<typeof McpCallerSchema>;

/** The actor every service call from a tool receives: the person, the key and the MCP door. */
export function callerActor(caller: McpCaller): ActorContext {
  return {
    source: 'MCP',
    userId: caller.discordUserId,
    apiKeyId: caller.apiKeyId,
    ...(caller.ip !== '' && { ip: caller.ip }),
    ...(caller.userAgent !== null && caller.userAgent !== '' && { ua: caller.userAgent }),
  };
}
