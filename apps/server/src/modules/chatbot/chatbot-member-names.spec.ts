import { describe, expect, it, vi } from 'vitest';
import { lookupDisplayNames } from './chatbot-member-names.js';

function directory(cached: Record<string, string>, fetched: Record<string, string> | Error) {
  const fetch = vi.fn((options: { user: string[]; time: number }) => {
    void options;
    if (fetched instanceof Error) return Promise.reject(fetched);
    return Promise.resolve({
      values: () => Object.entries(fetched).map(([id, displayName]) => ({ id, displayName })),
    });
  });
  const members = {
    cache: { get: (id: string) => (id in cached ? { displayName: cached[id] ?? '' } : undefined) },
    fetch,
  };
  return { members, fetch };
}

describe('lookupDisplayNames', () => {
  it('asks Discord once, only for the members the cache does not know', async () => {
    const { members, fetch } = directory({ a: 'An' }, { b: 'Binh' });
    const names = await lookupDisplayNames(members, ['a', 'b', 'c'], vi.fn());
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0].user).toEqual(['b', 'c']);
    expect(names).toEqual(
      new Map([
        ['a', 'An'],
        ['b', 'Binh'],
      ]),
    );
  });

  it('does not call Discord when everyone is cached', async () => {
    const { members, fetch } = directory({ a: 'An' }, {});
    expect(await lookupDisplayNames(members, ['a'], vi.fn())).toEqual(new Map([['a', 'An']]));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps what the cache knew and reports a failed lookup instead of throwing', async () => {
    const failure = new Error('unreachable');
    const { members } = directory({ a: 'An' }, failure);
    const onFailure = vi.fn();
    const names = await lookupDisplayNames(members, ['a', 'b'], onFailure);
    expect(names).toEqual(new Map([['a', 'An']]));
    expect(onFailure).toHaveBeenCalledWith(failure);
  });

  it('bounds the one request by the timeout it is given, five seconds by default', async () => {
    const { members, fetch } = directory({}, {});
    await lookupDisplayNames(members, ['a'], vi.fn(), 2_000);
    await lookupDisplayNames(members, ['a'], vi.fn());
    expect(fetch.mock.calls.map(([options]) => options.time)).toEqual([2_000, 5_000]);
  });
});
