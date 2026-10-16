import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ safeRequest: vi.fn() }));
vi.mock('./safe-request.js', async (importOriginal) => ({
  ...(await importOriginal()),
  safeRequest: mocks.safeRequest,
}));

import { makeSafeFetch } from './safe-fetch.js';
import { SafePostError } from './safe-request.js';

const safeFetch = makeSafeFetch({ timeoutMs: 1000, maxBytes: 100, allowHosts: ['a.example'] });

beforeEach(() => {
  mocks.safeRequest.mockReset();
  mocks.safeRequest.mockResolvedValue({
    status: 200,
    headers: { 'content-type': 'application/json', 'set-cookie': ['a=1', 'b=2'] },
    body: Buffer.from('{"ok":true}'),
  });
});

describe('makeSafeFetch', () => {
  it('passes method, headers, body, signal and limits to safeRequest', async () => {
    const signal = new AbortController().signal;
    await safeFetch('https://a.example/v1/x', {
      method: 'POST',
      headers: { Authorization: 'Bearer k' },
      body: '{"a":1}',
      signal,
    });
    expect(mocks.safeRequest).toHaveBeenCalledWith({
      url: 'https://a.example/v1/x',
      method: 'POST',
      headers: { authorization: 'Bearer k', 'accept-encoding': 'identity' },
      body: '{"a":1}',
      signal,
      timeoutMs: 1000,
      maxBytes: 100,
      allowHosts: ['a.example'],
    });
  });

  it('drops hop-by-hop and encoding headers and forces identity encoding', async () => {
    await safeFetch('https://a.example/x', {
      method: 'POST',
      body: '{}',
      headers: {
        Host: 'evil.example',
        Connection: 'keep-alive',
        'Transfer-Encoding': 'chunked',
        'Content-Length': '999',
        'Accept-Encoding': 'gzip',
        'Content-Type': 'application/json',
      },
    });
    const call = mocks.safeRequest.mock.calls[0]?.[0] as { headers: Record<string, string> };
    expect(call.headers).toEqual({
      'content-type': 'application/json',
      'accept-encoding': 'identity',
    });
  });

  it('returns a Response with status, headers and body', async () => {
    const response = await safeFetch('https://a.example/x');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(response.headers.getSetCookie()).toEqual(['a=1', 'b=2']);
    expect(await response.json()).toEqual({ ok: true });
  });

  it('keeps an error status as a Response', async () => {
    mocks.safeRequest.mockResolvedValue({ status: 429, headers: {}, body: Buffer.from('slow') });
    expect((await safeFetch('https://a.example/x')).status).toBe(429);
  });

  it('supports a bodiless status', async () => {
    mocks.safeRequest.mockResolvedValue({ status: 204, headers: {}, body: Buffer.alloc(0) });
    expect((await safeFetch('https://a.example/x')).status).toBe(204);
  });

  it.each([
    ['a PUT', { method: 'PUT' }],
    ['a GET with a body', { method: 'GET', body: 'x' }],
    ['a non-string body', { method: 'POST', body: new Uint8Array(1) }],
  ])('refuses %s', async (_name, init) => {
    await expect(safeFetch('https://a.example/x', init)).rejects.toEqual(
      new SafePostError('blocked'),
    );
    expect(mocks.safeRequest).not.toHaveBeenCalled();
  });

  it('refuses a Request object', async () => {
    await expect(safeFetch(new Request('https://a.example/x'))).rejects.toEqual(
      new SafePostError('blocked'),
    );
  });

  it('rejects a status Response cannot represent', async () => {
    mocks.safeRequest.mockResolvedValue({ status: 0, headers: {}, body: Buffer.alloc(0) });
    await expect(safeFetch('https://a.example/x')).rejects.toEqual(
      new SafePostError('bad_response'),
    );
  });

  it('propagates transport errors', async () => {
    mocks.safeRequest.mockRejectedValue(new SafePostError('blocked'));
    await expect(safeFetch('https://a.example/x')).rejects.toEqual(new SafePostError('blocked'));
  });
});
