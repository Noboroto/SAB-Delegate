import 'reflect-metadata';
import { ErrorCode, MESSAGES, POLL_PLACEHOLDER_TEXT } from '@sab/shared';
import { MessageFlags, TextInputStyle, type ModalBuilder } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { ServiceError } from '../../common/errors/service-error.js';
import type { GuildLocaleService } from '../../i18n/guild-locale.service.js';
import type { MessageResolver } from '../../discord/services/message-resolver.service.js';
import { AddPollCommands } from './add-poll.commands.js';
import { MessagingCommands } from './messaging.commands.js';
import type { MessagingService } from './messaging.service.js';

const GUILD = '100000000000000001';
const CHANNEL = '200000000000000001';
const OTHER_CHANNEL = '200000000000000002';
const MESSAGE = '300000000000000001';
const REPLY = '300000000000000002';
const BOT = '400000000000000001';
const USER = '400000000000000002';
const T = MESSAGES.en.messaging;

const linkTo = (channel: string, message: string) =>
  `https://discord.com/channels/${GUILD}/${channel}/${message}`;

const found = (
  over: Partial<{ id: string; channelId: string; author: string; content: string }> = {},
) => ({
  status: 'OK' as const,
  message: {
    id: over.id ?? MESSAGE,
    channelId: over.channelId ?? CHANNEL,
    author: { id: over.author ?? BOT },
    content: over.content ?? 'current text',
  },
});

function build() {
  const messaging = {
    sendMessage: vi.fn().mockResolvedValue({}),
    copyMessage: vi.fn().mockResolvedValue({ status: 'COPIED' }),
    editBotMessage: vi.fn().mockResolvedValue({ status: 'EDITED' }),
    editBotMessageFromCopy: vi.fn().mockResolvedValue({ status: 'EDITED' }),
    reactToMessage: vi.fn().mockResolvedValue({}),
    createReactionPoll: vi.fn().mockResolvedValue({}),
  };
  const resolver = { fetch: vi.fn().mockResolvedValue(found()) };
  const locales = { resolve: vi.fn().mockResolvedValue('en') };
  const commands = new MessagingCommands(
    messaging as unknown as MessagingService,
    resolver as unknown as MessageResolver,
    locales as unknown as GuildLocaleService,
  );
  const poll = new AddPollCommands(
    messaging as unknown as MessagingService,
    resolver as unknown as MessageResolver,
    locales as unknown as GuildLocaleService,
  );
  const interaction = () => {
    const target = {
      guildId: GUILD,
      channelId: CHANNEL,
      locale: 'vi',
      user: { id: USER },
      client: { user: { id: BOT } },
      replied: false,
      deferred: false,
      reply: vi.fn().mockResolvedValue(undefined),
      showModal: vi.fn().mockResolvedValue(undefined),
      deferReply: vi.fn().mockImplementation(() => {
        target.deferred = true;
        return Promise.resolve();
      }),
      editReply: vi.fn().mockResolvedValue(undefined),
      followUp: vi.fn().mockResolvedValue(undefined),
    };
    return target;
  };
  return { commands, poll, messaging, resolver, locales, interaction };
}

const textOf = (mock: { mock: { calls: unknown[][] } }) =>
  (mock.mock.calls[0]?.[0] as { content: string }).content;

const modalOf = (target: { showModal: { mock: { calls: unknown[][] } } }) =>
  (target.showModal.mock.calls[0] as [ModalBuilder])[0].toJSON();

type Input = { custom_id: string; style: TextInputStyle; value?: string; required?: boolean };

const inputOf = (modal: ReturnType<ModalBuilder['toJSON']>) =>
  (modal.components as unknown as Array<{ component: Input }>)[0]?.component as Input;

const discordRefusal = (reason: string) =>
  new ServiceError(ErrorCode.DISCORD_MISSING_PERMISSIONS, { permission: 'send', reason });

describe('/bot-message send', () => {
  it('opens a dialog as the first and only response when the text is missing', async () => {
    const { commands, messaging, resolver, interaction } = build();
    const target = interaction();
    await commands.onSend([target] as never, {});

    expect(target.showModal).toHaveBeenCalledOnce();
    expect(target.deferReply).not.toHaveBeenCalled();
    expect(target.reply).not.toHaveBeenCalled();
    expect(resolver.fetch).not.toHaveBeenCalled();
    expect(messaging.sendMessage).not.toHaveBeenCalled();
    const modal = modalOf(target);
    expect(modal.custom_id).toBe(`bm-send/${CHANNEL}/-`);
    expect(modal.title).toBe(MESSAGES.vi.messaging.modal.send.title);
    expect(inputOf(modal)).toMatchObject({ style: TextInputStyle.Paragraph, required: true });
  });

  it('carries the chosen channel in the dialog id', async () => {
    const { commands, interaction } = build();
    const target = interaction();
    await commands.onSend([target] as never, { destination: { id: OTHER_CHANNEL } });
    expect(modalOf(target).custom_id).toBe(`bm-send/${OTHER_CHANNEL}/-`);
  });

  it('turns a reply link into a reply dialog in the replied-to message’s own channel', async () => {
    const { commands, interaction } = build();
    const target = interaction();
    await commands.onSend([target] as never, {
      destination: { id: CHANNEL },
      replyMessage: linkTo(OTHER_CHANNEL, REPLY),
    });
    const modal = modalOf(target);
    expect(modal.custom_id).toBe(`bm-send/${OTHER_CHANNEL}/${REPLY}`);
    expect(modal.custom_id.length).toBeLessThanOrEqual(100);
    expect(modal.title).toBe(MESSAGES.vi.messaging.modal.reply.title);
  });

  it('says what is wrong with a reply link instead of opening a dialog', async () => {
    const { commands, interaction } = build();
    const target = interaction();
    await commands.onSend([target] as never, { replyMessage: 'not a link' });

    expect(target.showModal).not.toHaveBeenCalled();
    expect(textOf(target.reply)).toBe(MESSAGES.en.errors.invalidLink.MALFORMED);
    expect((target.reply.mock.calls[0]?.[0] as { flags: unknown }).flags).toBe(
      MessageFlags.Ephemeral,
    );
  });

  it('defers privately, sends to the channel it ran in and answers "Sent!"', async () => {
    const { commands, messaging, interaction } = build();
    const target = interaction();
    await commands.onSend([target] as never, { content: 'hello' });

    expect(target.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(messaging.sendMessage).toHaveBeenCalledWith(
      GUILD,
      { channelId: CHANNEL, content: 'hello', replyTo: undefined },
      { source: 'DISCORD', userId: USER },
    );
    expect(textOf(target.editReply)).toBe(T.sent);
  });

  it('sends to the destination when one is chosen', async () => {
    const { commands, messaging, interaction } = build();
    await commands.onSend([interaction()] as never, {
      content: 'hello',
      destination: { id: OTHER_CHANNEL },
    });
    expect(messaging.sendMessage.mock.calls[0]?.[1]).toMatchObject({ channelId: OTHER_CHANNEL });
  });

  it('lets the reply win over the destination', async () => {
    const { commands, messaging, resolver, interaction } = build();
    resolver.fetch.mockResolvedValue(found({ id: REPLY, channelId: OTHER_CHANNEL }));
    await commands.onSend([interaction()] as never, {
      content: 'hello',
      destination: { id: CHANNEL },
      replyMessage: linkTo(OTHER_CHANNEL, REPLY),
    });

    expect(messaging.sendMessage.mock.calls[0]?.[1]).toEqual({
      channelId: CHANNEL,
      content: 'hello',
      replyTo: { channelId: OTHER_CHANNEL, messageId: REPLY },
    });
  });

  it('stops when the reply target cannot be found rather than posting elsewhere', async () => {
    const { commands, messaging, resolver, interaction } = build();
    resolver.fetch.mockResolvedValue({ status: 'NOT_FOUND' });
    const target = interaction();
    await commands.onSend([target] as never, { content: 'hello', replyMessage: 'x' });

    expect(messaging.sendMessage).not.toHaveBeenCalled();
    expect(textOf(target.editReply)).toBe(MESSAGES.en.errors.DISCORD_MESSAGE_NOT_FOUND);
  });

  it('rejects text that is only spaces', async () => {
    const { commands, messaging, interaction } = build();
    const target = interaction();
    await commands.onSend([target] as never, { content: '   ' });
    expect(messaging.sendMessage).not.toHaveBeenCalled();
    expect(textOf(target.editReply)).toBe(T.emptyContent);
  });

  it('shows "Cannot send: <reason>" when Discord refuses, without a stack', async () => {
    const { commands, messaging, interaction } = build();
    messaging.sendMessage.mockRejectedValue(discordRefusal('Missing Permissions'));
    const target = interaction();
    await commands.onSend([target] as never, { content: 'hello' });
    expect(textOf(target.editReply)).toBe('Cannot send: Missing Permissions');
  });

  it('leaves any other failure to the exception filter', async () => {
    const { commands, messaging, interaction } = build();
    const fault = new Error('boom');
    messaging.sendMessage.mockRejectedValue(fault);
    const target = interaction();
    await expect(commands.onSend([target] as never, { content: 'hello' })).rejects.toBe(fault);
    expect(target.editReply).not.toHaveBeenCalled();
  });
});

describe('/bot-message copy-paste', () => {
  it('copies into the destination and answers Done', async () => {
    const { commands, messaging, interaction } = build();
    const target = interaction();
    await commands.onCopyPaste([target] as never, {
      messageLink: linkTo(CHANNEL, MESSAGE),
      destination: { id: OTHER_CHANNEL },
    });

    expect(messaging.copyMessage).toHaveBeenCalledWith(
      GUILD,
      { source: { channelId: CHANNEL, messageId: MESSAGE }, channelId: OTHER_CHANNEL },
      { source: 'DISCORD', userId: USER },
    );
    expect(textOf(target.editReply)).toBe(T.done);
  });

  it('says so when the source has nothing to copy', async () => {
    const { commands, messaging, interaction } = build();
    messaging.copyMessage.mockResolvedValue({ status: 'NOTHING_TO_COPY' });
    const target = interaction();
    await commands.onCopyPaste([target] as never, { messageLink: 'x' });
    expect(textOf(target.editReply)).toBe(T.nothingToCopy.source);
  });

  it('names the destination when Discord refuses', async () => {
    const { commands, messaging, interaction } = build();
    messaging.copyMessage.mockRejectedValue(discordRefusal('Missing Access'));
    const target = interaction();
    await commands.onCopyPaste([target] as never, {
      messageLink: 'x',
      destination: { id: OTHER_CHANNEL },
    });
    expect(textOf(target.editReply)).toBe(`Cannot send to <#${OTHER_CHANNEL}>: Missing Access`);
  });

  it('reports a source that cannot be found', async () => {
    const { commands, messaging, resolver, interaction } = build();
    resolver.fetch.mockResolvedValue({ status: 'INVALID_LINK', reason: 'EMPTY' });
    const target = interaction();
    await commands.onCopyPaste([target] as never, { messageLink: '' });
    expect(messaging.copyMessage).not.toHaveBeenCalled();
    expect(textOf(target.editReply)).toBe(MESSAGES.en.errors.invalidLink.EMPTY);
  });
});

describe('/bot-message edit-copy', () => {
  it('edits the old bot message with the new one', async () => {
    const { commands, messaging, resolver, interaction } = build();
    resolver.fetch
      .mockResolvedValueOnce(found({ id: MESSAGE }))
      .mockResolvedValueOnce(found({ id: REPLY, author: USER }));
    const target = interaction();
    await commands.onEditCopy([target] as never, {
      oldBotMessageLink: 'old',
      newMessageLink: 'new',
    });

    expect(resolver.fetch.mock.calls.map(([input]) => input as string)).toEqual(['old', 'new']);
    expect(messaging.editBotMessageFromCopy).toHaveBeenCalledWith(
      GUILD,
      {
        target: { channelId: CHANNEL, messageId: MESSAGE },
        source: { channelId: CHANNEL, messageId: REPLY },
      },
      { source: 'DISCORD', userId: USER },
    );
    expect(textOf(target.editReply)).toBe(T.done);
  });

  it.each([
    ['NOT_BOT_MESSAGE', T.notBotMessage],
    ['NOTHING_TO_COPY', T.nothingToCopy.new],
  ])('answers %s in words', async (status, text) => {
    const { commands, messaging, interaction } = build();
    messaging.editBotMessageFromCopy.mockResolvedValue({ status });
    const target = interaction();
    await commands.onEditCopy([target] as never, { oldBotMessageLink: 'a', newMessageLink: 'b' });
    expect(textOf(target.editReply)).toBe(text);
  });
});

describe('/bot-message edit-send', () => {
  it('opens a dialog showing the current text when the new text is missing', async () => {
    const { commands, messaging, interaction } = build();
    const target = interaction();
    await commands.onEditSend([target] as never, { oldBotMessageLink: 'old' });

    expect(target.deferReply).not.toHaveBeenCalled();
    expect(messaging.editBotMessage).not.toHaveBeenCalled();
    const modal = modalOf(target);
    expect(modal.custom_id).toBe(`bm-edit/${CHANNEL}/${MESSAGE}`);
    expect(inputOf(modal)).toMatchObject({
      style: TextInputStyle.Paragraph,
      value: 'current text',
      required: true,
    });
  });

  it('does not open a dialog for a message the bot did not send', async () => {
    const { commands, resolver, interaction } = build();
    resolver.fetch.mockResolvedValue(found({ author: USER }));
    const target = interaction();
    await commands.onEditSend([target] as never, { oldBotMessageLink: 'old' });

    expect(target.showModal).not.toHaveBeenCalled();
    expect(textOf(target.reply)).toBe(T.notBotMessage);
  });

  it('edits straight away when the new text is given', async () => {
    const { commands, messaging, interaction } = build();
    const target = interaction();
    await commands.onEditSend([target] as never, {
      oldBotMessageLink: 'old',
      newContent: 'fresh',
    });

    expect(target.showModal).not.toHaveBeenCalled();
    expect(messaging.editBotMessage).toHaveBeenCalledWith(
      GUILD,
      { target: { channelId: CHANNEL, messageId: MESSAGE }, content: 'fresh' },
      { source: 'DISCORD', userId: USER },
    );
    expect(textOf(target.editReply)).toBe(T.done);
  });

  it('refuses empty new text', async () => {
    const { commands, messaging, interaction } = build();
    const target = interaction();
    await commands.onEditSend([target] as never, { oldBotMessageLink: 'old', newContent: '  ' });
    expect(messaging.editBotMessage).not.toHaveBeenCalled();
    expect(textOf(target.editReply)).toBe(T.emptyContent);
  });

  it('answers that the old message was not sent by this bot', async () => {
    const { commands, messaging, interaction } = build();
    messaging.editBotMessage.mockResolvedValue({ status: 'NOT_BOT_MESSAGE' });
    const target = interaction();
    await commands.onEditSend([target] as never, { oldBotMessageLink: 'old', newContent: 'x' });
    expect(textOf(target.editReply)).toBe('The old message was not sent by this bot!');
  });

  it('shows "Cannot edit the message: <reason>" when Discord refuses', async () => {
    const { commands, messaging, interaction } = build();
    messaging.editBotMessage.mockRejectedValue(discordRefusal('Cannot edit a message'));
    const target = interaction();
    await commands.onEditSend([target] as never, { oldBotMessageLink: 'old', newContent: 'x' });
    expect(textOf(target.editReply)).toBe('Cannot edit the message: Cannot edit a message');
  });
});

describe('/bot-message react', () => {
  it('reacts with the emoji and the number of poll choices asked for', async () => {
    const { commands, messaging, interaction } = build();
    const target = interaction();
    await commands.onReact([target] as never, {
      messageLink: 'x',
      emoji: '🔥',
      pollChoiceCount: 3,
    });

    expect(messaging.reactToMessage).toHaveBeenCalledWith(
      GUILD,
      { target: { channelId: CHANNEL, messageId: MESSAGE }, emoji: '🔥', pollChoices: 3 },
      { source: 'DISCORD', userId: USER },
    );
    expect(textOf(target.editReply)).toBe(T.done);
  });

  it('adds no poll choices by default', async () => {
    const { commands, messaging, interaction } = build();
    await commands.onReact([interaction()] as never, { messageLink: 'x', emoji: '🔥' });
    expect(messaging.reactToMessage.mock.calls[0]?.[1]).toMatchObject({ pollChoices: 0 });
  });

  it('shows "Cannot react: <reason>" when Discord refuses', async () => {
    const { commands, messaging, interaction } = build();
    messaging.reactToMessage.mockRejectedValue(
      new ServiceError(ErrorCode.DISCORD_API_ERROR, { reason: 'Unknown Emoji' }),
    );
    const target = interaction();
    await commands.onReact([target] as never, { messageLink: 'x', emoji: 'nope' });
    expect(textOf(target.editReply)).toBe('Cannot react: Unknown Emoji');
  });

  it('suggests the reactions of the linked message while the emoji is typed', () => {
    const handler = Object.getOwnPropertyDescriptor(MessagingCommands.prototype, 'onReact')
      ?.value as object;
    const interceptors = Reflect.getMetadata('__interceptors__', handler) as Array<{
      name: string;
    }>;
    expect(interceptors.map((each) => each.name)).toEqual(['ReactionAutocompleteInterceptor']);
  });
});

describe('/add-poll', () => {
  it('posts a new poll message in the channel when no link is given', async () => {
    const { poll, messaging, interaction } = build();
    const target = interaction();
    await poll.onAddPoll([target] as never, { pollChoiceCount: 4 });

    expect(target.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(messaging.createReactionPoll).toHaveBeenCalledWith(
      GUILD,
      { channelId: CHANNEL, messageId: undefined, choices: 4 },
      { source: 'DISCORD', userId: USER },
    );
    expect(textOf(target.editReply)).toBe(T.done);
    expect(POLL_PLACEHOLDER_TEXT).toBe('New Poll!');
  });

  it('numbers the linked message in whichever channel it is', async () => {
    const { poll, messaging, resolver, interaction } = build();
    resolver.fetch.mockResolvedValue(found({ id: REPLY, channelId: OTHER_CHANNEL }));
    await poll.onAddPoll([interaction()] as never, { pollChoiceCount: 2, messageLink: 'link' });

    expect(messaging.createReactionPoll.mock.calls[0]?.[1]).toEqual({
      channelId: OTHER_CHANNEL,
      messageId: REPLY,
      choices: 2,
    });
  });

  it('says so when the link leads nowhere, instead of posting a new poll', async () => {
    const { poll, messaging, resolver, interaction } = build();
    resolver.fetch.mockResolvedValue({ status: 'NOT_FOUND' });
    const target = interaction();
    await poll.onAddPoll([target] as never, { pollChoiceCount: 2, messageLink: 'link' });

    expect(messaging.createReactionPoll).not.toHaveBeenCalled();
    expect(textOf(target.editReply)).toBe(MESSAGES.en.errors.DISCORD_MESSAGE_NOT_FOUND);
  });

  it('shows "Cannot add the poll: <reason>" when Discord refuses', async () => {
    const { poll, messaging, interaction } = build();
    messaging.createReactionPoll.mockRejectedValue(discordRefusal('Missing Permissions'));
    const target = interaction();
    await poll.onAddPoll([target] as never, { pollChoiceCount: 2 });
    expect(textOf(target.editReply)).toBe('Cannot add the poll: Missing Permissions');
  });
});
