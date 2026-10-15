/** @vitest-environment node */
// happy-dom's Request treats `cookie` as a forbidden header and drops it; the
// proxy runs on the server, where it is a normal header.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { config, proxy } from './proxy';

function request(path: string, cookie?: string): NextRequest {
  return new NextRequest(`https://bot.example.test${path}`, {
    headers: cookie === undefined ? {} : { cookie },
  });
}

describe('proxy', () => {
  it('sends a visitor with no login cookie from a protected page to the login page, remembering where they were', () => {
    const response = proxy(request('/servers/123?tab=logs'));
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get('location') ?? '');
    expect(location.pathname).toBe('/login');
    expect(location.searchParams.get('next')).toBe('/servers/123?tab=logs');
  });

  it('tells the page which path it renders, replacing what the browser claimed and dropping _rsc', () => {
    const response = proxy(
      new NextRequest('https://bot.example.test/servers/123/logs?page=2&_rsc=abc', {
        headers: { cookie: 'better-auth.session_token=x', 'x-current-path': '/evil' },
      }),
    );
    expect(response.headers.get('x-middleware-request-x-current-path')).toBe(
      '/servers/123/logs?page=2',
    );
  });

  it('lets any request that carries a Better Auth cookie through: the server decides, not the proxy', () => {
    for (const cookie of ['better-auth.session_token=x', '__Secure-better-auth.session_data=x']) {
      expect(proxy(request('/servers', `locale=vi; ${cookie}`)).status).toBe(200);
    }
  });

  it('does not treat an unrelated cookie as a login', () => {
    expect(proxy(request('/servers', 'theme=dark')).status).toBe(307);
  });

  it('never bounces a visitor away from the login page, so a stale cookie cannot loop', () => {
    const response = proxy(request('/login', 'better-auth.session_token=expired'));
    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
  });

  it('settles Vietnamese on a first visit and keeps a choice already made', () => {
    expect(proxy(request('/login')).cookies.get('locale')?.value).toBe('vi');
    expect(proxy(request('/login', 'locale=en')).cookies.get('locale')).toBeUndefined();
    expect(proxy(request('/login', 'locale=fr')).cookies.get('locale')?.value).toBe('vi');
  });

  it('ignores accept-language', () => {
    const response = proxy(
      new NextRequest('https://bot.example.test/login', {
        headers: { 'accept-language': 'en-US,en;q=0.9' },
      }),
    );
    expect(response.cookies.get('locale')?.value).toBe('vi');
  });

  it('does not run for the API, the MCP endpoint, static assets, scraper files or the health probe', () => {
    const matcher = new RegExp(`^${config.matcher[0]}$`);
    for (const path of [
      '/api/me',
      '/mcp',
      '/_next/static/a.js',
      '/_next/image',
      '/healthz',
      '/favicon.ico',
      '/icon.png',
      '/apple-icon.png',
      '/opengraph-image.png',
      '/robots.txt',
      '/brand/sab-logo.png',
    ]) {
      expect(matcher.test(path), path).toBe(false);
    }
    for (const path of ['/', '/login', '/servers/1']) expect(matcher.test(path), path).toBe(true);
  });

  it('uses the cookie prefix the server sets', () => {
    const serverSource = readFileSync(
      join(import.meta.dirname, '../server/src/auth/better-auth.ts'),
      'utf8',
    );
    const prefix = /export const AUTH_COOKIE_PREFIX = '([^']+)'/.exec(serverSource)?.[1];
    const proxySource = readFileSync(join(import.meta.dirname, 'proxy.ts'), 'utf8');
    expect(prefix).toBeDefined();
    expect(proxySource).toContain(`const AUTH_COOKIE_PREFIX = '${prefix ?? ''}'`);
  });
});
