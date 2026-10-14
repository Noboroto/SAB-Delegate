import { describe, expect, it } from 'vitest';
import nextConfig from './next.config';
import { DEFAULT_SERVER_ORIGIN, serverOrigin } from './server-origin';

describe('next.config', () => {
  it('proxies /api/* (Better Auth included) to the server so the browser has one origin', async () => {
    const rewrites = await nextConfig.rewrites?.();
    expect(rewrites).toEqual([
      { source: '/api/:path*', destination: `${serverOrigin()}/api/:path*` },
    ]);
  });

  it('points at the compose alias unless local dev overrides it', () => {
    expect(DEFAULT_SERVER_ORIGIN).toBe('http://sab-server:3100');
  });

  it('answers moved pages with a real 308', async () => {
    const redirects = await nextConfig.redirects?.();
    expect(redirects).toEqual([{ source: '/dashboard', destination: '/servers', permanent: true }]);
  });

  it('builds a standalone server and writes no agent rule files', () => {
    expect(nextConfig.output).toBe('standalone');
    expect(nextConfig.agentRules).toBe(false);
  });
});
