import { ErrorCode } from '@sab/shared';
import { DiscordAPIError } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { ServiceError } from '../errors/service-error.js';
import { fetchManageableGuilds, type UserGuildsRest } from './user-guilds.client.js';

const ADMINISTRATOR = String(1n << 3n);
const MANAGE_GUILD = String(1n << 5n);
const SEND_MESSAGES = String(1n << 11n);

const snowflake = (n: number): string => String(300_000_000_000_000_000n + BigInt(n));
type Entry = { id: string; name: string; icon: string | null; owner: boolean; permissions: string };
const entry = (n: number, overrides: Partial<Entry> = {}): Entry => ({
  id: snowflake(n),
  name: `server ${String(n)}`,
  icon: null,
  owner: false,
  permissions: SEND_MESSAGES,
  ...overrides,
});

function restReturning(...pages: unknown[]) {
  const get = vi.fn();
  for (const page of pages) get.mockResolvedValueOnce(page);
  return { get, rest: { get } as unknown as UserGuildsRest };
}

function apiError(status: number): DiscordAPIError {
  return new DiscordAPIError({ message: 'x', code: 0 }, 0, status, 'GET', '/users/@me/guilds', {});
}

describe('fetchManageableGuilds', () => {
  it('keeps Manage Server, Administrator and owned servers, and nothing else', async () => {
    const { rest } = restReturning([
      entry(1, { permissions: MANAGE_GUILD }),
      entry(2, { permissions: ADMINISTRATOR }),
      entry(3, { owner: true, permissions: '0' }),
      entry(4),
    ]);
    const guilds = await fetchManageableGuilds(rest);
    expect(guilds.map((guild) => guild.id)).toEqual([snowflake(1), snowflake(2), snowflake(3)]);
  });

  it('returns only the fields the picker shows', async () => {
    const { rest } = restReturning([
      {
        ...entry(1, { permissions: MANAGE_GUILD, icon: 'abc' }),
        features: ['COMMUNITY'],
        approximate_member_count: 9,
      },
    ]);
    expect(await fetchManageableGuilds(rest)).toEqual([
      { id: snowflake(1), name: 'server 1', icon: 'abc' },
    ]);
  });

  it('follows pages with the last id until a short page', async () => {
    const full = Array.from({ length: 200 }, (_, i) => entry(i + 1, { permissions: MANAGE_GUILD }));
    const { rest, get } = restReturning(full, [entry(500, { permissions: MANAGE_GUILD })]);
    const guilds = await fetchManageableGuilds(rest);
    expect(guilds).toHaveLength(201);
    expect(get).toHaveBeenCalledTimes(2);
    const second = get.mock.calls[1]?.[1] as { query: URLSearchParams };
    expect(second.query.get('after')).toBe(snowflake(200));
    expect(second.query.get('limit')).toBe('200');
  });

  it('stops after five pages however many the person has', async () => {
    const full = Array.from({ length: 200 }, (_, i) => entry(i + 1));
    const get = vi.fn().mockResolvedValue(full);
    await fetchManageableGuilds({ get });
    expect(get).toHaveBeenCalledTimes(5);
  });

  it('asks the person to sign in again when Discord rejects the token', async () => {
    const get = vi.fn().mockRejectedValue(apiError(401));
    const error = await fetchManageableGuilds({ get }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServiceError);
    expect((error as ServiceError).code).toBe(ErrorCode.AUTH_REAUTH_REQUIRED);
  });

  it('lets other upstream failures through unchanged for the HTTP filter', async () => {
    const failure = apiError(500);
    const get = vi.fn().mockRejectedValue(failure);
    await expect(fetchManageableGuilds({ get })).rejects.toBe(failure);
  });

  it('treats a reply that is not a server list as a Discord error', async () => {
    for (const reply of [{ message: 'nope' }, [{ id: 'x' }], 'html']) {
      const { rest } = restReturning(reply);
      const error = await fetchManageableGuilds(rest).catch((e: unknown) => e);
      expect((error as ServiceError).code, JSON.stringify(reply)).toBe(ErrorCode.DISCORD_API_ERROR);
    }
  });
});
