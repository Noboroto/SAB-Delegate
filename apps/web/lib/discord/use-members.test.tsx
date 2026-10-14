import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MEMBER_SEARCH_DEBOUNCE_MS, useMembers } from './use-members';

const GUILD = '1'.repeat(18);
const member = { id: '4'.repeat(18), username: 'alice', displayName: 'Alice', bot: false };

function stubFetch() {
  const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify([member]))));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('useMembers', () => {
  it('asks nothing for an empty search', () => {
    const fetchMock = stubFetch();
    const { result } = renderHook(() => useMembers(GUILD, '   '));
    expect(result.current.loading).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('waits for a pause in typing, then asks once with the escaped text', async () => {
    vi.useFakeTimers();
    const fetchMock = stubFetch();
    const { result, rerender } = renderHook(({ query }) => useMembers(GUILD, query), {
      initialProps: { query: '' },
    });
    rerender({ query: 'a b&c' });
    expect(result.current.loading).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();

    await act(() => vi.advanceTimersByTimeAsync(MEMBER_SEARCH_DEBOUNCE_MS));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/guilds/${GUILD}/discord/members?q=${encodeURIComponent('a b&c')}`,
      expect.objectContaining({ method: 'GET' }),
    );
    vi.useRealTimers();
    await waitFor(() => expect(result.current.data).toEqual([member]));
    expect(result.current.loading).toBe(false);
  });
});
