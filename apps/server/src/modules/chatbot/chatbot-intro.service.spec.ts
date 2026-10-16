import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GuildConfigService } from '../guild-config/guild-config.service.js';
import type { InfoService } from '../info/info.service.js';
import { ChatbotIntroService } from './chatbot-intro.service.js';

const GUILD = '100000000000000001';
const LAN = '400000000000000001';
const HUNG = '400000000000000002';
const STRANGER = '400000000000000099';
const INTRO_CHANNEL = '200000000000000001';

type Member = { id: string; displayName: string; user: { username: string; bot: boolean } };

function member(id: string, displayName: string, bot = false): Member {
  return { id, displayName, user: { username: displayName.toLowerCase(), bot } };
}

function setup(found: Member[] = [member(LAN, 'Lan')]) {
  const getIntroduction = vi.fn((_guild: string, _input: { userId: string }) =>
    Promise.resolve({
      status: 'FOUND' as const,
      channelId: '200000000000000001',
      messageId: '500000000000000001',
      url: 'https://discord.com/channels/1/2/3',
      content: 'Chào <@999> mình là Lan '.repeat(100),
    }),
  );
  const search = vi.fn((_options: { query: string; limit: number }) =>
    Promise.resolve(new Map(found.map((m) => [m.id, m]))),
  );
  const fetchMember = vi.fn((id: string) =>
    id === STRANGER ? Promise.reject(new Error('Unknown Member')) : Promise.resolve({ id }),
  );
  const guildGet = vi.fn((_guild: string): Promise<{ introChannelId: string | null }> =>
    Promise.resolve({ introChannelId: INTRO_CHANNEL }),
  );
  const client = {
    guilds: {
      cache: {
        get: (id: string) =>
          id === GUILD ? { members: { search, fetch: fetchMember } } : undefined,
      },
    },
  };
  const service = new ChatbotIntroService(
    { getIntroduction } as unknown as InfoService,
    { get: guildGet } as unknown as GuildConfigService,
    client as never,
  );
  return { service, getIntroduction, search, fetchMember, guildGet };
}

beforeEach(() => {
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('ChatbotIntroService', () => {
  it('reads the introduction of a mentioned member without searching names', async () => {
    const { service, getIntroduction, search } = setup();
    const result = await service.lookup(GUILD, `<@${LAN}>`);
    expect(search).not.toHaveBeenCalled();
    expect(getIntroduction).toHaveBeenCalledWith(GUILD, { userId: LAN });
    expect(result).toMatchObject({
      status: 'FOUND',
      member: `<@${LAN}>`,
      url: 'https://discord.com/channels/1/2/3',
    });
  });

  it('clips the text and makes it unable to carry a mention or a tag', async () => {
    const { service } = setup();
    const result = (await service.lookup(GUILD, LAN)) as { content: string };
    expect(result.content.length).toBeLessThanOrEqual(1500);
    expect(result.content.endsWith('…')).toBe(true);
    expect(result.content).not.toContain('<');
    expect(result.content).toContain('‹@999›');
  });

  it('resolves a display name among this server members', async () => {
    const { service, search, getIntroduction } = setup();
    await service.lookup(GUILD, '@Lan');
    expect(search).toHaveBeenCalledWith({ query: 'Lan', limit: 10 });
    expect(getIntroduction).toHaveBeenCalledWith(GUILD, { userId: LAN });
  });

  it('asks back when several members match and none matches exactly', async () => {
    const { service, getIntroduction } = setup([member(LAN, 'Lan Anh'), member(HUNG, 'Lan Chi')]);
    const result = (await service.lookup(GUILD, 'Lan')) as {
      status: string;
      candidates: { member: string; name: string }[];
    };
    expect(result.status).toBe('AMBIGUOUS');
    expect(result.candidates).toEqual([
      { member: `<@${LAN}>`, name: 'Lan Anh' },
      { member: `<@${HUNG}>`, name: 'Lan Chi' },
    ]);
    expect(getIntroduction).not.toHaveBeenCalled();
  });

  it('prefers the exact name over longer ones, and skips bots', async () => {
    const { service, getIntroduction } = setup([
      member(LAN, 'Lan'),
      member(HUNG, 'Lan Chi'),
      member('400000000000000003', 'lan', true),
    ]);
    await service.lookup(GUILD, 'lan');
    expect(getIntroduction).toHaveBeenCalledWith(GUILD, { userId: LAN });
  });

  it('says so when no member has that name', async () => {
    const { service, getIntroduction } = setup([]);
    expect(await service.lookup(GUILD, 'Nobody')).toEqual({ status: 'MEMBER_NOT_FOUND' });
    expect(getIntroduction).not.toHaveBeenCalled();
  });

  it('is unavailable for a server the bot is not in, and when the search fails', async () => {
    const { service, search } = setup();
    expect(await service.lookup('100000000000000009', 'Lan')).toEqual({ error: 'unavailable' });
    search.mockRejectedValue(new Error('discord down'));
    expect(await service.lookup(GUILD, 'Lan')).toEqual({ error: 'unavailable' });
  });

  it('remembers FOUND and NOT_FOUND, so the channel is scanned once', async () => {
    const { service, getIntroduction } = setup();
    await service.lookup(GUILD, LAN);
    await service.lookup(GUILD, `<@${LAN}>`);
    expect(getIntroduction).toHaveBeenCalledTimes(1);

    getIntroduction.mockResolvedValue({ status: 'NOT_FOUND', scanned: 40 } as never);
    expect(await service.lookup(GUILD, HUNG)).toEqual({
      status: 'NOT_FOUND',
      member: `<@${HUNG}>`,
      scanned: 40,
    });
    await service.lookup(GUILD, HUNG);
    expect(getIntroduction).toHaveBeenCalledTimes(2);
  });

  it('forgets an answer after half an hour', async () => {
    // The cache reads the monotonic clock on every call; steer it directly.
    let now = 1_000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const { service, getIntroduction } = setup();
    await service.lookup(GUILD, LAN);
    now += 29 * 60_000;
    await service.lookup(GUILD, LAN);
    expect(getIntroduction).toHaveBeenCalledTimes(1);
    now += 2 * 60_000;
    await service.lookup(GUILD, LAN);
    expect(getIntroduction).toHaveBeenCalledTimes(2);
  });

  it('does not remember an unreadable channel or an unset one', async () => {
    const { service, getIntroduction } = setup();
    getIntroduction.mockRejectedValueOnce(new Error('missing permissions'));
    expect(await service.lookup(GUILD, LAN)).toEqual({ status: 'UNREADABLE' });
    getIntroduction.mockResolvedValueOnce({ status: 'NO_CHANNEL' } as never);
    expect(await service.lookup(GUILD, LAN)).toEqual({ status: 'NO_CHANNEL' });
    await service.lookup(GUILD, LAN);
    expect(getIntroduction).toHaveBeenCalledTimes(3);
  });

  it('answers NOT_FOUND without scanning for an id that is not a member of the server', async () => {
    const { service, getIntroduction } = setup();
    expect(await service.lookup(GUILD, `<@${STRANGER}>`)).toEqual({
      status: 'NOT_FOUND',
      member: `<@${STRANGER}>`,
      scanned: 0,
    });
    expect(getIntroduction).not.toHaveBeenCalled();
  });

  it('does not serve an answer read from an intro channel that has since changed', async () => {
    const { service, getIntroduction, guildGet } = setup();
    await service.lookup(GUILD, LAN);
    guildGet.mockResolvedValue({ introChannelId: '200000000000000002' });
    await service.lookup(GUILD, LAN);
    expect(getIntroduction).toHaveBeenCalledTimes(2);
  });

  it('says there is no channel without scanning when none is set', async () => {
    const { service, getIntroduction, guildGet } = setup();
    guildGet.mockResolvedValue({ introChannelId: null });
    expect(await service.lookup(GUILD, LAN)).toEqual({ status: 'NO_CHANNEL' });
    expect(getIntroduction).not.toHaveBeenCalled();
  });

  it('runs one scan at a time, across members', async () => {
    const { service, getIntroduction } = setup();
    let running = 0;
    let peak = 0;
    getIntroduction.mockImplementation(async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
      return { status: 'NOT_FOUND', scanned: 1 } as never;
    });
    await Promise.all([service.lookup(GUILD, LAN), service.lookup(GUILD, HUNG)]);
    expect(getIntroduction).toHaveBeenCalledTimes(2);
    expect(peak).toBe(1);
  });

  it('stops waiting at once when the call is aborted, and the scan still fills the cache', async () => {
    const { service, getIntroduction } = setup();
    let finish: (value: unknown) => void = () => undefined;
    getIntroduction.mockImplementationOnce(
      () => new Promise((resolve) => (finish = resolve)) as never,
    );
    const controller = new AbortController();
    const waiting = service.lookup(GUILD, LAN, controller.signal);
    await vi.waitFor(() => expect(getIntroduction).toHaveBeenCalled());
    controller.abort();
    expect(await waiting).toEqual({ status: 'CANCELLED' });

    expect(await service.lookup(GUILD, LAN, AbortSignal.abort())).toEqual({ status: 'CANCELLED' });
    finish({ status: 'NOT_FOUND', scanned: 4 });
    await vi.waitFor(async () => {
      expect(await service.lookup(GUILD, LAN)).toMatchObject({ status: 'NOT_FOUND', scanned: 4 });
    });
    expect(getIntroduction).toHaveBeenCalledTimes(1);
  });

  it('joins a scan already running instead of starting another', async () => {
    const { service, getIntroduction } = setup();
    const [a, b] = await Promise.all([service.lookup(GUILD, LAN), service.lookup(GUILD, LAN)]);
    expect(getIntroduction).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
  });

  it('gives up at the time budget, and the late answer still fills the cache', async () => {
    const { service, getIntroduction } = setup();
    let finish: (value: unknown) => void = () => undefined;
    getIntroduction.mockImplementationOnce(
      () => new Promise((resolve) => (finish = resolve)) as never,
    );
    expect(await service.lookup(GUILD, LAN, undefined, 10)).toEqual({ status: 'TIMEOUT' });

    finish({ status: 'NOT_FOUND', scanned: 9 });
    await vi.waitFor(async () => {
      expect(await service.lookup(GUILD, LAN)).toMatchObject({ status: 'NOT_FOUND', scanned: 9 });
    });
    expect(getIntroduction).toHaveBeenCalledTimes(1);
  });
});
