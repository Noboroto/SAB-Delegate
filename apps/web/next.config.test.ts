import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

  it('answers the root and moved pages with a real 308', async () => {
    const redirects = await nextConfig.redirects?.();
    expect(redirects).toEqual([
      { source: '/', destination: '/servers', permanent: true },
      { source: '/dashboard', destination: '/servers', permanent: true },
    ]);
  });

  describe('security headers (production build)', () => {
    beforeEach(() => {
      vi.stubEnv('NODE_ENV', 'production');
    });
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    const headerMap = async (): Promise<Map<string, string>> => {
      const rules = (await nextConfig.headers?.()) ?? [];
      expect(rules).toHaveLength(1);
      return new Map((rules[0]?.headers ?? []).map(({ key, value }) => [key, value]));
    };

    it('applies to pages and leaves /api to the server, which sets its own policy', async () => {
      const rules = (await nextConfig.headers?.()) ?? [];
      const source = new RegExp(`^${rules[0]?.source ?? ''}$`);
      expect(source.test('/servers/1')).toBe(true);
      expect(source.test('/login')).toBe(true);
      expect(source.test('/api/auth/get-session')).toBe(false);
    });

    it('forbids framing, sniffing and leaking the full referrer', async () => {
      const headers = await headerMap();
      expect(headers.get('X-Frame-Options')).toBe('DENY');
      expect(headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
      expect(headers.get('Permissions-Policy')).toContain('camera=()');
      expect(headers.get('Strict-Transport-Security')).toBe('max-age=31536000');
    });

    it('closes framing, plugins and foreign form targets in the policy', async () => {
      const csp = (await headerMap()).get('Content-Security-Policy') ?? '';
      const directives = new Map(
        csp.split('; ').map((part) => [part.split(' ')[0] ?? '', part] as const),
      );
      expect(directives.get('frame-ancestors')).toBe("frame-ancestors 'none'");
      expect(directives.get('object-src')).toBe("object-src 'none'");
      expect(directives.get('base-uri')).toBe("base-uri 'self'");
      expect(directives.get('form-action')).toBe("form-action 'self'");
      expect(directives.get('default-src')).toBe("default-src 'self'");
      // Hydration data is inline; without this directive no page would start.
      expect(directives.get('script-src')).toContain("'unsafe-inline'");
      expect(directives.get('script-src')).not.toContain("'unsafe-eval'");
      expect(directives.get('img-src')).toContain('https://cdn.discordapp.com');
    });
  });

  it('builds a standalone server and writes no agent rule files', () => {
    expect(nextConfig.output).toBe('standalone');
    expect(nextConfig.agentRules).toBe(false);
  });
});
