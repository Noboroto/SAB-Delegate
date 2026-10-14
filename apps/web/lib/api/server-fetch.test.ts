import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const incoming = new Map<string, string>();
vi.mock('next/headers', () => ({
  headers: () => Promise.resolve({ get: (name: string) => incoming.get(name) ?? null }),
}));
// Next implements both by throwing; the same here, so the call stops as it would.
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
}));

import { serverFetch } from './server-fetch';

const parser = { parse: (input: unknown) => input as { id: string } };

describe('serverFetch', () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    incoming.clear();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    delete process.env['SERVER_INTERNAL_URL'];
  });

  it('goes to the server directly with the cookie and the address chain, verbatim', async () => {
    incoming.set('cookie', 'better-auth.session_token=abc; locale=vi');
    incoming.set('x-forwarded-for', '203.0.113.9, 10.0.0.2');
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: '1' })));

    await expect(serverFetch('/api/me', { parser })).resolves.toEqual({ id: '1' });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('http://sab-server:3100/api/me');
    expect(init?.headers).toEqual({
      cookie: 'better-auth.session_token=abc; locale=vi',
      'x-forwarded-for': '203.0.113.9, 10.0.0.2',
    });
    expect(init?.cache).toBe('no-store');
  });

  it('sends no forwarded headers when the visitor sent none', async () => {
    fetchMock.mockResolvedValue(new Response('{"id":"1"}'));
    await serverFetch('/api/me', { parser });
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual({});
  });

  it('honours the local-dev origin override', async () => {
    process.env['SERVER_INTERNAL_URL'] = 'http://localhost:3100';
    fetchMock.mockResolvedValue(new Response('{"id":"1"}'));
    await serverFetch('/api/me', { parser });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://localhost:3100/api/me');
  });

  it('redirects a signed-out visitor to the login page on 401', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ code: 'AUTH_UNAUTHENTICATED' }), { status: 401 }),
    );
    await expect(serverFetch('/api/me', { parser })).rejects.toThrow('REDIRECT:/login');
  });

  it('throws instead of redirecting when the caller is the login page', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 401 }));
    await expect(
      serverFetch('/api/me', { parser, onUnauthenticated: 'throw' }),
    ).rejects.toMatchObject({ name: 'ApiRequestError', status: 401 });
  });

  it('renders not-found for the uniform 404, whatever the real reason was', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ code: 'GUILD_NOT_FOUND' }), { status: 404 }),
    );
    await expect(serverFetch('/api/guilds/1/overview', { parser })).rejects.toThrow('NOT_FOUND');
  });

  it('throws a typed error for any other failure, so the error boundary shows its own text', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 500 }));
    await expect(serverFetch('/api/me', { parser })).rejects.toMatchObject({
      name: 'ApiRequestError',
      status: 500,
    });
  });

  it('reports an unreachable server as 503 without leaking the network error', async () => {
    fetchMock.mockRejectedValue(new TypeError('connect ECONNREFUSED 172.18.0.5:3100'));
    const error = (await serverFetch('/api/me', { parser }).catch((e: unknown) => e)) as Error;
    expect(error).toMatchObject({ name: 'ApiRequestError', status: 503 });
    expect(error.message).not.toContain('172.18');
  });
});
