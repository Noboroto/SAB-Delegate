import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { ErrorCode, SnowflakeSchema, z } from '@sab/shared';
import type { FastifyRequest } from 'fastify';
import { ApiError } from '../common/errors/http-error.js';

/**
 * Who is calling, as far as the session proves it: the Discord account. Nothing
 * else from the session leaves the auth module (the raw session carries its
 * token, IP and user agent).
 */
export const SessionPrincipalSchema = z.object({
  discordUserId: SnowflakeSchema,
});

export type SessionPrincipal = z.infer<typeof SessionPrincipalSchema>;

/** A request after a guard resolved its principal. */
export type PrincipalRequest = FastifyRequest & { principal?: SessionPrincipal };

/** The caller of a route behind `SessionGuard`; absent means the route forgot its guard, which is a 401, not a crash. */
export const Principal = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const { principal } = context.switchToHttp().getRequest<PrincipalRequest>();
  if (principal === undefined) throw new ApiError(ErrorCode.AUTH_UNAUTHENTICATED);
  return principal;
});
