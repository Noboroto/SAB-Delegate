import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { CURRENT_PATH_HEADER, loginPathFor } from '@/lib/auth/safe-next';
import { serverOrigin } from '@/server-origin';
import {
  ApiRequestError,
  parseApiResponse,
  toApiRequestError,
  type ResponseParser,
} from './api-response';

/** A render waiting longer than this on the server is stuck, not slow. */
const SERVER_FETCH_TIMEOUT_MS = 10_000;

/** Headers the server needs to know who is asking and from where. */
async function forwardedHeaders(): Promise<Record<string, string>> {
  const incoming = await headers();
  const forwarded: Record<string, string> = {};
  const cookie = incoming.get('cookie');
  if (cookie !== null) forwarded['cookie'] = cookie;
  // Verbatim: the server's rate limit and Better Auth's trusted-proxy handling
  // read the client address from this chain.
  const chain = incoming.get('x-forwarded-for');
  if (chain !== null) forwarded['x-forwarded-for'] = chain;
  return forwarded;
}

interface ServerFetchOptions<T> {
  parser: ResponseParser<T>;
  /**
   * What a 401 does. `redirect` (default) sends the visitor to the login page;
   * `throw` is for the login page itself, which must not redirect to itself.
   */
  onUnauthenticated?: 'redirect' | 'throw';
}

/**
 * Server-component call that goes straight to the Nest server (no rewrite hop)
 * with the visitor's cookie and address chain.
 *
 * - 401: the visitor is signed out, so redirect to the login page with the
 *   current page as `next` (unless `onUnauthenticated: 'throw'`).
 * - 404 `GUILD_NOT_FOUND`: render the nearest `not-found.tsx`; the server gives
 *   the same answer for an unknown server, a missing bot and a missing
 *   permission, and so does this.
 * - anything else (including an unreachable server) throws `ApiRequestError`
 *   to the route's `error.tsx`, which shows a translated message, never the text.
 */
export async function serverFetch<T>(path: string, options: ServerFetchOptions<T>): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${serverOrigin()}${path}`, {
      headers: await forwardedHeaders(),
      cache: 'no-store',
      signal: AbortSignal.timeout(SERVER_FETCH_TIMEOUT_MS),
    });
  } catch {
    throw new ApiRequestError(503);
  }
  if (!res.ok) {
    const error = await toApiRequestError(res);
    if (error.isUnauthenticated && options.onUnauthenticated !== 'throw') {
      redirect(loginPathFor((await headers()).get(CURRENT_PATH_HEADER)));
    }
    if (error.isGuildNotFound) notFound();
    throw error;
  }
  return parseApiResponse(res, options.parser);
}
