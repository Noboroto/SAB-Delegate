import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { MessageReferenceType } from 'discord.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DiscordReadyService } from '../../discord/discord-ready.service.js';
import type { ChatbotConfigService } from './chatbot-config.service.js';
import { ChatbotListener } from './chatbot.listener.js';
import type { ChatbotService } from './chatbot.service.js';

const GUILD = '100000000000000001';
const CHANNEL = '200000000000000001';
const USER = '300000000000000001';
const OTHER_USER = '300000000000000002';
const BOT = '900000000000000001';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

type Setup = {
  route?: { enabled: boolean } | null;
  stopping?: boolean;
};

type MessageOptions = {
  id?: string;
  authorId?: string;
  bot?: boolean;
  guildId?: string | null;
  /** What `mentions.has` answers for the bot. */
  mentionsBot?: boolean;
  /** The author of the replied-to message, as the gateway reports it. */
  repliedUserId?: string | null;
  referenceId?: string;
  referenceType?: MessageReferenceType;
  /** The channel is a thread of this channel. */
  threadOf?: string;
  reference?: () => Promise<unknown>;
  react?: () => Promise<unknown>;
};

let counter = 0;

function build(setup: Setup = {}) {
  const routeOf = vi
    .fn()
    .mockResolvedValue(setup.route === undefined ? { enabled: true } : setup.route);
  const handle = vi.fn().mockResolvedValue(undefined);
  const listener = new ChatbotListener(
    { routeOf } as unknown as ChatbotConfigService,
    { handle } as unknown as ChatbotService,
    { isStopping: () => setup.stopping ?? false } as unknown as DiscordReadyService,
  );
  const message = (options: MessageOptions = {}) => {
    counter += 1;
    const guildId = options.guildId === undefined ? GUILD : options.guildId;
    const has = vi.fn((_user: unknown, _flags: unknown) => options.mentionsBot ?? false);
    return {
      id: options.id ?? `5000000000000${String(counter).padStart(5, '0')}`,
      guildId,
      channelId: CHANNEL,
      author: { id: options.authorId ?? USER, bot: options.bot ?? false },
      client: { user: { id: BOT } },
      inGuild: () => guildId !== null,
      mentions: {
        has,
        repliedUser:
          options.repliedUserId === undefined || options.repliedUserId === null
            ? null
            : { id: options.repliedUserId },
      },
      channel: {
        isThread: () => options.threadOf !== undefined,
        parentId: options.threadOf ?? null,
      },
      reference:
        options.referenceId === undefined
          ? null
          : {
              messageId: options.referenceId,
              type: options.referenceType ?? MessageReferenceType.Default,
            },
      fetchReference: vi.fn(options.reference ?? (() => Promise.reject(new Error('no reference')))),
      react: vi.fn(options.react ?? (() => Promise.resolve(undefined))),
    };
  };
  return { listener, routeOf, handle, message };
}

const send = (listener: ChatbotListener, incoming: unknown) =>
  listener.onMessageCreate([incoming] as never);

/** A promise that settles when the test says so. */
function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open };
}

describe('ChatbotListener: what triggers a reply', () => {
  it('ignores a plain message without even looking up the channel', async () => {
    const { listener, routeOf, handle, message } = build();
    await send(listener, message());
    expect(routeOf).not.toHaveBeenCalled();
    expect(handle).not.toHaveBeenCalled();
  });

  it('answers a mention of the bot in a designated channel', async () => {
    const { listener, routeOf, handle, message } = build();
    const incoming = message({ mentionsBot: true });
    await send(listener, incoming);
    expect(routeOf).toHaveBeenCalledWith(GUILD, CHANNEL);
    expect(handle).toHaveBeenCalledTimes(1);
    expect(handle).toHaveBeenCalledWith(incoming);
  });

  it('asks for a real mention only: @everyone and role pings are not counted', async () => {
    const { listener, handle, message } = build();
    // discord.js answers false for an @everyone message when told to ignore it.
    const everyone = message({ mentionsBot: false });
    await send(listener, everyone);
    expect(handle).not.toHaveBeenCalled();
    expect(everyone.mentions.has).toHaveBeenCalledWith(
      { id: BOT },
      { ignoreEveryone: true, ignoreRoles: true },
    );
  });

  it('answers a reply to a message of the bot, without asking Discord for the message', async () => {
    const { listener, handle, message } = build();
    const incoming = message({ repliedUserId: BOT, referenceId: '600000000000000001' });
    await send(listener, incoming);
    expect(handle).toHaveBeenCalledWith(incoming);
    expect(incoming.fetchReference).not.toHaveBeenCalled();
  });

  it('ignores a reply to somebody else', async () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { listener, handle, message } = build();
    await send(listener, message({ repliedUserId: OTHER_USER, referenceId: '600000000000000001' }));
    expect(handle).not.toHaveBeenCalled();
  });

  it('fetches the replied-to message when the gateway did not include its author', async () => {
    const { listener, handle, message } = build();
    const botOwn = message({
      referenceId: '600000000000000001',
      reference: () => Promise.resolve({ author: { id: BOT } }),
    });
    await send(listener, botOwn);
    expect(handle).toHaveBeenCalledWith(botOwn);

    const others = message({
      referenceId: '600000000000000002',
      reference: () => Promise.resolve({ author: { id: OTHER_USER } }),
    });
    await send(listener, others);
    expect(handle).toHaveBeenCalledTimes(1);
  });

  it('treats a replied-to message that was deleted as no trigger', async () => {
    const { listener, handle, message } = build();
    const gone = Object.assign(new Error('Unknown Message'), { code: 10008 });
    await send(
      listener,
      message({ referenceId: '600000000000000001', reference: () => Promise.reject(gone) }),
    );
    expect(handle).not.toHaveBeenCalled();
  });

  it('treats a replied-to message the bot cannot see as no trigger, without noise', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    for (const code of [10003, 50001, 50013]) {
      const { listener, handle, message } = build();
      const refused = Object.assign(new Error('Missing Access'), { code });
      await expect(
        send(
          listener,
          message({ referenceId: '600000000000000001', reference: () => Promise.reject(refused) }),
        ),
      ).resolves.toBeUndefined();
      expect(handle).not.toHaveBeenCalled();
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it('logs an unexpected failure of that lookup by its class only and does not raise it', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { listener, handle, message } = build();
    await expect(
      send(
        listener,
        message({
          referenceId: '600000000000000001',
          reference: () => Promise.reject(new Error('secret text of the failure')),
        }),
      ),
    ).resolves.toBeUndefined();
    expect(handle).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).not.toContain('secret text');
  });

  it('ignores a forwarded message: it answers nobody', async () => {
    const { listener, routeOf, handle, message } = build();
    const forwarded = message({
      referenceId: '600000000000000001',
      referenceType: MessageReferenceType.Forward,
      reference: () => Promise.resolve({ author: { id: BOT } }),
    });
    await send(listener, forwarded);
    expect(forwarded.fetchReference).not.toHaveBeenCalled();
    expect(routeOf).not.toHaveBeenCalled();
    expect(handle).not.toHaveBeenCalled();
  });

  it('still answers a mention that sits in a forwarded message', async () => {
    const { listener, handle, message } = build();
    await send(
      listener,
      message({
        mentionsBot: true,
        referenceId: '600000000000000001',
        referenceType: MessageReferenceType.Forward,
      }),
    );
    expect(handle).toHaveBeenCalledTimes(1);
  });

  it('serves a thread of a designated channel, routed by its parent channel', async () => {
    const PARENT = '200000000000000777';
    const { listener, routeOf, handle, message } = build();
    const inThread = message({ mentionsBot: true, threadOf: PARENT });
    await send(listener, inThread);
    expect(routeOf).toHaveBeenCalledWith(GUILD, PARENT);
    // The conversation itself stays the thread's own.
    expect(handle).toHaveBeenCalledWith(inThread);
    expect(inThread.channelId).toBe(CHANNEL);
  });

  it('does not serve a thread whose parent is not designated', async () => {
    const { listener, routeOf, handle, message } = build({ route: null });
    await send(listener, message({ mentionsBot: true, threadOf: '200000000000000777' }));
    expect(routeOf).toHaveBeenCalledWith(GUILD, '200000000000000777');
    expect(handle).not.toHaveBeenCalled();
  });

  it('does not look up the replied-to message in a channel the chatbot is not in', async () => {
    const { listener, handle, message } = build({ route: null });
    const incoming = message({ referenceId: '600000000000000001' });
    await send(listener, incoming);
    expect(incoming.fetchReference).not.toHaveBeenCalled();
    expect(handle).not.toHaveBeenCalled();
  });

  it('never answers in a channel that is not designated, or while the chatbot is off', async () => {
    for (const route of [null, { enabled: false }]) {
      const { listener, handle, message } = build({ route });
      await send(listener, message({ mentionsBot: true }));
      expect(handle).not.toHaveBeenCalled();
    }
  });

  it('never looks at bots, direct messages, or anything once shutdown has begun', async () => {
    const { listener, routeOf, handle, message } = build();
    await send(listener, message({ mentionsBot: true, bot: true }));
    await send(listener, message({ mentionsBot: true, guildId: null }));
    const stopping = build({ stopping: true });
    await send(stopping.listener, stopping.message({ mentionsBot: true }));
    expect(routeOf).not.toHaveBeenCalled();
    expect(stopping.routeOf).not.toHaveBeenCalled();
    expect(handle).not.toHaveBeenCalled();
    expect(stopping.handle).not.toHaveBeenCalled();
  });

  it('answers a message delivered twice only once', async () => {
    const { listener, routeOf, handle, message } = build();
    const incoming = message({ mentionsBot: true });
    await Promise.all([send(listener, incoming), send(listener, incoming)]);
    expect(handle).toHaveBeenCalledTimes(1);
    // The copy is dropped before any lookup, and is not mistaken for a busy member.
    expect(routeOf).toHaveBeenCalledTimes(1);
    expect(incoming.react).not.toHaveBeenCalled();
  });
});

describe('ChatbotListener: one answer at a time per member', () => {
  it('marks a second mention from a member still being answered, and does not answer it', async () => {
    const { listener, handle, message } = build();
    const release = gate();
    handle.mockReturnValueOnce(release.opened);
    const first = send(listener, message({ mentionsBot: true }));
    await vi.waitFor(() => expect(handle).toHaveBeenCalledTimes(1));

    const second = message({ mentionsBot: true });
    await send(listener, second);
    expect(second.react).toHaveBeenCalledWith('⏳');
    expect(handle).toHaveBeenCalledTimes(1);

    release.open();
    await first;
    const third = message({ mentionsBot: true });
    await send(listener, third);
    expect(third.react).not.toHaveBeenCalled();
    expect(handle).toHaveBeenCalledTimes(2);
  });

  it('keeps going when the busy mark cannot be added', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { listener, handle, message } = build();
    const release = gate();
    handle.mockReturnValueOnce(release.opened);
    const first = send(listener, message({ mentionsBot: true }));
    await vi.waitFor(() => expect(handle).toHaveBeenCalledTimes(1));

    const refused = Object.assign(new Error('Missing Permissions'), { code: 50013 });
    await expect(
      send(listener, message({ mentionsBot: true, react: () => Promise.reject(refused) })),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    release.open();
    await first;
  });

  it('answers different members in the same channel one after the other', async () => {
    const { listener, handle, message } = build();
    const release = gate();
    const order: string[] = [];
    handle.mockImplementationOnce(async () => {
      order.push('first:start');
      await release.opened;
      order.push('first:end');
    });
    handle.mockImplementationOnce(() => {
      order.push('second');
      return Promise.resolve();
    });
    const first = send(listener, message({ mentionsBot: true }));
    await vi.waitFor(() => expect(order).toEqual(['first:start']));
    const second = send(listener, message({ mentionsBot: true, authorId: OTHER_USER }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(order).toEqual(['first:start']);
    release.open();
    await Promise.all([first, second]);
    expect(order).toEqual(['first:start', 'first:end', 'second']);
  });

  it('lets a failure reach the exception filter and frees the member for the next message', async () => {
    const { listener, handle, message } = build();
    handle.mockRejectedValueOnce(new Error('db down'));
    await expect(send(listener, message({ mentionsBot: true }))).rejects.toThrow('db down');

    const next = message({ mentionsBot: true });
    await send(listener, next);
    expect(next.react).not.toHaveBeenCalled();
    expect(handle).toHaveBeenCalledTimes(2);
  });
});
