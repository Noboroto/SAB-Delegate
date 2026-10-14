import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError, apiFetch, loginUrl, setUnauthorizedHandler } from './api-fetch';

const parser = { parse: (input: unknown) => input as { ok: boolean } };

function respond(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status });
}

function stubFetch(response: Response) {
  const fetchMock = vi.fn(() => Promise.resolve(response));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('apiFetch', () => {
  const restore: Array<() => void> = [];
  afterEach(() => {
    for (const undo of restore.splice(0)) undo();
  });

  it('calls the same-origin path with the login cookie and parses the body', async () => {
    const fetchMock = stubFetch(respond(200, { ok: true }));
    await expect(apiFetch('/api/me', { parser })).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/me',
      expect.objectContaining({ method: 'GET', credentials: 'same-origin' }),
    );
  });

  it('sends a JSON body with a content type, and none for a body-less call', async () => {
    const fetchMock = stubFetch(respond(200, { ok: true }));
    await apiFetch('/api/x', { parser, method: 'POST', body: { a: 1 } });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/x',
      expect.objectContaining({
        body: '{"a":1}',
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });

  it('sends the visitor to the login page on 401 and still rejects the call', async () => {
    const handler = vi.fn();
    restore.push(setUnauthorizedHandler(handler));
    stubFetch(respond(401, { code: 'AUTH_UNAUTHENTICATED', message: 'x' }));
    await expect(apiFetch('/api/me', { parser })).rejects.toMatchObject({
      status: 401,
      code: 'AUTH_UNAUTHENTICATED',
    });
    expect(handler).toHaveBeenCalledOnce();
  });

  it('turns the uniform 404 into a guild-not-found error and does not log the person out', async () => {
    const handler = vi.fn();
    restore.push(setUnauthorizedHandler(handler));
    stubFetch(respond(404, { code: 'GUILD_NOT_FOUND', message: 'x' }));
    const error = await apiFetch('/api/guilds/1/settings', { parser }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect((error as ApiRequestError).isGuildNotFound).toBe(true);
    expect(handler).not.toHaveBeenCalled();
  });

  it('keeps only the status and code of a failure, never the server text', async () => {
    stubFetch(respond(500, { code: 'INTERNAL', message: 'relation "GuildConfig" does not exist' }));
    const error = (await apiFetch('/api/x', { parser }).catch(
      (e: unknown) => e,
    )) as ApiRequestError;
    expect(error.message).not.toContain('GuildConfig');
    expect(error.code).toBe('INTERNAL');
  });

  it('survives a failure whose body is not JSON', async () => {
    stubFetch(new Response('<html>bad gateway</html>', { status: 502 }));
    const error = (await apiFetch('/api/x', { parser }).catch(
      (e: unknown) => e,
    )) as ApiRequestError;
    expect(error).toMatchObject({ status: 502, code: undefined });
  });

  it('rejects a success body the parser refuses', async () => {
    stubFetch(respond(200, { nope: 1 }));
    const strict = {
      parse: (input: unknown) => {
        if (typeof input !== 'object' || input === null || !('ok' in input))
          throw new Error('shape');
        return input as { ok: boolean };
      },
    };
    await expect(apiFetch('/api/x', { parser: strict })).rejects.toThrow('shape');
  });

  it('hands 204 to the parser as null', async () => {
    stubFetch(new Response(null, { status: 204 }));
    await expect(apiFetch('/api/x', { parser: { parse: (input) => input } })).resolves.toBeNull();
  });
});

describe('loginUrl', () => {
  it('encodes where to come back to', () => {
    expect(loginUrl('/servers/1?tab=a&b=c')).toBe('/login?next=%2Fservers%2F1%3Ftab%3Da%26b%3Dc');
    expect(loginUrl(undefined)).toBe('/login');
  });
});
