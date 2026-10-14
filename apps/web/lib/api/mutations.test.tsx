import { act, renderHook } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { ErrorCodeSchema } from '@sab/shared';
import { SUPPORTED_LOCALES, type SupportedLocale } from '@/lib/locale';
import { webMessages } from '@/lib/web-messages';
import { ApiRequestError } from './api-response';
import { useApiErrorMessage, useApiMutation } from './mutations';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('useApiMutation', () => {
  it('sends one request for a double submit and is pending until it settles', async () => {
    const gate = deferred<string>();
    const mutate = vi.fn(() => gate.promise);
    const { result } = renderHook(() => useApiMutation(mutate));

    let first!: ReturnType<typeof result.current.run>;
    let second!: ReturnType<typeof result.current.run>;
    act(() => {
      first = result.current.run(undefined);
      second = result.current.run(undefined);
    });
    expect(result.current.pending).toBe(true);
    await expect(second).resolves.toBeUndefined();

    await act(async () => {
      gate.resolve('done');
      await first;
    });
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(result.current.pending).toBe(false);
    await expect(first).resolves.toEqual({ ok: true, data: 'done' });
  });

  it('accepts a new submit once the previous one has settled', async () => {
    const mutate = vi.fn(() => Promise.resolve(1));
    const { result } = renderHook(() => useApiMutation(mutate));
    await act(() => result.current.run(undefined));
    await act(() => result.current.run(undefined));
    expect(mutate).toHaveBeenCalledTimes(2);
  });

  it('returns the error code of a failed request and clears it on the next run', async () => {
    const mutate = vi
      .fn<() => Promise<number>>()
      .mockRejectedValueOnce(new ApiRequestError(400, 'VALIDATION_FAILED'))
      .mockResolvedValueOnce(2);
    const { result } = renderHook(() => useApiMutation(mutate));

    const outcome = await act(() => result.current.run(undefined));
    expect(outcome).toMatchObject({ ok: false, error: { status: 400, code: 'VALIDATION_FAILED' } });
    expect(result.current.code).toBe('VALIDATION_FAILED');
    expect(result.current.pending).toBe(false);

    await act(() => result.current.run(undefined));
    expect(result.current.error).toBeUndefined();
  });

  it('reports a failure that never reached the server as an error without a code', async () => {
    const mutate = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
    const { result } = renderHook(() => useApiMutation(mutate));
    await act(() => result.current.run(undefined));
    expect(result.current.error).toBeInstanceOf(ApiRequestError);
    expect(result.current.code).toBeUndefined();
  });
});

function messageOf(locale: SupportedLocale, error: unknown): string {
  const { result } = renderHook(() => useApiErrorMessage(), {
    wrapper: ({ children }) => (
      <NextIntlClientProvider locale={locale} messages={webMessages(locale)}>
        {children}
      </NextIntlClientProvider>
    ),
  });
  return result.current(error);
}

describe.each(SUPPORTED_LOCALES)('useApiErrorMessage (%s)', (locale) => {
  it('has a translation of its own for every server error code', () => {
    const generic = messageOf(locale, new Error('boom'));
    for (const code of ErrorCodeSchema.options) {
      const text = messageOf(locale, new ApiRequestError(400, code));
      expect(text, code).not.toBe(generic);
      expect(text, code).not.toBe(code);
      expect(text, code).not.toContain('{');
    }
  });

  it('falls back to the generic sentence, never to the error text', () => {
    const generic = messageOf(locale, new Error('boom'));
    expect(generic).not.toBe('');
    expect(messageOf(locale, new ApiRequestError(500, 'SOMETHING_NEW'))).toBe(generic);
    expect(messageOf(locale, new ApiRequestError(503))).toBe(generic);
    expect(messageOf(locale, new Error('leaky internal detail'))).not.toContain('leaky');
    expect(messageOf(locale, new ApiRequestError(500, 'SOMETHING_NEW'))).not.toContain('HTTP');
  });
});
