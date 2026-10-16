import { SafePostError, safeRequest } from './safe-request.js';

type SafeFetchOptions = {
  timeoutMs: number;
  maxBytes: number;
  allowHosts?: readonly string[];
};

/** Set by the transport itself (or meaningless for a single pinned request). */
const DROPPED_HEADERS = new Set([
  'accept-encoding',
  'connection',
  'content-length',
  'host',
  'keep-alive',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

/**
 * A `fetch` for SDKs that call a user-supplied endpoint: every call goes
 * through `safeRequest`, so the SDK cannot reach the bot's own network or use
 * the global `fetch`. Only GET and POST with a text body are supported.
 */
export function makeSafeFetch(options: SafeFetchOptions): typeof fetch {
  return async (input, init) => {
    if (input instanceof Request) throw new SafePostError('blocked');
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = init?.body ?? undefined;
    if (
      (method !== 'GET' && method !== 'POST') ||
      (method === 'GET' && body !== undefined) ||
      (body !== undefined && typeof body !== 'string')
    ) {
      throw new SafePostError('blocked');
    }
    const result = await safeRequest({
      url: String(input),
      method,
      headers: {
        ...Object.fromEntries(
          [...new Headers(init?.headers).entries()].filter(([name]) => !DROPPED_HEADERS.has(name)),
        ),
        // The body is read raw and never decompressed.
        'accept-encoding': 'identity',
      },
      body,
      signal: init?.signal ?? undefined,
      ...options,
    });
    // `Response` rejects statuses outside 200-599, and a body on 204/205/304.
    if (result.status < 200 || result.status > 599) throw new SafePostError('bad_response');
    const headers = new Headers();
    for (const [name, value] of Object.entries(result.headers)) {
      for (const item of Array.isArray(value) ? value : [value]) {
        if (item !== undefined) headers.append(name, item);
      }
    }
    const empty = result.status === 204 || result.status === 205 || result.status === 304;
    return new Response(empty ? null : new Uint8Array(result.body), {
      status: result.status,
      headers,
    });
  };
}
