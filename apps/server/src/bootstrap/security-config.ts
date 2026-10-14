import type { FastifyHelmetOptions } from '@fastify/helmet';
import type { FastifyServerOptions } from 'fastify';

/**
 * Largest request body. Fastify's default (1 MiB) is the size of the biggest
 * birthday CSV on its own, and the JSON envelope plus escaping of quotes and
 * newlines adds to it: a file at the CSV limit would be cut off with a generic
 * 413 before the import could name the real reason (`CSV_TOO_LARGE`). 3 MiB
 * leaves that room and is still small for everything else the API accepts.
 */
export const REST_BODY_LIMIT_BYTES = 3 * 1024 * 1024;

// Forwarded headers are trusted only from the listed proxy hops: trusting
// X-Forwarded-For from anyone lets a client pick its own address, and trusting
// none behind a reverse proxy makes `request.ip` the proxy for every request.
// An empty list (bot-only release, local development) trusts nothing.
export function fastifyOptions(trustedProxies: readonly string[] = []) {
  return {
    trustProxy: trustedProxies.length > 0 ? [...trustedProxies] : false,
    // Request logging belongs to nestjs-pino; Fastify's own logger would emit a
    // second, unredacted line per request.
    logger: false,
    bodyLimit: REST_BODY_LIMIT_BYTES,
    // Idle keep-alive sockets would otherwise hold a graceful shutdown open until
    // the orchestrator's kill timeout; 'idle' closes only those, so a request that
    // is still being answered finishes instead of being cut off.
    forceCloseConnections: 'idle',
  } satisfies FastifyServerOptions;
}

// The server returns JSON and never markup, so the page-level policy is closed
// completely. `useDefaults: false` is what makes that true: with the default
// (true) helmet merges these directives INTO its own policy, which keeps
// `script-src 'self'`, `img-src 'self' data:` and the rest alongside
// `default-src 'none'`. `base-uri` and `form-action` do not fall back to
// `default-src`, so they are listed explicitly.
export const HELMET_OPTIONS = {
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'none'"],
      baseUri: ["'none'"],
      formAction: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
} satisfies FastifyHelmetOptions;
