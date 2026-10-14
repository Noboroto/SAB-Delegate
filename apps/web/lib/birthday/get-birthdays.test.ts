import { beforeEach, describe, expect, it, vi } from 'vitest';

const serverFetch = vi.hoisted(() => vi.fn<(path: string) => Promise<unknown>>());
vi.mock('@/lib/api/server-fetch', () => ({ serverFetch }));

import { getBirthdays, parseMonthParam } from './get-birthdays';

beforeEach(() => serverFetch.mockReset());

describe('parseMonthParam', () => {
  it.each([
    ['3', 3],
    ['12', 12],
    ['0', undefined],
    ['13', undefined],
    ['abc', undefined],
    ['', undefined],
    [undefined, undefined],
    [['1', '2'], undefined],
  ])('reads %j as %j', (raw, expected) => {
    expect(parseMonthParam(raw)).toBe(expected);
  });
});

const GUILD = '1'.repeat(18);

describe('getBirthdays', () => {
  it('leaves the month filter to the server', async () => {
    serverFetch.mockResolvedValue([]);
    await getBirthdays(GUILD, 3);
    await getBirthdays(GUILD, undefined);
    expect(serverFetch.mock.calls.map(([path]) => path)).toEqual([
      `/api/guilds/${GUILD}/birthdays?month=3`,
      `/api/guilds/${GUILD}/birthdays`,
    ]);
  });
});
