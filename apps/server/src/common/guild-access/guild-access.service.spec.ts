import 'reflect-metadata';
import type { Client } from 'discord.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GUILD_ACCESS_ALLOW_TTL_MS,
  GUILD_ACCESS_CACHE_MAX,
  GUILD_ACCESS_DENY_TTL_MS,
  GuildAccessService,
  GuildNotFoundError,
} from './guild-access.service.js';

const GUILD = '100000000000000001';
const OWNER = '200000000000000001';
const USER = '200000000000000002';
const MANAGE_GUILD = 1n << 5n;
const SEND_MESSAGES = 1n << 11n;

class DiscordApiError extends Error {
  constructor(readonly code: number) {
    super(`Discord error ${String(code)}`);
  }
}

type Setup = { bits?: bigint; inGuild?: boolean };

function setup({ bits = MANAGE_GUILD, inGuild = true }: Setup = {}) {
  const state = { bits, failWith: undefined as Error | undefined };
  const fetch = vi.fn((_options: { user: string; force: boolean }) => {
    if (state.failWith !== undefined) return Promise.reject(state.failWith);
    return Promise.resolve({ permissions: { bitfield: state.bits } });
  });
  const guild = { ownerId: OWNER, members: { fetch } };
  const client = {
    guilds: { cache: new Map(inGuild ? [[GUILD, guild]] : []) },
  } as unknown as Client;
  return { service: new GuildAccessService(client), fetch, state, client, guild };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['performance', 'Date', 'setTimeout', 'clearTimeout'] });
  // lru-cache reads an entry stamped 0 as "no expiry"; a faked clock starts at 0, a real one never does.
  vi.advanceTimersByTime(1);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('GuildAccessService.canManage', () => {
  it('allows Manage Server and refuses a member without it', async () => {
    expect(await setup({ bits: MANAGE_GUILD }).service.canManage(USER, GUILD)).toBe(true);
    expect(await setup({ bits: SEND_MESSAGES }).service.canManage(USER, GUILD)).toBe(false);
  });

  it('allows the owner without asking Discord for permission bits to matter', async () => {
    const { service } = setup({ bits: 0n });
    expect(await service.canManage(OWNER, GUILD)).toBe(true);
  });

  it('reads the member from the API, not the member cache', async () => {
    const { service, fetch } = setup();
    await service.canManage(USER, GUILD);
    expect(fetch).toHaveBeenCalledWith({ user: USER, force: true });
  });

  it('answers from the cache within the TTL and asks again after it', async () => {
    const { service, fetch, state } = setup();
    expect(await service.canManage(USER, GUILD)).toBe(true);
    state.bits = SEND_MESSAGES;

    vi.advanceTimersByTime(GUILD_ACCESS_ALLOW_TTL_MS - 1);
    expect(await service.canManage(USER, GUILD)).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2);
    expect(await service.canManage(USER, GUILD)).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('fresh bypasses a cached allow so a revoked right stops a write at once', async () => {
    const { service, fetch, state } = setup();
    await service.canManage(USER, GUILD);
    state.bits = SEND_MESSAGES;
    expect(await service.canManage(USER, GUILD, { fresh: true })).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(2);
    // The fresh answer replaces the stale allow for readers too.
    expect(await service.canManage(USER, GUILD)).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('remembers a refusal briefly, then asks again', async () => {
    const { service, fetch, state } = setup({ bits: SEND_MESSAGES });
    expect(await service.canManage(USER, GUILD)).toBe(false);
    state.bits = MANAGE_GUILD;
    expect(await service.canManage(USER, GUILD)).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(GUILD_ACCESS_DENY_TTL_MS + 1);
    expect(await service.canManage(USER, GUILD)).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('treats Unknown Member as not a member, and remembers it', async () => {
    const { service, fetch, state } = setup();
    state.failWith = new DiscordApiError(10007);
    expect(await service.canManage(USER, GUILD)).toBe(false);
    expect(await service.canManage(USER, GUILD)).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('refuses when the bot is not in the guild, without asking Discord', async () => {
    const { service, fetch } = setup({ inGuild: false });
    expect(await service.canManage(USER, GUILD)).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuses ids that are not snowflakes', async () => {
    const { service, fetch } = setup();
    expect(await service.canManage('../x', GUILD)).toBe(false);
    expect(await service.canManage(USER, 'abc')).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('shares one Discord request between concurrent checks', async () => {
    const { service, fetch } = setup();
    const results = await Promise.all([
      service.canManage(USER, GUILD),
      service.canManage(USER, GUILD, { fresh: true }),
      service.canManage(USER, GUILD),
    ]);
    expect(results).toEqual([true, true, true]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('rethrows other Discord failures and does not cache them', async () => {
    const { service, fetch, state } = setup();
    state.failWith = new DiscordApiError(500);
    await expect(service.canManage(USER, GUILD)).rejects.toThrow('Discord error 500');
    state.failWith = undefined;
    expect(await service.canManage(USER, GUILD)).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('never holds more than max entries when ten thousand new keys arrive', async () => {
    const { service } = setup();
    for (let i = 0; i < 10_000; i += 1) {
      await service.canManage(String(300000000000000000n + BigInt(i)), GUILD);
    }
    expect(service.cacheSize).toBeLessThanOrEqual(GUILD_ACCESS_CACHE_MAX);
    expect(service.cacheSize).toBeGreaterThan(0);
  });
});

describe('GuildAccessService.assertManageGuild', () => {
  it('resolves for a manager', async () => {
    await expect(setup().service.assertManageGuild(USER, GUILD)).resolves.toBeUndefined();
  });

  it('throws the same error whether the bot is absent or the rights are missing', async () => {
    const absent = await setup({ inGuild: false })
      .service.assertManageGuild(USER, GUILD)
      .catch((error: unknown) => error);
    const insufficient = await setup({ bits: SEND_MESSAGES })
      .service.assertManageGuild(USER, GUILD)
      .catch((error: unknown) => error);

    expect(absent).toBeInstanceOf(GuildNotFoundError);
    expect(insufficient).toBeInstanceOf(GuildNotFoundError);
    expect(absent).toMatchObject({ code: 'GUILD_NOT_FOUND', message: 'GUILD_NOT_FOUND' });
    expect((absent as Error).message).toBe((insufficient as Error).message);
  });

  it('passes fresh through to the check', async () => {
    const { service, state } = setup();
    await service.assertManageGuild(USER, GUILD);
    state.bits = SEND_MESSAGES;
    await expect(service.assertManageGuild(USER, GUILD, { fresh: true })).rejects.toBeInstanceOf(
      GuildNotFoundError,
    );
  });
});
