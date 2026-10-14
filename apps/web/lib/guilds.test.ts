import { describe, expect, it, vi } from 'vitest';

const fetchGuilds = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api/server-fetch', () => ({ serverFetch: fetchGuilds }));

import { GUILD_SECTIONS, isGuildSection } from './guild-sections';
import { getGuilds } from './guilds';

describe('getGuilds', () => {
  it('reads the picker list from the server and parses it with the shared schema', async () => {
    fetchGuilds.mockImplementation(
      (_path: string, { parser }: { parser: { parse(x: unknown): unknown } }) =>
        Promise.resolve(parser.parse([{ id: '1'.repeat(18), name: 'A', icon: null, extra: 1 }])),
    );
    await expect(getGuilds()).resolves.toEqual([{ id: '1'.repeat(18), name: 'A', icon: null }]);
    expect(fetchGuilds.mock.calls[0]?.[0]).toBe('/api/guilds');
  });
});

describe('isGuildSection', () => {
  it('accepts exactly the sections the navigation links to', () => {
    for (const section of GUILD_SECTIONS) expect(isGuildSection(section)).toBe(true);
    for (const other of ['', 'admin', '..', 'Logs']) expect(isGuildSection(other)).toBe(false);
  });
});
