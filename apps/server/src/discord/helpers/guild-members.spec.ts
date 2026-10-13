import type { Guild } from 'discord.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchGuildMembers, GUILD_MEMBERS_TTL_MS } from './guild-members.js';

function guildWith(fetch: ReturnType<typeof vi.fn>): Pick<Guild, 'members'> {
  return { members: { fetch } } as unknown as Pick<Guild, 'members'>;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('fetchGuildMembers', () => {
  it('shares one fetch between callers that ask while it is in flight', async () => {
    let finish: (value: string) => void = () => undefined;
    const fetch = vi.fn(() => new Promise((resolve) => (finish = resolve)));
    const guild = guildWith(fetch);

    const first = fetchGuildMembers(guild);
    const second = fetchGuildMembers(guild);
    finish('members');

    await expect(first).resolves.toBe('members');
    await expect(second).resolves.toBe('members');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('reuses a finished list until the time to live has passed', async () => {
    const fetch = vi.fn().mockResolvedValueOnce('old').mockResolvedValueOnce('new');
    const guild = guildWith(fetch);

    await expect(fetchGuildMembers(guild)).resolves.toBe('old');
    vi.advanceTimersByTime(GUILD_MEMBERS_TTL_MS - 1);
    await expect(fetchGuildMembers(guild)).resolves.toBe('old');
    expect(fetch).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    await expect(fetchGuildMembers(guild)).resolves.toBe('new');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not remember a failed fetch', async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new Error('rate limited')).mockResolvedValue('ok');
    const guild = guildWith(fetch);

    await expect(fetchGuildMembers(guild)).rejects.toThrow('rate limited');
    await expect(fetchGuildMembers(guild)).resolves.toBe('ok');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('keeps one server’s members apart from another’s', async () => {
    const one = guildWith(vi.fn().mockResolvedValue('one'));
    const two = guildWith(vi.fn().mockResolvedValue('two'));

    await expect(fetchGuildMembers(one)).resolves.toBe('one');
    await expect(fetchGuildMembers(two)).resolves.toBe('two');
  });
});
