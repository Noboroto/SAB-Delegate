import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  lookup: vi.fn(),
  request: vi.fn(),
}));
vi.mock('node:dns/promises', () => ({ lookup: mocks.lookup }));
vi.mock('node:https', () => ({ request: mocks.request }));

import { SafePostError, safeRequest } from './safe-request.js';

type Reply = {
  status: number;
  headers?: Record<string, string>;
  chunks: Buffer[];
  /** Emitted on the response once the request is destroyed, before the request's own error. */
  resErrorOnDestroy?: boolean;
};

/** Stands in for `https.request`: answers once the request body is ended. */
function fakeServer(reply: Reply) {
  mocks.request.mockImplementation(
    (_url: URL, _options: unknown, onResponse: (res: EventEmitter) => void) => {
      let destroyed = false;
      const res = Object.assign(new EventEmitter(), {
        statusCode: reply.status,
        headers: reply.headers ?? {},
      });
      const req = Object.assign(new EventEmitter(), {
        destroy: vi.fn((error?: Error) => {
          destroyed = true;
          if (reply.resErrorOnDestroy === true) res.emit('error', new Error('aborted'));
          if (error !== undefined) req.emit('error', error);
          req.emit('close');
        }),
        end: vi.fn(() => {
          onResponse(res);
          for (const chunk of reply.chunks) res.emit('data', chunk);
          if (!destroyed) res.emit('end');
          req.emit('close');
        }),
      });
      return req;
    },
  );
}

const base = { timeoutMs: 1000, maxBytes: 10 } as const;

beforeEach(() => {
  mocks.lookup.mockReset();
  mocks.request.mockReset();
  mocks.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
});

describe('safeRequest', () => {
  it('refuses a host outside allowHosts before resolving it', async () => {
    await expect(
      safeRequest({
        ...base,
        url: 'https://evil.example/a.png',
        method: 'GET',
        allowHosts: ['cdn.discordapp.com'],
      }),
    ).rejects.toEqual(new SafePostError('blocked'));
    expect(mocks.lookup).not.toHaveBeenCalled();
  });

  it.each(['http://example.com/', 'https://u:p@example.com/', 'https://127.0.0.1/', 'nonsense'])(
    'refuses %s without connecting',
    async (url) => {
      await expect(safeRequest({ ...base, url, method: 'GET' })).rejects.toEqual(
        new SafePostError('blocked'),
      );
      expect(mocks.request).not.toHaveBeenCalled();
    },
  );

  it('refuses a name that resolves to a blocked address', async () => {
    mocks.lookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.5', family: 4 },
    ]);
    await expect(
      safeRequest({ ...base, url: 'https://example.com/', method: 'GET' }),
    ).rejects.toEqual(new SafePostError('blocked'));
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('GETs an allowed host and returns status, headers and body', async () => {
    fakeServer({
      status: 200,
      headers: { 'content-type': 'image/png' },
      chunks: [Buffer.from('abc')],
    });
    const response = await safeRequest({
      ...base,
      url: 'https://cdn.discordapp.com/a.png',
      method: 'GET',
      allowHosts: ['cdn.discordapp.com'],
    });
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('image/png');
    expect(response.body.toString()).toBe('abc');
    const options = mocks.request.mock.calls[0]?.[1] as { method: string; headers: object };
    expect(options.method).toBe('GET');
    expect(options.headers).not.toHaveProperty('content-length');
  });

  it('sends the body with its byte length', async () => {
    fakeServer({ status: 200, chunks: [] });
    await safeRequest({ ...base, url: 'https://example.com/', method: 'POST', body: 'é' });
    const options = mocks.request.mock.calls[0]?.[1] as { headers: Record<string, number> };
    expect(options.headers['content-length']).toBe(2);
  });

  it('does not follow a redirect', async () => {
    fakeServer({ status: 302, headers: { location: 'https://10.0.0.1/' }, chunks: [] });
    const response = await safeRequest({ ...base, url: 'https://example.com/', method: 'GET' });
    expect(response.status).toBe(302);
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });

  it('fails when the body passes the cap', async () => {
    fakeServer({ status: 200, chunks: [Buffer.alloc(11)] });
    await expect(
      safeRequest({ ...base, url: 'https://example.com/', method: 'GET' }),
    ).rejects.toEqual(new SafePostError('too_large'));
  });

  it('keeps too_large when the response errors as the socket is torn down', async () => {
    fakeServer({
      status: 200,
      chunks: [Buffer.alloc(11), Buffer.alloc(5)],
      resErrorOnDestroy: true,
    });
    await expect(
      safeRequest({ ...base, url: 'https://example.com/', method: 'GET' }),
    ).rejects.toEqual(new SafePostError('too_large'));
  });

  it('connects only to the checked address and verifies the certificate for the host', async () => {
    fakeServer({ status: 200, chunks: [] });
    mocks.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    await safeRequest({ ...base, url: 'https://example.com/', method: 'GET' });
    const options = mocks.request.mock.calls[0]?.[1] as {
      lookup: (host: string, options: object, callback: (...args: unknown[]) => void) => void;
      servername: string;
      timeout: number;
    };
    expect(options.servername).toBe('example.com');
    expect(options.timeout).toBe(1000);

    const all = vi.fn();
    options.lookup('example.com', { all: true }, all);
    expect(all).toHaveBeenCalledWith(null, [{ address: '93.184.216.34', family: 4 }]);
    const single = vi.fn();
    options.lookup('rebound.example', {}, single);
    expect(single).toHaveBeenCalledWith(null, '93.184.216.34', 4);
    expect(mocks.lookup).toHaveBeenCalledTimes(1);
  });

  it('sends no servername for an IP literal', async () => {
    fakeServer({ status: 200, chunks: [] });
    await safeRequest({ ...base, url: 'https://93.184.216.34/', method: 'GET' });
    const options = mocks.request.mock.calls[0]?.[1] as { servername: unknown };
    expect(options.servername).toBeUndefined();
    expect(mocks.lookup).not.toHaveBeenCalled();
  });

  it('rejects promptly when the signal aborts during DNS', async () => {
    mocks.lookup.mockReturnValue(new Promise(() => undefined));
    const controller = new AbortController();
    const pending = safeRequest({
      ...base,
      url: 'https://example.com/',
      method: 'GET',
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toEqual(new SafePostError('unreachable'));
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('rejects when the deadline passes during DNS', async () => {
    mocks.lookup.mockReturnValue(new Promise(() => undefined));
    await expect(
      safeRequest({ url: 'https://example.com/', method: 'GET', timeoutMs: 20, maxBytes: 10 }),
    ).rejects.toEqual(new SafePostError('unreachable'));
  });

  it('fails without connecting when the signal is already aborted', async () => {
    await expect(
      safeRequest({
        ...base,
        url: 'https://example.com/',
        method: 'GET',
        signal: AbortSignal.abort(),
      }),
    ).rejects.toEqual(new SafePostError('unreachable'));
    expect(mocks.request).not.toHaveBeenCalled();
  });
});
