import 'reflect-metadata';
import { parseMessageRef } from '@sab/shared';
import { Collection, PermissionFlagsBits, type Client, type Message } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import type { AutocompleteInteraction } from '../helpers/autocomplete-budget.js';
import { ReactionAutocompleteInterceptor } from '../interceptors/reaction-autocomplete.interceptor.js';
import { ChannelAccessService } from './channel-access.service.js';
import { DiscordReactionService } from './discord-reaction.service.js';
import { MessageResolver } from './message-resolver.service.js';

const CHANNEL_ID = '100000000000000001';
const MESSAGE_ID = '100000000000000002';
const GUILD_LINK = `https://discord.com/channels/222222222222222222/${CHANNEL_ID}/${MESSAGE_ID}`;

const clientOf = (fetch: ReturnType<typeof vi.fn>) =>
  ({ channels: { fetch } }) as unknown as Client;
const apiError = (code: number) => Object.assign(new Error(`Discord ${code}`), { code });

describe('ChannelAccessService', () => {
  function channel(options: {
    thread?: boolean;
    dm?: boolean;
    allow?: bigint[];
    noPermissions?: boolean;
    meCached?: boolean;
  }) {
    const me = { id: 'bot' };
    const fetchMe = vi.fn().mockResolvedValue(me);
    const permissionsFor = vi.fn((_member: unknown) =>
      options.noPermissions === true
        ? null
        : {
            has: (needed: bigint[]) => needed.every((flag) => (options.allow ?? []).includes(flag)),
          },
    );
    return {
      fetchMe,
      permissionsFor,
      value: {
        isDMBased: () => options.dm ?? false,
        isThread: () => options.thread ?? false,
        permissionsFor,
        guild: { members: { me: options.meCached === false ? null : me, fetchMe } },
      },
    };
  }

  const serviceFor = (value: unknown) =>
    new ChannelAccessService(clientOf(vi.fn().mockResolvedValue(value)));

  it('can send with View Channel and Send Messages, not with View Channel alone', async () => {
    const both = channel({
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
    });
    expect(await serviceFor(both.value).botCanSend(CHANNEL_ID)).toBe(true);
    const viewOnly = channel({ allow: [PermissionFlagsBits.ViewChannel] });
    expect(await serviceFor(viewOnly.value).botCanSend(CHANNEL_ID)).toBe(false);
  });

  it('needs Send Messages in Threads in a thread', async () => {
    const plain = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages];
    expect(
      await serviceFor(channel({ thread: true, allow: plain }).value).botCanSend(CHANNEL_ID),
    ).toBe(false);
    const forThreads = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessagesInThreads];
    expect(
      await serviceFor(channel({ thread: true, allow: forThreads }).value).botCanSend(CHANNEL_ID),
    ).toBe(true);
  });

  it('can read with View Channel and Read Message History', async () => {
    const allowed = channel({
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
    });
    expect(await serviceFor(allowed.value).botCanRead(CHANNEL_ID)).toBe(true);
    const noHistory = channel({ allow: [PermissionFlagsBits.ViewChannel] });
    expect(await serviceFor(noHistory.value).botCanRead(CHANNEL_ID)).toBe(false);
  });

  it('checks the bot member of that channel, fetching it when it is not cached', async () => {
    const uncached = channel({
      meCached: false,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
    });
    expect(await serviceFor(uncached.value).botCanSend(CHANNEL_ID)).toBe(true);
    expect(uncached.fetchMe).toHaveBeenCalledTimes(1);
    expect(uncached.permissionsFor).toHaveBeenCalledWith({ id: 'bot' });
  });

  it('is false for a direct message, an unknown channel and no resolvable permissions', async () => {
    expect(await serviceFor(channel({ dm: true }).value).botCanSend(CHANNEL_ID)).toBe(false);
    expect(await serviceFor(null).botCanSend(CHANNEL_ID)).toBe(false);
    expect(await serviceFor(channel({ noPermissions: true }).value).botCanSend(CHANNEL_ID)).toBe(
      false,
    );
  });

  it('is false for a channel the bot cannot see, and throws for any other failure', async () => {
    for (const code of [10003, 50001]) {
      const service = new ChannelAccessService(clientOf(vi.fn().mockRejectedValue(apiError(code))));
      expect(await service.botCanRead(CHANNEL_ID)).toBe(false);
    }
    const broken = new ChannelAccessService(clientOf(vi.fn().mockRejectedValue(apiError(50035))));
    await expect(broken.botCanRead(CHANNEL_ID)).rejects.toThrow('50035');
  });
});

describe('DiscordReactionService', () => {
  const user = (id: string, bot = false) => ({ id, bot });
  const ids = (from: number, count: number) =>
    Array.from({ length: count }, (_, i) => String(200000000000000000n + BigInt(from + i)));

  function reactionOf(
    emoji: string,
    pages: Array<Array<{ id: string; bot: boolean }>>,
    extra = {},
  ) {
    const fetch = vi.fn((options: { limit: number; after?: string }) => {
      const index =
        options.after === undefined
          ? 0
          : pages.findIndex((page) => page.some((u) => u.id === options.after)) + 1;
      return Promise.resolve(new Collection((pages[index] ?? []).map((u) => [u.id, u])));
    });
    return {
      fetch,
      value: {
        emoji: { toString: () => emoji, id: null, name: emoji },
        count: pages.flat().length,
        users: { fetch },
        ...extra,
      },
    };
  }
  const messageOf = (...reactions: Array<{ value: unknown }>) =>
    ({
      reactions: { cache: new Collection(reactions.map((r, i) => [String(i), r.value])) },
    }) as unknown as Message;

  const service = new DiscordReactionService({} as Client);

  it('pages through every reactor with the highest id as the cursor', async () => {
    const first = ids(0, 100).map((id) => user(id));
    const second = ids(100, 30).map((id) => user(id));
    const reaction = reactionOf('👍', [first, second]);

    const result = await service.fetchReactorIds(messageOf(reaction));

    expect(result).toHaveLength(130);
    expect(reaction.fetch).toHaveBeenCalledTimes(2);
    expect(reaction.fetch).toHaveBeenNthCalledWith(1, { limit: 100, after: undefined });
    expect(reaction.fetch).toHaveBeenNthCalledWith(2, { limit: 100, after: first.at(-1)?.id });
  });

  it('leaves bots out, merges reactions and counts a person once', async () => {
    const person = ids(0, 1)[0] as string;
    const a = reactionOf('👍', [[user(person), user('300000000000000001', true)]]);
    const b = reactionOf('🎉', [[user(person), user('300000000000000002')]]);
    expect((await service.fetchReactorIds(messageOf(a, b))).sort()).toEqual(
      [person, '300000000000000002'].sort(),
    );
  });

  it('counts only the asked emoji when one is given', async () => {
    const a = reactionOf('👍', [[user('300000000000000001')]]);
    const b = reactionOf('🎉', [[user('300000000000000002')]]);
    expect(await service.fetchReactorIds(messageOf(a, b), '🎉')).toEqual(['300000000000000002']);
    expect(a.fetch).not.toHaveBeenCalled();
  });

  it('fetches the message first when given a location', async () => {
    const reaction = reactionOf('👍', [[user('300000000000000001')]]);
    const message = messageOf(reaction);
    const fetchMessage = vi.fn().mockResolvedValue(message);
    const client = clientOf(
      vi.fn().mockResolvedValue({ isTextBased: () => true, messages: { fetch: fetchMessage } }),
    );
    const located = new DiscordReactionService(client);
    expect(await located.fetchReactorIds({ channelId: CHANNEL_ID, messageId: MESSAGE_ID })).toEqual(
      ['300000000000000001'],
    );
    expect(fetchMessage).toHaveBeenCalledWith(MESSAGE_ID);
  });

  it('answers hasReaction and listReactions from the cache', () => {
    const unicode = reactionOf('👍', [[user('1')]], { count: 3 });
    const custom = reactionOf('<:party:123>', [[user('2')]], {
      count: 5,
      emoji: { toString: () => '<:party:123>', id: '123', name: 'party' },
    });
    const none = reactionOf('👎', [], { count: 0 });
    const message = messageOf(unicode, custom, none);

    expect(service.hasReaction(message, '👍')).toBe(true);
    expect(service.hasReaction(message, '👎')).toBe(false);
    expect(service.hasReaction(message, '🎉')).toBe(false);
    expect(service.listReactions(message)).toEqual([
      { emoji: '👍', label: '👍', count: 3 },
      { emoji: '<:party:123>', label: ':party:', count: 5 },
    ]);
  });
});

describe('MessageResolver', () => {
  function resolverFor(options: { channel?: unknown; fetchMessage?: ReturnType<typeof vi.fn> }) {
    const fetchChannel = vi
      .fn()
      .mockResolvedValue(
        options.channel ?? { isTextBased: () => true, messages: { fetch: options.fetchMessage } },
      );
    return { resolver: new MessageResolver(clientOf(fetchChannel)), fetchChannel };
  }

  it('returns the message for a link, including one from another server', async () => {
    const message = { id: MESSAGE_ID };
    const { resolver, fetchChannel } = resolverFor({
      fetchMessage: vi.fn().mockResolvedValue(message),
    });
    expect(await resolver.fetch(`<${GUILD_LINK}>`)).toEqual({ status: 'OK', message });
    expect(fetchChannel).toHaveBeenCalledWith(CHANNEL_ID);
  });

  it('resolves a bare id in the default channel', async () => {
    const fetchMessage = vi.fn().mockResolvedValue({ id: MESSAGE_ID });
    const { resolver, fetchChannel } = resolverFor({ fetchMessage });
    await resolver.fetch(MESSAGE_ID, { channelId: CHANNEL_ID });
    expect(fetchChannel).toHaveBeenCalledWith(CHANNEL_ID);
    expect(fetchMessage).toHaveBeenCalledWith(MESSAGE_ID);
  });

  it('says why a link is unusable without calling Discord', async () => {
    const { resolver, fetchChannel } = resolverFor({});
    expect(await resolver.fetch('not a link')).toEqual({
      status: 'INVALID_LINK',
      reason: 'MALFORMED',
    });
    expect(await resolver.fetch('  ')).toEqual({ status: 'INVALID_LINK', reason: 'EMPTY' });
    expect(await resolver.fetch(MESSAGE_ID)).toEqual({
      status: 'INVALID_LINK',
      reason: 'CHANNEL_REQUIRED',
    });
    expect(fetchChannel).not.toHaveBeenCalled();
  });

  it.each([
    [10003, 'NOT_FOUND'],
    [10008, 'NOT_FOUND'],
    [50001, 'NO_ACCESS'],
    [50013, 'NO_ACCESS'],
  ])('maps Discord error %i to %s', async (code, status) => {
    const { resolver } = resolverFor({ fetchMessage: vi.fn().mockRejectedValue(apiError(code)) });
    expect(await resolver.fetch(GUILD_LINK)).toEqual({ status });
  });

  it('treats a channel that holds no messages as not found, and rethrows anything else', async () => {
    expect(
      await resolverFor({ channel: { isTextBased: () => false } }).resolver.fetch(GUILD_LINK),
    ).toEqual({
      status: 'NOT_FOUND',
    });
    const { resolver } = resolverFor({ fetchMessage: vi.fn().mockRejectedValue(apiError(50035)) });
    await expect(resolver.fetch(GUILD_LINK)).rejects.toThrow('50035');
  });
});

describe('ReactionAutocompleteInterceptor', () => {
  function build(summaries: Array<{ emoji: string; label: string; count: number }>) {
    const message = { id: MESSAGE_ID };
    // Like the real resolver, only a parseable reference reaches Discord.
    const resolver = {
      fetch: vi.fn((input: string, defaults?: { channelId?: string }) =>
        Promise.resolve(
          parseMessageRef(input, defaults).ok
            ? { status: 'OK', message }
            : { status: 'INVALID_LINK', reason: 'MALFORMED' },
        ),
      ),
    };
    const reactions = { listReactions: vi.fn().mockReturnValue(summaries) };
    const interceptor = new ReactionAutocompleteInterceptor(
      resolver as unknown as MessageResolver,
      reactions as unknown as DiscordReactionService,
    );
    return { interceptor, resolver, reactions };
  }

  function interaction(link: string | null, typed = '') {
    const respond = vi.fn().mockResolvedValue(undefined);
    return {
      respond,
      value: {
        channelId: CHANNEL_ID,
        respond,
        options: { getString: () => link, getFocused: () => typed },
      } as unknown as AutocompleteInteraction,
    };
  }

  it('suggests the emoji on the linked message with their counts, valued by emoji.toString()', async () => {
    const { interceptor } = build([
      { emoji: '👍', label: '👍', count: 3 },
      { emoji: '<:party:123>', label: ':party:', count: 5 },
    ]);
    const { respond, value } = interaction(GUILD_LINK);
    await interceptor.transformOptions(value);
    expect(respond).toHaveBeenCalledWith([
      { name: '👍 (3)', value: '👍' },
      { name: ':party: (5)', value: '<:party:123>' },
    ]);
  });

  it('filters by what was typed and shows at most 25', async () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      emoji: `<:e${i}:${i}>`,
      label: `:e${i}:`,
      count: 1,
    }));
    const { interceptor } = build(many);
    const all = interaction(GUILD_LINK);
    await interceptor.transformOptions(all.value);
    expect(all.respond.mock.calls[0]?.[0]).toHaveLength(25);

    const typed = interaction(GUILD_LINK, 'E3');
    await interceptor.transformOptions(typed.value);
    expect(
      (typed.respond.mock.calls[0]?.[0] as Array<{ value: string }>).map((c) => c.value),
    ).toEqual([
      '<:e3:3>',
      '<:e30:30>',
      '<:e31:31>',
      '<:e32:32>',
      '<:e33:33>',
      '<:e34:34>',
      '<:e35:35>',
      '<:e36:36>',
      '<:e37:37>',
      '<:e38:38>',
      '<:e39:39>',
    ]);
  });

  it('asks Discord once per message while the user keeps typing', async () => {
    const { interceptor, resolver } = build([{ emoji: '👍', label: '👍', count: 1 }]);
    for (const typed of ['', '👍', '']) {
      await interceptor.transformOptions(interaction(GUILD_LINK, typed).value);
    }
    expect(resolver.fetch).toHaveBeenCalledTimes(1);
  });

  it('suggests nothing before a link is filled in or when it does not parse', async () => {
    const { interceptor, resolver } = build([{ emoji: '👍', label: '👍', count: 1 }]);
    for (const link of [null, '', 'garbage']) {
      const { respond, value } = interaction(link);
      await interceptor.transformOptions(value);
      expect(respond).toHaveBeenCalledWith([]);
    }
    expect(resolver.fetch).not.toHaveBeenCalledWith('', expect.anything());
  });
});
