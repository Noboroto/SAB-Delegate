import type { FastifyHelmetOptions } from '@fastify/helmet';
import type { FastifyServerOptions } from 'fastify';

// Nothing in the release-1 environment names a trusted proxy hop, so forwarded
// headers are not trusted and `request.ip` is the TCP peer. Trusting
// X-Forwarded-For without a hop count lets any client pick its own address.
// When REST is exposed behind the reverse proxy, the hop list becomes an
// environment variable and replaces this constant, in the same change that
// starts reading `request.ip`.
export const FASTIFY_OPTIONS = {
  trustProxy: false,
  // Request logging belongs to nestjs-pino; Fastify's own logger would emit a
  // second, unredacted line per request.
  logger: false,
  // Idle keep-alive sockets would otherwise hold a graceful shutdown open until
  // the orchestrator's kill timeout; 'idle' closes only those, so a request that
  // is still being answered finishes instead of being cut off.
  forceCloseConnections: 'idle',
} satisfies FastifyServerOptions;

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
