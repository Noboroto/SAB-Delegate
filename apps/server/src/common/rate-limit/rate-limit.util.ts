import { ErrorCode } from '@sab/shared';
import { normalizeIP, type RateLimitPluginOptions } from '@fastify/rate-limit';
import type { FastifyRequest } from 'fastify';
import type { SessionService } from '../../auth/session.service.js';
import { errorBody } from '../errors/http-error.js';

/** Ceiling per person (or per address, before sign-in) and route. Generous: a page makes several calls. */
const RATE_LIMIT_DEFAULT = { max: 300, timeWindow: '1 minute' } as const;

/**
 * Route-level override for `GET /api/guilds`, the server picker. Each call
 * reaches Discord on the person's behalf, so the bucket is small.
 */
export const GUILD_LIST_RATE_LIMIT = { max: 10, timeWindow: '1 minute' } as const;

const HEALTH_PATH = /^\/health(\/|$)/;

/**
 * Who a request is counted against: the verified Discord account when the
 * cookie proves one, the client address otherwise. A forged cookie proves
 * nothing, so it falls to the address bucket and cannot be used to mint fresh
 * buckets. Server-side page renders forward the browser's cookie and
 * X-Forwarded-For, so they count against the person and not against the one
 * address of the web container.
 */
export function rateLimitKey(sessions: Pick<SessionService, 'principalOf'>) {
  return async (request: FastifyRequest): Promise<string> => {
    const principal = await sessions.principalOf(request);
    return principal === null ? `ip:${normalizeIP(request.ip)}` : `user:${principal.discordUserId}`;
  };
}

/** Options for `app.register(rateLimit, ...)`. */
export function rateLimitOptions(
  sessions: Pick<SessionService, 'principalOf'>,
): RateLimitPluginOptions {
  return {
    global: true,
    ...RATE_LIMIT_DEFAULT,
    keyGenerator: rateLimitKey(sessions),
    // The container healthcheck and uptime probes must never be throttled.
    allowList: (request) => HEALTH_PATH.test(request.routeOptions.url ?? ''),
    errorResponseBuilder: () => ({ statusCode: 429, ...errorBody(ErrorCode.RATE_LIMITED) }),
  };
}
