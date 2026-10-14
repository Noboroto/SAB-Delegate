import 'reflect-metadata';
import { ErrorCode, type EditBotMessageResult } from '@sab/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceError } from '../../common/errors/service-error.js';
import { GuildActionLimiter } from '../../common/limiter/guild-action.limiter.js';
import { MessagingService } from '../../modules/messaging/messaging.service.js';
import {
  HARNESS_GUILD,
  HARNESS_GUILD_NAME,
  HARNESS_KEY,
  HARNESS_USER,
  startMcp,
} from '../mcp.test-harness.js';
import { checkToolRow } from '../tool-definition.js';
import { MESSAGE_TOOLS } from './message.tools.js';

const CHANNEL = '444444444444444451';
const MESSAGE = '444444444444444461';
const OTHER_GUILD = '444444444444444442';

const asDryRun = (opts: unknown): boolean => (opts as { dryRun?: boolean }).dryRun === true;

function fakeMessaging() {
  return {
    sendMessage: vi.fn(
      (_guild: string, input: { channelId: string; content: string }, _a: unknown, opts: unknown) =>
        Promise.resolve({
          channelId: input.channelId,
          messageId: asDryRun(opts) ? null : MESSAGE,
          replyToMessageId: null,
          content: input.content,
          pings: [],
          dryRun: asDryRun(opts),
        }),
    ),
    editBotMessage: vi.fn(
      (
        _guild: string,
        input: { target: { channelId: string; messageId: string }; content: string },
        _a: unknown,
        opts: unknown,
      ) =>
        Promise.resolve<EditBotMessageResult>({
          status: 'EDITED',
          ...input.target,
          content: input.content,
          dryRun: asDryRun(opts),
        }),
    ),
    createReactionPoll: vi.fn(
      (_guild: string, input: { channelId: string; choices: number }, _a: unknown, opts: unknown) =>
        Promise.resolve({
          channelId: input.channelId,
          messageId: asDryRun(opts) ? null : MESSAGE,
          created: true,
          emojis: ['1️⃣', '2️⃣'],
          dryRun: asDryRun(opts),
        }),
    ),
  };
}

type Mcp = Awaited<ReturnType<typeof startMcp>>;

describe('message tools', () => {
  let messaging: ReturnType<typeof fakeMessaging>;
  let limiter: { consume: ReturnType<typeof vi.fn> };
  let mcp: Mcp;

  const start = async (mode: 'READ' | 'WRITE' = 'WRITE') => {
    mcp = await startMcp({
      rows: MESSAGE_TOOLS,
      mode,
      services: new Map<never, unknown>([
        [MessagingService as never, messaging],
        [GuildActionLimiter as never, limiter],
      ]),
      guilds: { [HARNESS_GUILD]: HARNESS_GUILD_NAME },
    });
  };

  beforeEach(async () => {
    messaging = fakeMessaging();
    limiter = { consume: vi.fn() };
    await start();
  });
  afterEach(async () => {
    await mcp.close();
  });

  const tokenOf = async (name: string, args: Record<string, unknown>): Promise<string> => {
    const preview = await mcp.call(name, { ...args, dryRun: true });
    return (preview.json() as { data: { confirmToken: string } }).data.confirmToken;
  };

  it('pass the registry row rules', () => {
    const classes = new Map<string, { prototype: object }>([
      [MessagingService.name, MessagingService],
    ]);
    expect(MESSAGE_TOOLS.flatMap((row) => checkToolRow(row, classes))).toEqual([]);
  });

  it('hide every tool from a READ key and show all three to a WRITE key', async () => {
    expect([...mcp.registeredTools].sort()).toEqual([
      'message_edit',
      'message_send',
      'poll_create',
    ]);
    await mcp.close();
    await start('READ');
    expect(mcp.registeredTools.size).toBe(0);
  });

  describe('message_send', () => {
    const args = (extra: Record<string, unknown> = {}) => ({
      guildId: HARNESS_GUILD,
      channelId: CHANNEL,
      content: 'Hello everyone',
      ...extra,
    });

    it('previews with the MCP actor, issues a token, and posts nothing nor spends the budget', async () => {
      const reply = await mcp.call('message_send', args({ dryRun: true }));
      expect(reply.failed).toBe(false);
      expect(messaging.sendMessage).toHaveBeenCalledWith(
        HARNESS_GUILD,
        { channelId: CHANNEL, content: 'Hello everyone' },
        expect.objectContaining({ source: 'MCP', userId: HARNESS_USER, apiKeyId: HARNESS_KEY }),
        { dryRun: true },
      );
      expect(limiter.consume).not.toHaveBeenCalled();
      expect(reply.json()).toMatchObject({
        data: {
          dryRun: true,
          confirmToken: expect.any(String) as string,
          preview: { messageId: null },
        },
      });
    });

    it('posts with the token and spends the message budget', async () => {
      const confirmToken = await tokenOf('message_send', args());
      const reply = await mcp.call('message_send', args({ confirmToken }));
      expect(reply.failed).toBe(false);
      expect(limiter.consume).toHaveBeenCalledWith(HARNESS_GUILD, 'message');
      expect(messaging.sendMessage).toHaveBeenLastCalledWith(
        HARNESS_GUILD,
        expect.anything(),
        expect.anything(),
        { dryRun: false },
      );
      expect(reply.json()).toMatchObject({ data: { messageId: MESSAGE, dryRun: false } });
    });

    it('refuses without a token, naming the server, and posts nothing', async () => {
      const reply = await mcp.call('message_send', args());
      expect(reply.failed).toBe(true);
      expect(reply.text).toContain(`"${HARNESS_GUILD_NAME}" (${HARNESS_GUILD})`);
      expect(messaging.sendMessage).not.toHaveBeenCalled();
    });

    it('turns replyToMessageId into a reply inside the named channel', async () => {
      await mcp.call('message_send', args({ replyToMessageId: MESSAGE, dryRun: true }));
      expect(messaging.sendMessage.mock.calls[0]?.[1]).toEqual({
        channelId: CHANNEL,
        content: 'Hello everyone',
        replyTo: { channelId: CHANNEL, messageId: MESSAGE },
      });
    });

    it('never forwards allowedMentions: the text cannot ping', async () => {
      await mcp.call(
        'message_send',
        args({ content: '@everyone hi', allowedMentions: { parse: ['everyone'] }, dryRun: true }),
      );
      expect(messaging.sendMessage.mock.calls[0]?.[1]).not.toHaveProperty('allowedMentions');
    });

    it('relays the refusal of a channel in another server', async () => {
      messaging.sendMessage.mockRejectedValueOnce(
        new ServiceError(ErrorCode.DISCORD_CHANNEL_NOT_FOUND),
      );
      const reply = await mcp.call('message_send', args({ dryRun: true }));
      expect(reply.failed).toBe(true);
      expect(reply.text).toContain('DISCORD_CHANNEL_NOT_FOUND');
      expect(mcp.tokens.size).toBe(0);
    });

    it('answers a server the person cannot manage with GUILD_NOT_FOUND', async () => {
      const reply = await mcp.call('message_send', args({ guildId: OTHER_GUILD, dryRun: true }));
      expect(reply.failed).toBe(true);
      expect(reply.text).toContain('GUILD_NOT_FOUND');
      expect(messaging.sendMessage).not.toHaveBeenCalled();
    });

    it.each([
      ['blank text', { content: '   ' }],
      ['text over 2000 characters', { content: 'x'.repeat(2001) }],
      ['a reply target that is not a snowflake', { replyToMessageId: 'abc' }],
    ])('rejects %s', async (_label, extra) => {
      const reply = await mcp.call('message_send', args({ dryRun: true, ...extra }));
      expect(reply.failed).toBe(true);
      expect(messaging.sendMessage).not.toHaveBeenCalled();
    });

    it('stops at the guild budget before posting', async () => {
      const confirmToken = await tokenOf('message_send', args());
      limiter.consume.mockImplementationOnce(() => {
        throw new ServiceError(ErrorCode.RATE_LIMITED);
      });
      messaging.sendMessage.mockClear();
      const reply = await mcp.call('message_send', args({ confirmToken }));
      expect(reply.failed).toBe(true);
      expect(reply.text).toContain('RATE_LIMITED');
      expect(messaging.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe('message_edit', () => {
    const args = (extra: Record<string, unknown> = {}) => ({
      guildId: HARNESS_GUILD,
      channelId: CHANNEL,
      messageId: MESSAGE,
      content: 'Corrected',
      ...extra,
    });

    it('previews and edits through the target shape the service takes', async () => {
      const confirmToken = await tokenOf('message_edit', args());
      expect(messaging.editBotMessage).toHaveBeenCalledWith(
        HARNESS_GUILD,
        { target: { channelId: CHANNEL, messageId: MESSAGE }, content: 'Corrected' },
        expect.objectContaining({ source: 'MCP' }),
        { dryRun: true },
      );
      const reply = await mcp.call('message_edit', args({ confirmToken }));
      expect(reply.failed).toBe(false);
      expect(limiter.consume).toHaveBeenCalledOnce();
      expect(reply.json()).toMatchObject({ data: { status: 'EDITED', dryRun: false } });
    });

    it('reports a message of another author as NOT_BOT_MESSAGE', async () => {
      messaging.editBotMessage.mockResolvedValueOnce({
        status: 'NOT_BOT_MESSAGE',
        channelId: CHANNEL,
        messageId: MESSAGE,
        content: null,
        dryRun: true,
      });
      const reply = await mcp.call('message_edit', args({ dryRun: true }));
      expect(reply.json()).toMatchObject({ data: { preview: { status: 'NOT_BOT_MESSAGE' } } });
    });

    it('refuses without a token', async () => {
      const reply = await mcp.call('message_edit', args());
      expect(reply.failed).toBe(true);
      expect(messaging.editBotMessage).not.toHaveBeenCalled();
    });
  });

  describe('poll_create', () => {
    const args = (extra: Record<string, unknown> = {}) => ({
      guildId: HARNESS_GUILD,
      channelId: CHANNEL,
      choices: 2,
      ...extra,
    });

    it('previews, then starts a new poll with the token', async () => {
      const confirmToken = await tokenOf('poll_create', args());
      expect(messaging.createReactionPoll.mock.calls[0]?.[1]).toEqual({
        channelId: CHANNEL,
        choices: 2,
      });
      const reply = await mcp.call('poll_create', args({ confirmToken }));
      expect(reply.failed).toBe(false);
      expect(limiter.consume).toHaveBeenCalledWith(HARNESS_GUILD, 'message');
      expect(reply.json()).toMatchObject({ data: { created: true, messageId: MESSAGE } });
    });

    it('passes an existing message through', async () => {
      await mcp.call('poll_create', args({ messageId: MESSAGE, dryRun: true }));
      expect(messaging.createReactionPoll.mock.calls[0]?.[1]).toEqual({
        channelId: CHANNEL,
        messageId: MESSAGE,
        choices: 2,
      });
    });

    it.each([0, 1, 11, 2.5])('rejects %s choices', async (choices) => {
      const reply = await mcp.call('poll_create', args({ choices, dryRun: true }));
      expect(reply.failed).toBe(true);
      expect(messaging.createReactionPoll).not.toHaveBeenCalled();
    });

    it('accepts the largest poll', async () => {
      const reply = await mcp.call('poll_create', args({ choices: 10, dryRun: true }));
      expect(reply.failed).toBe(false);
    });

    it('refuses without a token', async () => {
      const reply = await mcp.call('poll_create', args());
      expect(reply.failed).toBe(true);
      expect(messaging.createReactionPoll).not.toHaveBeenCalled();
    });
  });
});
