import 'reflect-metadata';
import { AUDIT_ACTIONS, ErrorCode, POLL_EMOJIS, type ActorContext } from '@sab/shared';
import type { Client } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import type { AuditService } from '../../common/audit/audit.service.js';
import type { ChannelAccessService } from '../../discord/services/channel-access.service.js';
import { MessagingService } from './messaging.service.js';

const GUILD = '100000000000000001';
const OTHER_GUILD = '100000000000000009';
const CHANNEL = '200000000000000001';
const OTHER_CHANNEL = '200000000000000002';
const MESSAGE = '300000000000000001';
const SENT = '300000000000000002';
const REPLY = '300000000000000003';
const BOT = '400000000000000001';
const USER = '400000000000000002';

const SLASH: ActorContext = { source: 'DISCORD', userId: USER };
const API: ActorContext = {
  source: 'HTTP',
  userId: USER,
  apiKeyId: '018f4c3e-0000-7000-8000-000000000000',
};

const discordError = (code: number, message: string) => Object.assign(new Error(message), { code });

function build(
  options: {
    channelGuild?: string | null;
    author?: string;
    content?: string;
    files?: string[];
    access?: 'ok' | 'not-found' | 'missing-permissions';
  } = {},
) {
  const message = {
    id: MESSAGE,
    channelId: CHANNEL,
    author: { id: options.author ?? BOT },
    content: options.content ?? 'old text',
    attachments: new Map((options.files ?? []).map((url) => [url, { url }])),
    react: vi.fn().mockResolvedValue(undefined),
    edit: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue({ id: REPLY }),
    delete: vi.fn().mockResolvedValue(undefined),
  };
  const channel = {
    id: CHANNEL,
    guildId: options.channelGuild === undefined ? GUILD : options.channelGuild,
    isTextBased: () => true,
    isSendable: () => true,
    send: vi.fn().mockResolvedValue({
      ...message,
      id: SENT,
      react: message.react,
      delete: message.delete,
    }),
    sendTyping: vi.fn().mockResolvedValue(undefined),
    messages: { fetch: vi.fn().mockResolvedValue(message) },
  };
  const client = {
    user: { id: BOT },
    channels: { fetch: vi.fn().mockResolvedValue(channel) },
  };
  const access = { check: vi.fn().mockResolvedValue(options.access ?? 'ok') };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new MessagingService(
    client as unknown as Client,
    access as unknown as ChannelAccessService,
    audit as unknown as AuditService,
  );
  return { service, message, channel, client, access, audit };
}

const target = { channelId: CHANNEL, messageId: MESSAGE };

describe('MessagingService.sendMessage', () => {
  it('posts to the channel, lets a slash command mention as it always could, and audits', async () => {
    const { service, channel, audit } = build();
    const result = await service.sendMessage(
      GUILD,
      { channelId: CHANNEL, content: 'hello @everyone' },
      SLASH,
    );

    expect(channel.send).toHaveBeenCalledWith({
      content: 'hello @everyone',
      allowedMentions: { parse: ['users', 'roles', 'everyone'], repliedUser: true },
    });
    expect(result).toMatchObject({ channelId: CHANNEL, messageId: SENT, dryRun: false });
    expect(result.pings).toEqual(['@everyone']);
    expect(audit.record).toHaveBeenCalledWith({
      guildId: GUILD,
      actor: SLASH,
      action: AUDIT_ACTIONS.messageSend,
      params: { channelId: CHANNEL, messageId: SENT, kind: 'send' },
    });
  });

  it('never lets the API or MCP mention anybody', async () => {
    const { service, channel } = build();
    const result = await service.sendMessage(
      GUILD,
      { channelId: CHANNEL, content: '@everyone <@&300000000000000099>' },
      API,
    );

    expect(channel.send).toHaveBeenCalledWith({
      content: '@everyone <@&300000000000000099>',
      allowedMentions: { parse: [] },
    });
    expect(result.pings).toEqual([]);
  });

  it('replies where the replied-to message is, not in the destination', async () => {
    const { service, channel, message, client } = build();
    const result = await service.sendMessage(
      GUILD,
      { channelId: OTHER_CHANNEL, content: 'answer', replyTo: target },
      SLASH,
    );

    expect(client.channels.fetch).toHaveBeenCalledWith(CHANNEL);
    expect(channel.send).not.toHaveBeenCalled();
    expect(message.reply).toHaveBeenCalledWith(expect.objectContaining({ content: 'answer' }));
    expect(result).toMatchObject({
      channelId: CHANNEL,
      messageId: REPLY,
      replyToMessageId: MESSAGE,
    });
  });

  it('plans without sending or auditing on a dry run', async () => {
    const { service, channel, message, audit } = build();
    const result = await service.sendMessage(
      GUILD,
      { channelId: CHANNEL, content: 'preview', replyTo: target },
      API,
      { dryRun: true },
    );

    expect(result).toEqual({
      channelId: CHANNEL,
      messageId: null,
      replyToMessageId: MESSAGE,
      content: 'preview',
      pings: [],
      dryRun: true,
    });
    expect(channel.send).not.toHaveBeenCalled();
    expect(message.reply).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('refuses blank and over-long text', async () => {
    const { service, channel } = build();
    for (const content of ['', '  \n', 'a'.repeat(2001)]) {
      await expect(
        service.sendMessage(GUILD, { channelId: CHANNEL, content }, SLASH),
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
    }
    expect(channel.send).not.toHaveBeenCalled();
  });

  it('keeps an API caller to its own server, answering as for a missing channel', async () => {
    const { service, channel } = build({ channelGuild: OTHER_GUILD });

    await expect(
      service.sendMessage(GUILD, { channelId: CHANNEL, content: 'x' }, API),
    ).rejects.toMatchObject({ code: ErrorCode.DISCORD_CHANNEL_NOT_FOUND });
    expect(channel.send).not.toHaveBeenCalled();
  });

  it('keeps an API caller out of a direct message too', async () => {
    const { service } = build({ channelGuild: null });
    await expect(
      service.sendMessage(GUILD, { channelId: CHANNEL, content: 'x' }, API),
    ).rejects.toMatchObject({ code: ErrorCode.DISCORD_CHANNEL_NOT_FOUND });
  });

  it('lets a slash command reach a message in another server, as the old bot did', async () => {
    const { service, channel } = build({ channelGuild: OTHER_GUILD });
    await service.sendMessage(GUILD, { channelId: CHANNEL, content: 'x' }, SLASH);
    expect(channel.send).toHaveBeenCalledOnce();
  });

  it('sends into a direct message when the command ran in one', async () => {
    const { service, channel, access } = build({ channelGuild: null });
    await service.sendMessage(null, { channelId: CHANNEL, content: 'x' }, SLASH);
    expect(channel.send).toHaveBeenCalledOnce();
    expect(access.check).not.toHaveBeenCalled();
  });

  it('says which kind of problem it is when the bot may not post', async () => {
    const { service, channel } = build({ access: 'missing-permissions' });
    await expect(
      service.sendMessage(GUILD, { channelId: CHANNEL, content: 'x' }, SLASH),
    ).rejects.toMatchObject({
      code: ErrorCode.DISCORD_MISSING_PERMISSIONS,
      params: { permission: 'send' },
    });
    expect(channel.send).not.toHaveBeenCalled();
  });

  it('carries Discord’s own reason when the send is refused', async () => {
    const { service, channel } = build();
    channel.send.mockRejectedValue(discordError(50013, 'Missing Permissions'));

    await expect(
      service.sendMessage(GUILD, { channelId: CHANNEL, content: 'x' }, SLASH),
    ).rejects.toMatchObject({
      code: ErrorCode.DISCORD_MISSING_PERMISSIONS,
      params: { permission: 'send', reason: 'Missing Permissions' },
    });
  });

  it('lets an error that is not Discord’s through untouched', async () => {
    const { service, channel } = build();
    const fault = new TypeError('fetch failed');
    channel.send.mockRejectedValue(fault);

    await expect(
      service.sendMessage(GUILD, { channelId: CHANNEL, content: 'x' }, SLASH),
    ).rejects.toBe(fault);
  });

  it('does not report a sent message as failed when the audit row cannot be written', async () => {
    const { service, audit } = build();
    audit.record.mockRejectedValue(new Error('db down'));

    await expect(
      service.sendMessage(GUILD, { channelId: CHANNEL, content: 'x' }, SLASH),
    ).resolves.toMatchObject({ messageId: SENT });
  });

  it('says the message is missing when the replied-to one is gone', async () => {
    const { service, channel } = build();
    channel.messages.fetch.mockRejectedValue(discordError(10008, 'Unknown Message'));

    await expect(
      service.sendMessage(GUILD, { channelId: CHANNEL, content: 'x', replyTo: target }, SLASH),
    ).rejects.toMatchObject({ code: ErrorCode.DISCORD_MESSAGE_NOT_FOUND });
  });
});

describe('MessagingService.copyMessage', () => {
  it('sends the text and the files of the source', async () => {
    const { service, channel, audit } = build({
      content: 'original',
      files: ['https://cdn.example/a.png'],
    });
    const result = await service.copyMessage(
      GUILD,
      { source: target, channelId: OTHER_CHANNEL },
      SLASH,
    );

    expect(channel.sendTyping).toHaveBeenCalled();
    expect(channel.send).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'original',
        files: [{ url: 'https://cdn.example/a.png' }],
      }),
    );
    expect(result).toEqual({ status: 'COPIED', channelId: OTHER_CHANNEL, messageId: SENT });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AUDIT_ACTIONS.messageCopy,
        params: { channelId: OTHER_CHANNEL, messageId: SENT, targetId: MESSAGE },
      }),
    );
  });

  it('copies a message that has only a file', async () => {
    const { service, channel } = build({ content: '', files: ['https://cdn.example/a.png'] });
    await service.copyMessage(GUILD, { source: target, channelId: CHANNEL }, SLASH);
    expect(channel.send).toHaveBeenCalledOnce();
  });

  it('sends nothing when the source has neither text nor file', async () => {
    const { service, channel, audit } = build({ content: '' });
    const result = await service.copyMessage(GUILD, { source: target, channelId: CHANNEL }, SLASH);

    expect(result).toEqual({ status: 'NOTHING_TO_COPY', channelId: CHANNEL, messageId: null });
    expect(channel.send).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('does not let an API caller copy out of another server', async () => {
    const { service, channel, client } = build();
    const foreign = { ...channel, id: OTHER_CHANNEL, guildId: OTHER_GUILD };
    client.channels.fetch.mockImplementation((id: string) =>
      Promise.resolve(id === OTHER_CHANNEL ? foreign : channel),
    );

    await expect(
      service.copyMessage(
        GUILD,
        { source: { channelId: OTHER_CHANNEL, messageId: MESSAGE }, channelId: CHANNEL },
        API,
      ),
    ).rejects.toMatchObject({ code: ErrorCode.DISCORD_CHANNEL_NOT_FOUND });
    expect(channel.send).not.toHaveBeenCalled();
  });
});

describe('MessagingService.editBotMessage', () => {
  it('edits the text of the bot’s own message and audits', async () => {
    const { service, message, audit } = build();
    const result = await service.editBotMessage(GUILD, { target, content: 'new text' }, SLASH);

    expect(message.edit).toHaveBeenCalledWith({
      content: 'new text',
      allowedMentions: { parse: ['users', 'roles', 'everyone'], repliedUser: true },
    });
    expect(result).toEqual({ status: 'EDITED', ...target, content: 'new text', dryRun: false });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AUDIT_ACTIONS.messageEdit,
        params: { channelId: CHANNEL, messageId: MESSAGE, kind: 'content' },
      }),
    );
  });

  it('leaves a message by anyone else alone', async () => {
    const { service, message, audit } = build({ author: USER });
    const result = await service.editBotMessage(GUILD, { target, content: 'x' }, SLASH);

    expect(result.status).toBe('NOT_BOT_MESSAGE');
    expect(message.edit).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('refuses blank new text', async () => {
    const { service, message } = build();
    await expect(
      service.editBotMessage(GUILD, { target, content: '   ' }, SLASH),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
    expect(message.edit).not.toHaveBeenCalled();
  });

  it('reports what would change on a dry run without editing or auditing', async () => {
    const { service, message, audit } = build();
    const result = await service.editBotMessage(GUILD, { target, content: 'next' }, API, {
      dryRun: true,
    });

    expect(result).toEqual({ status: 'EDITED', ...target, content: 'next', dryRun: true });
    expect(message.edit).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('still tells a foreign author on a dry run', async () => {
    const { service } = build({ author: USER });
    const result = await service.editBotMessage(GUILD, { target, content: 'x' }, API, {
      dryRun: true,
    });
    expect(result).toMatchObject({ status: 'NOT_BOT_MESSAGE', dryRun: true });
  });
});

describe('MessagingService.editBotMessageFromCopy', () => {
  it('rewrites the bot message with the text and files of the source', async () => {
    const { service, message } = build({ content: 'source', files: ['https://cdn.example/b.png'] });
    const result = await service.editBotMessageFromCopy(
      GUILD,
      { target, source: { channelId: CHANNEL, messageId: SENT } },
      SLASH,
    );

    expect(message.edit).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'source', files: [{ url: 'https://cdn.example/b.png' }] }),
    );
    expect(result.status).toBe('EDITED');
  });

  it('checks the author before the copy', async () => {
    const { service, message } = build({ author: USER, content: '' });
    const result = await service.editBotMessageFromCopy(GUILD, { target, source: target }, SLASH);
    expect(result.status).toBe('NOT_BOT_MESSAGE');
    expect(message.edit).not.toHaveBeenCalled();
  });

  it('edits nothing when the source has nothing to copy', async () => {
    const { service, message } = build({ content: '' });
    const result = await service.editBotMessageFromCopy(GUILD, { target, source: target }, SLASH);
    expect(result.status).toBe('NOTHING_TO_COPY');
    expect(message.edit).not.toHaveBeenCalled();
  });
});

describe('MessagingService.reactToMessage', () => {
  it('reacts with the emoji and then the numbers, in order', async () => {
    const { service, message, audit } = build();
    const result = await service.reactToMessage(
      GUILD,
      { target, emoji: ' 🔥 ', pollChoices: 3 },
      SLASH,
    );

    expect(message.react.mock.calls.map(([emoji]) => emoji as string)).toEqual([
      '🔥',
      POLL_EMOJIS[0],
      POLL_EMOJIS[1],
      POLL_EMOJIS[2],
    ]);
    expect(result).toEqual({ ...target, count: 4 });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AUDIT_ACTIONS.messageReact,
        params: { ...target, emoji: '🔥', count: 4 },
      }),
    );
  });

  it('reacts once when no poll choices are asked for', async () => {
    const { service, message } = build();
    await service.reactToMessage(GUILD, { target, emoji: '👍' }, SLASH);
    expect(message.react).toHaveBeenCalledTimes(1);
  });

  it('stops at the first refusal and passes Discord’s reason on', async () => {
    const { service, message, audit } = build();
    message.react.mockRejectedValueOnce(discordError(10014, 'Unknown Emoji'));

    await expect(
      service.reactToMessage(GUILD, { target, emoji: 'nope', pollChoices: 2 }, SLASH),
    ).rejects.toMatchObject({
      code: ErrorCode.DISCORD_API_ERROR,
      params: { reason: 'Unknown Emoji' },
    });
    expect(message.react).toHaveBeenCalledTimes(1);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('refuses more than ten poll choices', async () => {
    const { service } = build();
    await expect(
      service.reactToMessage(GUILD, { target, emoji: 'x', pollChoices: 11 }, SLASH),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
  });
});

describe('MessagingService.createReactionPoll', () => {
  it('posts a new message and numbers it when none is named', async () => {
    const { service, channel, message, audit } = build();
    const result = await service.createReactionPoll(
      GUILD,
      { channelId: CHANNEL, choices: 3 },
      SLASH,
    );

    expect(channel.send).toHaveBeenCalledWith({
      content: 'New Poll!',
      allowedMentions: { parse: [] },
    });
    expect(message.react.mock.calls.map(([emoji]) => emoji as string)).toEqual(
      POLL_EMOJIS.slice(0, 3),
    );
    expect(result).toEqual({
      channelId: CHANNEL,
      messageId: SENT,
      created: true,
      emojis: POLL_EMOJIS.slice(0, 3),
      dryRun: false,
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AUDIT_ACTIONS.pollCreate,
        params: { channelId: CHANNEL, messageId: SENT, count: 3, kind: 'new' },
      }),
    );
  });

  it('numbers an existing message without posting', async () => {
    const { service, channel, message } = build();
    const result = await service.createReactionPoll(
      GUILD,
      { channelId: CHANNEL, messageId: MESSAGE, choices: 2 },
      SLASH,
    );

    expect(channel.send).not.toHaveBeenCalled();
    expect(message.react).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ messageId: MESSAGE, created: false });
  });

  it('plans without posting, reacting or auditing on a dry run', async () => {
    const { service, channel, message, audit } = build();
    const fresh = await service.createReactionPoll(GUILD, { channelId: CHANNEL, choices: 2 }, API, {
      dryRun: true,
    });
    const existing = await service.createReactionPoll(
      GUILD,
      { channelId: CHANNEL, messageId: MESSAGE, choices: 2 },
      API,
      { dryRun: true },
    );

    expect(fresh).toMatchObject({ messageId: null, created: true, dryRun: true });
    expect(existing).toMatchObject({ messageId: MESSAGE, created: false, dryRun: true });
    expect(channel.send).not.toHaveBeenCalled();
    expect(message.react).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('removes the message it posted when the reactions are refused', async () => {
    const { service, message, audit } = build();
    message.react.mockRejectedValue(discordError(50013, 'Missing Permissions'));

    await expect(
      service.createReactionPoll(GUILD, { channelId: CHANNEL, choices: 2 }, SLASH),
    ).rejects.toMatchObject({ code: ErrorCode.DISCORD_MISSING_PERMISSIONS });
    expect(message.delete).toHaveBeenCalledOnce();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('never removes a message it did not post', async () => {
    const { service, message } = build();
    message.react.mockRejectedValue(discordError(50013, 'Missing Permissions'));

    await expect(
      service.createReactionPoll(
        GUILD,
        { channelId: CHANNEL, messageId: MESSAGE, choices: 2 },
        SLASH,
      ),
    ).rejects.toBeDefined();
    expect(message.delete).not.toHaveBeenCalled();
  });

  it('refuses zero and eleven choices', async () => {
    const { service } = build();
    for (const choices of [0, 11]) {
      await expect(
        service.createReactionPoll(GUILD, { channelId: CHANNEL, choices }, SLASH),
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
    }
  });

  it('holds an API caller to its server', async () => {
    const { service, channel } = build({ channelGuild: OTHER_GUILD });
    await expect(
      service.createReactionPoll(GUILD, { channelId: CHANNEL, choices: 2 }, API),
    ).rejects.toMatchObject({ code: ErrorCode.DISCORD_CHANNEL_NOT_FOUND });
    expect(channel.send).not.toHaveBeenCalled();
  });
});
