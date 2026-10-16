import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const rest = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('./user-guilds.client.js', () => ({ createUserRest: () => rest }));

import {
  DiscordUserClient,
  PROFILE_CACHE_TTL_MS,
  fetchDiscordProfile,
} from './discord-user.client.js';

const ID = '200000000000000001';
// (200000000000000001 >> 22) % 6
const DEFAULT_INDEX = ((BigInt(ID) >> 22n) % 6n).toString();
const TOKEN = `at-${randomBytes(8).toString('hex')}`;

describe('fetchDiscordProfile', () => {
  it('builds a PNG address from the avatar hash', async () => {
    rest.get.mockResolvedValue({ id: ID, username: 'sabi', global_name: 'Sabi', avatar: 'abc123' });
    await expect(fetchDiscordProfile(rest)).resolves.toEqual({
      username: 'sabi',
      globalName: 'Sabi',
      avatarUrl: `https://cdn.discordapp.com/avatars/${ID}/abc123.png?size=64`,
    });
  });

  it('uses a GIF for an animated avatar', async () => {
    rest.get.mockResolvedValue({ id: ID, username: 'sabi', global_name: null, avatar: 'a_abc' });
    const profile = await fetchDiscordProfile(rest);
    expect(profile.avatarUrl).toBe(`https://cdn.discordapp.com/avatars/${ID}/a_abc.gif?size=64`);
    expect(profile.globalName).toBeNull();
  });

  it('falls back to the default picture chosen by the account id', async () => {
    rest.get.mockResolvedValue({ id: ID, username: 'sabi', avatar: null });
    const profile = await fetchDiscordProfile(rest);
    expect(profile.avatarUrl).toBe(`https://cdn.discordapp.com/embed/avatars/${DEFAULT_INDEX}.png`);
    expect(profile.globalName).toBeNull();
  });

  it('rejects an answer that is not a user', async () => {
    rest.get.mockResolvedValue({ unexpected: true });
    await expect(fetchDiscordProfile(rest)).rejects.toThrow();
  });
});

describe('DiscordUserClient', () => {
  let clock = 0;
  beforeEach(() => {
    rest.get.mockReset();
    clock = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('asks Discord once per person within the TTL, then again after it', async () => {
    rest.get.mockResolvedValue({ id: ID, username: 'sabi', avatar: null });
    const client = new DiscordUserClient();
    await client.profileOf(ID, TOKEN);
    await client.profileOf(ID, TOKEN);
    expect(rest.get).toHaveBeenCalledOnce();
    clock += PROFILE_CACHE_TTL_MS + 1;
    await client.profileOf(ID, TOKEN);
    expect(rest.get).toHaveBeenCalledTimes(2);
  });

  it('does not cache a failure', async () => {
    rest.get.mockRejectedValueOnce(new Error('down'));
    rest.get.mockResolvedValue({ id: ID, username: 'sabi', avatar: null });
    const client = new DiscordUserClient();
    await expect(client.profileOf(ID, TOKEN)).rejects.toThrow('down');
    await expect(client.profileOf(ID, TOKEN)).resolves.toMatchObject({ username: 'sabi' });
  });
});
