import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { z } from '@sab/shared';
import { useLookup } from './use-lookup';

const Names = z.array(z.string());

function answer(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

describe('useLookup', () => {
  it('asks nothing for a null path', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useLookup(null, Names));
    expect(result.current).toMatchObject({ loading: false, data: undefined, error: undefined });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('loads and parses the answer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => answer(['a', 'b'])),
    );
    const { result } = renderHook(() => useLookup('/api/x', Names));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.data).toEqual(['a', 'b']));
    expect(result.current.loading).toBe(false);
  });

  it('turns an answer of the wrong shape into an error instead of data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => answer([1, 2])),
    );
    const { result } = renderHook(() => useLookup('/api/x', Names));
    await waitFor(() => expect(result.current.error).toBeDefined());
    expect(result.current.data).toBeUndefined();
  });

  it('reports the status and code of a refusal, and reload asks again', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => answer({ code: 'GUILD_BOT_MISSING', message: 'x' }, 404))
      .mockImplementationOnce(() => answer(['ok']));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useLookup('/api/x', Names));
    await waitFor(() =>
      expect(result.current.error).toMatchObject({ status: 404, code: 'GUILD_BOT_MISSING' }),
    );

    act(() => result.current.reload());
    await waitFor(() => expect(result.current.data).toEqual(['ok']));
    expect(result.current.error).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps the newest path when an older answer arrives late', async () => {
    const resolvers: Record<string, (response: Response) => void> = {};
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (path: string) =>
          new Promise<Response>((resolve) => {
            resolvers[path] = resolve;
          }),
      ),
    );
    const { result, rerender } = renderHook(({ path }) => useLookup(path, Names), {
      initialProps: { path: '/api/old' },
    });
    rerender({ path: '/api/new' });
    await waitFor(() => expect(resolvers['/api/new']).toBeDefined());
    resolvers['/api/new']?.(new Response(JSON.stringify(['new'])));
    await waitFor(() => expect(result.current.data).toEqual(['new']));
    resolvers['/api/old']?.(new Response(JSON.stringify(['old'])));
    await act(() => Promise.resolve());
    expect(result.current.data).toEqual(['new']);
  });
});
