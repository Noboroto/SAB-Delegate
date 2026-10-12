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
  // Keep-alive sockets would otherwise hold a graceful shutdown open until the
  // orchestrator's kill timeout.
  forceCloseConnections: true,
} satisfies FastifyServerOptions;

// The server returns JSON and never markup, so the page-level policy can be
// closed completely instead of inheriting helmet's default allowances.
export const HELMET_OPTIONS = {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
} satisfies FastifyHelmetOptions;
