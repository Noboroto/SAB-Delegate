import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
import { securityHeaders } from './security-headers';
import { serverOrigin } from './server-origin';

const withNextIntl = createNextIntlPlugin('./app/i18n/request.ts');

const nextConfig: NextConfig = {
  output: 'standalone',
  // `next dev` would otherwise write AGENTS.md/CLAUDE.md here whenever it
  // detects a coding agent; a CLAUDE.md makes Claude Code ignore the repo's
  // own AGENTS.md.
  agentRules: false,
  // Link previews (Discord, Zalo, Messenger) read only <head>. By default Next
  // streams metadata into <body> unless the User-Agent is on its bot list;
  // matching every agent keeps the app from branching on User-Agent.
  htmlLimitedBots: /.*/,
  // No `x-powered-by`: it names the framework for nothing.
  poweredByHeader: false,
  experimental: {
    optimizePackageImports: ['antd', '@ant-design/icons'],
  },
  // One origin for the browser: `/api/*` (including Better Auth's
  // `/api/auth/*` and its Discord callback) reaches the Nest server through
  // this rewrite, so cookies are first-party and there is no CORS.
  rewrites: () =>
    Promise.resolve([{ source: '/api/:path*', destination: `${serverOrigin()}/api/:path*` }]),
  // Real 308s, not page stubs: a `redirect()` in a page answers 200 with an RSC
  // payload and crawlers stop at that shell. The app has no landing page: `/`
  // goes to the picker, which sends a signed-out visitor on to the login page.
  redirects: () =>
    Promise.resolve([
      { source: '/', destination: '/servers', permanent: true },
      { source: '/dashboard', destination: '/servers', permanent: true },
    ]),
  // Pages only: `/api/*` is the Nest server's, and it sets its own (closed)
  // policy on JSON answers.
  headers: () =>
    Promise.resolve([
      {
        source: '/((?!api/).*)',
        headers: securityHeaders(process.env['NODE_ENV'] === 'production'),
      },
    ]),
};

export default withNextIntl(nextConfig);
