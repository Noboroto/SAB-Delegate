import { ErrorCode } from '@sab/shared';
import { normalizeIP, type RateLimitPluginOptions } from '@fastify/rate-limit';
import type { FastifyRequest } from 'fastify';
import type { SessionService } from '../../auth/session.service.js';
import { errorBody } from '../errors/http-error.js';

/**
 * Ceilings per person (or per address, before sign-in) and route. Reads are
 * generous: one dashboard view renders on the server and fans out into several
 * calls, and Next's link prefetch renders more views the visitor never opens.
 * Anything that changes data keeps the tighter ceiling.
 */
export const READ_RATE_LIMIT_MAX = 600;
export const WRITE_RATE_LIMIT_MAX = 300;
const RATE_LIMIT_WINDOW = '1 minute';

const SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Sign-in routes keep the tight budget whatever the method: the OAuth callback
 * is a GET that creates a session.
 */
const AUTH_PATH = /^\/api\/auth(?:[/?]|$)/;

const RATE_LIMIT_WINDOW_MS = 60_000;
const REFUSAL_LOG_MAX_ENTRIES = 5000;

/**
 * Lets the first refusal of a key through per window and swallows the rest, so
 * a flood does not write one log line per request. Bounded: when full, expired
 * entries go first, then the oldest.
 */
export function createRefusalLogThrottle(
  now: () => number = Date.now,
  windowMs: number = RATE_LIMIT_WINDOW_MS,
  maxEntries: number = REFUSAL_LOG_MAX_ENTRIES,
): (key: string) => boolean {
  // Map iteration order is insertion order, so the first entry is the oldest.
  const seenAt = new Map<string, number>();
  return (key) => {
    const at = now();
    const last = seenAt.get(key);
    if (last !== undefined && at - last < windowMs) return false;
    seenAt.delete(key);
    if (seenAt.size >= maxEntries) {
      for (const [stale, staleAt] of seenAt) {
        if (at - staleAt < windowMs) break;
        seenAt.delete(stale);
      }
      const oldest = seenAt.keys().next();
      if (seenAt.size >= maxEntries && oldest.done !== true) seenAt.delete(oldest.value);
    }
    seenAt.set(key, at);
    return true;
  };
}

/**
 * Route-level override for `GET /api/guilds`, the server picker. The layout of
 * every server page asks for it, prefetched pages included. Discord is asked
 * at most once per `GUILD_ACCESS_ALLOW_TTL_MS` per person (the list is
 * remembered), so this bucket protects the server, not Discord.
 */
export const GUILD_LIST_RATE_LIMIT = { max: 120, timeWindow: RATE_LIMIT_WINDOW } as const;

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

/** What is written to the log when a request is refused: who (account or address) and which route, never the query string. */
interface RateLimitedDetails {
  method: string;
  route: string;
  key: string;
}

/** The argument of the `onLimited` callback of `rateLimitOptions`. */
export type RateLimitedEvent = Parameters<NonNullable<Parameters<typeof rateLimitOptions>[1]>>[0];

/**
 * The limiter answers from an `onRequest` hook, ahead of the HTTP logger's
 * middleware, so a refused request would leave no log line at all; `onLimited`
 * is how it still gets one.
 */
export function rateLimitOptions(
  sessions: Pick<SessionService, 'principalOf'>,
  onLimited: (event: RateLimitedDetails) => void = () => undefined,
): RateLimitPluginOptions {
  const shouldLog = createRefusalLogThrottle();
  return {
    global: true,
    max: (request) =>
      SAFE_METHODS.has(request.method) && !AUTH_PATH.test(request.url)
        ? READ_RATE_LIMIT_MAX
        : WRITE_RATE_LIMIT_MAX,
    timeWindow: RATE_LIMIT_WINDOW,
    onExceeded: (request, key) => {
      if (!shouldLog(key)) return;
      onLimited({ method: request.method, route: request.routeOptions.url ?? 'unmatched', key });
    },
    keyGenerator: rateLimitKey(sessions),
    // The container healthcheck and uptime probes must never be throttled.
    allowList: (request) => HEALTH_PATH.test(request.routeOptions.url ?? ''),
    errorResponseBuilder: () => ({ statusCode: 429, ...errorBody(ErrorCode.RATE_LIMITED) }),
  };
}
