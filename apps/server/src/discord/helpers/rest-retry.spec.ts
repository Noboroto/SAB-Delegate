import { describe, expect, it, vi } from 'vitest';
import { makeRetryingRequest } from './rest-retry.js';

const ok = { status: 200 } as Awaited<ReturnType<ReturnType<typeof makeRetryingRequest>>>;

function dnsError(code: string): Error {
  return Object.assign(new Error(`getaddrinfo ${code} discord.com`), { code });
}

describe('makeRetryingRequest', () => {
  it('repeats a call whose name did not resolve, then returns the answer', async () => {
    const base = vi.fn().mockRejectedValueOnce(dnsError('EAI_AGAIN')).mockResolvedValueOnce(ok);
    const request = makeRetryingRequest(base, [0, 0]);

    await expect(request('https://discord.com/api', { method: 'POST', body: '{}' })).resolves.toBe(
      ok,
    );
    expect(base).toHaveBeenCalledTimes(2);
  });

  it('repeats a refused connection', async () => {
    const base = vi.fn().mockRejectedValueOnce(dnsError('ECONNREFUSED')).mockResolvedValueOnce(ok);

    await expect(makeRetryingRequest(base, [0])('https://discord.com/api', {})).resolves.toBe(ok);
  });

  it('finds the code on a wrapped cause', async () => {
    const wrapped = new TypeError('fetch failed', { cause: dnsError('ENOTFOUND') });
    const base = vi.fn().mockRejectedValueOnce(wrapped).mockResolvedValueOnce(ok);

    await expect(makeRetryingRequest(base, [0])('https://discord.com/api', {})).resolves.toBe(ok);
  });

  it('gives up with the last error once the delays are used', async () => {
    const error = dnsError('EAI_AGAIN');
    const base = vi.fn().mockRejectedValue(error);

    await expect(makeRetryingRequest(base, [0, 0])('https://discord.com/api', {})).rejects.toBe(
      error,
    );
    expect(base).toHaveBeenCalledTimes(3);
  });

  it('never repeats a failure that may have reached Discord', async () => {
    const error = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
    const base = vi.fn().mockRejectedValue(error);

    await expect(makeRetryingRequest(base, [0])('https://discord.com/api', {})).rejects.toBe(error);
    expect(base).toHaveBeenCalledTimes(1);
  });

  it('never repeats a stream body, which the first attempt consumed', async () => {
    const base = vi.fn().mockRejectedValue(dnsError('EAI_AGAIN'));
    const body = new ReadableStream();

    await expect(
      makeRetryingRequest(base, [0])('https://discord.com/api', { method: 'POST', body }),
    ).rejects.toThrow('EAI_AGAIN');
    expect(base).toHaveBeenCalledTimes(1);
  });

  it('stops when the call was aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const base = vi.fn().mockRejectedValue(dnsError('EAI_AGAIN'));

    await expect(
      makeRetryingRequest(base, [0])('https://discord.com/api', { signal: controller.signal }),
    ).rejects.toThrow('EAI_AGAIN');
    expect(base).toHaveBeenCalledTimes(1);
  });

  it('ends the wait on abort and rethrows the abort, not the DNS error', async () => {
    const controller = new AbortController();
    const base = vi.fn().mockImplementation(() => {
      setTimeout(() => controller.abort(), 5);
      return Promise.reject(dnsError('EAI_AGAIN'));
    });

    await expect(
      makeRetryingRequest(base, [60_000])('https://discord.com/api', { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(base).toHaveBeenCalledTimes(1);
  });
});
