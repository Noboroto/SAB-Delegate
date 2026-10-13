import 'reflect-metadata';
import { ErrorCode, type MentionResult } from '@sab/shared';
import { MessageFlags } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import type { DiscordReactionService } from '../../discord/services/discord-reaction.service.js';
import type {
  MessageResolution,
  MessageResolver,
} from '../../discord/services/message-resolver.service.js';
import type { GuildLocaleService } from '../../i18n/guild-locale.service.js';
import { translatorFor } from '../../i18n/translator.js';
import { MentionResponder } from './mention.responder.js';

type MentionInteraction = Parameters<MentionResponder['everyone']>[0];
import type { MentionService } from './mention.service.js';

const GUILD = '100000000000000001';
const CHANNEL = '100000000000000011';
const MESSAGE = '100000000000000021';
const REPLY_CHANNEL = '100000000000000012';
const REPLY_MESSAGE = '100000000000000022';
const ASKER = '100000000000000031';
const ROLE = '100000000000000041';
const LINK = `https://discord.com/channels/${GUILD}/${CHANNEL}/${MESSAGE}`;
const REPLY_LINK = `https://discord.com/channels/${GUILD}/${REPLY_CHANNEL}/${REPLY_MESSAGE}`;

const t = translatorFor('en');

const found = (id: string, channelId: string): MessageResolution => ({
  status: 'OK',
  message: { id, channelId, guildId: GUILD } as never,
});

const okResult = (over: Partial<MentionResult> = {}): MentionResult => ({
  dryRun: false,
  status: 'OK',
  count: 1,
  sample: [],
  chunks: ['<@100000000000000099>,'],
  delivered: false,
  ...over,
});

function build(over: { resolve?: Record<string, MessageResolution>; hasReaction?: boolean } = {}) {
  const mentions = {
    mentionReactors: vi.fn().mockResolvedValue(okResult()),
    mentionNonReactors: vi.fn().mockResolvedValue(okResult()),
    mentionEveryoneInThread: vi.fn().mockResolvedValue({ dryRun: false, status: 'OK', text: 'x' }),
  };
  const table: Record<string, MessageResolution> = over.resolve ?? {
    [LINK]: found(MESSAGE, CHANNEL),
    [REPLY_LINK]: found(REPLY_MESSAGE, REPLY_CHANNEL),
  };
  const resolver = {
    fetch: vi.fn((link: string) =>
      Promise.resolve(table[link] ?? ({ status: 'INVALID_LINK', reason: 'MALFORMED' } as const)),
    ),
  };
  const reactions = { hasReaction: vi.fn().mockReturnValue(over.hasReaction ?? true) };
  const locales = { resolve: vi.fn().mockResolvedValue('en') };
  const responder = new MentionResponder(
    mentions as unknown as MentionService,
    resolver as unknown as MessageResolver,
    reactions as unknown as DiscordReactionService,
    locales as unknown as GuildLocaleService,
  );

  const calls: string[] = [];
  const interaction = (guildId: string | null = GUILD) => {
    let deferred = false;
    const fake = {
      guildId,
      channelId: CHANNEL,
      locale: 'en-US',
      user: { id: ASKER },
      replied: false,
      get deferred() {
        return deferred;
      },
      deferReply: vi.fn().mockImplementation(() => {
        calls.push('deferReply');
        deferred = true;
        return Promise.resolve();
      }),
      reply: vi.fn().mockImplementation(() => {
        calls.push('reply');
        return Promise.resolve();
      }),
      editReply: vi.fn().mockImplementation(() => {
        calls.push('editReply');
        return Promise.resolve();
      }),
      followUp: vi.fn().mockImplementation(() => {
        calls.push('followUp');
        return Promise.resolve();
      }),
      deleteReply: vi.fn().mockImplementation(() => {
        calls.push('deleteReply');
        return Promise.resolve();
      }),
    };
    return fake satisfies MentionInteraction;
  };
  return { responder, mentions, resolver, reactions, interaction, calls };
}

const ephemeral = { flags: MessageFlags.Ephemeral };

describe('MentionResponder.byReaction', () => {
  const args = { messageLink: LINK, emoji: ' 👍 ' };

  it('defers publicly, asks the service as the person who ran it, then edits the list in', async () => {
    const { responder, mentions, interaction, calls } = build();
    const target = interaction();
    await responder.byReaction(target, args);

    expect(calls).toEqual(['deferReply', 'editReply']);
    expect(target.deferReply).toHaveBeenCalledWith(undefined);
    expect(mentions.mentionReactors).toHaveBeenCalledWith(
      GUILD,
      expect.objectContaining({
        channelId: CHANNEL,
        messageId: MESSAGE,
        emoji: '👍',
        locale: 'en',
        replyTo: undefined,
      }),
      { source: 'DISCORD', userId: ASKER },
      { crossGuild: true },
    );
    expect(target.editReply).toHaveBeenCalledWith({
      content: '<@100000000000000099>,',
      allowedMentions: { users: ['100000000000000099'], roles: [] },
    });
  });

  it('puts the pieces of a long list after the first, each pinging only whom it names', async () => {
    const { responder, mentions, interaction } = build();
    mentions.mentionReactors.mockResolvedValue(
      okResult({ chunks: ['<@100000000000000001>', '<@100000000000000002>'] }),
    );
    const target = interaction();
    await responder.byReaction(target, args);

    expect(target.followUp).toHaveBeenCalledWith({
      content: '<@100000000000000002>',
      allowedMentions: { users: ['100000000000000002'], roles: [] },
    });
  });

  it('answers privately with "Sent!" when the list goes to another message', async () => {
    const { responder, mentions, interaction } = build();
    mentions.mentionReactors.mockResolvedValue(okResult({ delivered: true }));
    const target = interaction();
    await responder.byReaction(target, { ...args, replyMessage: REPLY_LINK });

    expect(target.deferReply).toHaveBeenCalledWith(ephemeral);
    expect(mentions.mentionReactors).toHaveBeenCalledWith(
      GUILD,
      expect.objectContaining({ replyTo: { channelId: REPLY_CHANNEL, messageId: REPLY_MESSAGE } }),
      expect.anything(),
      expect.anything(),
    );
    expect(target.editReply).toHaveBeenCalledWith({ content: t('mention.sent') });
  });

  it('answers a link that is not a link with the reason, before deferring', async () => {
    const { responder, interaction, calls, mentions } = build();
    const target = interaction();
    await responder.byReaction(target, { ...args, messageLink: 'nonsense' });

    expect(calls).toEqual(['reply']);
    expect(target.reply).toHaveBeenCalledWith({
      content: t('errors.invalidLink.MALFORMED'),
      ...ephemeral,
    });
    expect(mentions.mentionReactors).not.toHaveBeenCalled();
  });

  it('says the reply message is missing instead of posting to the wrong place', async () => {
    const { responder, interaction, mentions } = build();
    const target = interaction();
    await responder.byReaction(target, { ...args, replyMessage: 'nonsense' });

    expect(target.reply).toHaveBeenCalledWith({
      content: t('mention.replyNotFound'),
      ...ephemeral,
    });
    expect(mentions.mentionReactors).not.toHaveBeenCalled();
  });

  it('refuses privately, before deferring, when the emoji is not on the message', async () => {
    const { responder, interaction, calls, mentions } = build({ hasReaction: false });
    await responder.byReaction(interaction(), args);

    expect(calls).toEqual(['reply']);
    expect(mentions.mentionReactors).not.toHaveBeenCalled();
  });

  it('removes the public placeholder and refuses privately when the reactors are all bots', async () => {
    const { responder, mentions, interaction, calls } = build();
    mentions.mentionReactors.mockResolvedValue(okResult({ status: 'NO_REACTORS', chunks: [] }));
    const target = interaction();
    await responder.byReaction(target, args);

    expect(calls).toEqual(['deferReply', 'deleteReply', 'followUp']);
    expect(target.followUp).toHaveBeenCalledWith({
      content: t('mention.noReactors'),
      ...ephemeral,
    });
  });

  it('edits a private placeholder instead of removing it', async () => {
    const { responder, mentions, interaction, calls } = build();
    mentions.mentionReactors.mockResolvedValue(okResult({ status: 'NO_REACTORS', chunks: [] }));
    await responder.byReaction(interaction(), { ...args, replyMessage: REPLY_LINK });
    expect(calls).toEqual(['deferReply', 'editReply']);
  });

  it('tells the person why Discord refused the reply', async () => {
    const { responder, mentions, interaction } = build();
    mentions.mentionReactors.mockResolvedValue(
      okResult({ status: 'SEND_FAILED', failure: 'Missing Permissions', chunks: ['x'] }),
    );
    const target = interaction();
    await responder.byReaction(target, { ...args, replyMessage: REPLY_LINK });
    expect(target.editReply).toHaveBeenCalledWith({
      content: t('mention.sendFailed', { reason: 'Missing Permissions' }),
    });
  });

  it('needs a server', async () => {
    const { responder, interaction } = build();
    await expect(responder.byReaction(interaction(null), args)).rejects.toMatchObject({
      code: ErrorCode.GUILD_NOT_FOUND,
    });
  });
});

describe('MentionResponder.notReact', () => {
  const args = { messageLink: LINK };

  it('lists publicly by default and passes the options through', async () => {
    const { responder, mentions, interaction } = build();
    const target = interaction();
    await responder.notReact(target, {
      ...args,
      roleId: ROLE,
      includeBots: true,
      onlyInChannel: false,
      content: 'hi',
    });

    expect(target.deferReply).toHaveBeenCalledWith(undefined);
    expect(mentions.mentionNonReactors).toHaveBeenCalledWith(
      GUILD,
      expect.objectContaining({
        roleId: ROLE,
        includeBots: true,
        onlyInChannel: false,
        content: 'hi',
        reply: false,
      }),
      expect.anything(),
      { crossGuild: true },
    );
  });

  it('replies to the message and answers privately when is-reply is set', async () => {
    const { responder, mentions, interaction } = build();
    mentions.mentionNonReactors.mockResolvedValue(okResult({ delivered: true }));
    const target = interaction();
    await responder.notReact(target, { ...args, isReply: true });

    expect(target.deferReply).toHaveBeenCalledWith(ephemeral);
    expect(mentions.mentionNonReactors).toHaveBeenCalledWith(
      GUILD,
      expect.objectContaining({ reply: true }),
      expect.anything(),
      expect.anything(),
    );
    expect(target.editReply).toHaveBeenCalledWith({ content: t('mention.sent') });
  });

  it('leaves the good news public', async () => {
    const { responder, mentions, interaction, calls } = build();
    mentions.mentionNonReactors.mockResolvedValue(
      okResult({ status: 'ALL_REACTED', chunks: [], count: 0 }),
    );
    const target = interaction();
    await responder.notReact(target, args);

    expect(calls).toEqual(['deferReply', 'editReply']);
    expect(target.editReply).toHaveBeenCalledWith({ content: t('mention.allReacted') });
  });

  it('refuses voice and stage channels privately', async () => {
    const { responder, mentions, interaction, calls } = build();
    mentions.mentionNonReactors.mockResolvedValue(
      okResult({ status: 'UNSUPPORTED_CHANNEL', chunks: [], count: 0 }),
    );
    const target = interaction();
    await responder.notReact(target, args);

    expect(calls).toEqual(['deferReply', 'deleteReply', 'followUp']);
    expect(target.followUp).toHaveBeenCalledWith({
      content: t('mention.unsupportedChannel'),
      ...ephemeral,
    });
  });
});

describe('MentionResponder.notReactOf (context menu)', () => {
  it('uses the clicked message and the slash command’s defaults, with no link to read', async () => {
    const { responder, mentions, resolver, interaction } = build();
    const target = interaction();
    await responder.notReactOf(target, { guildId: GUILD, channelId: CHANNEL, id: MESSAGE });

    expect(resolver.fetch).not.toHaveBeenCalled();
    expect(target.deferReply).toHaveBeenCalledWith(undefined);
    expect(mentions.mentionNonReactors).toHaveBeenCalledWith(
      GUILD,
      {
        channelId: CHANNEL,
        messageId: MESSAGE,
        content: undefined,
        roleId: undefined,
        includeBots: undefined,
        onlyInChannel: undefined,
        reply: false,
        locale: 'en',
      },
      { source: 'DISCORD', userId: ASKER },
      { crossGuild: true },
    );
  });
});

describe('MentionResponder.everyone', () => {
  it('answers privately with "Sent!" and asks about the channel the command ran in', async () => {
    const { responder, mentions, interaction, calls } = build();
    const target = interaction();
    await responder.everyone(target, { content: 'Meeting' });

    expect(calls).toEqual(['deferReply', 'editReply']);
    expect(target.deferReply).toHaveBeenCalledWith(ephemeral);
    expect(mentions.mentionEveryoneInThread).toHaveBeenCalledWith(
      GUILD,
      { threadId: CHANNEL, content: 'Meeting', replyTo: undefined, locale: 'en' },
      { source: 'DISCORD', userId: ASKER },
      { crossGuild: true },
    );
    expect(target.editReply).toHaveBeenCalledWith({ content: t('mention.sent') });
  });

  it('says it only works in a thread', async () => {
    const { responder, mentions, interaction } = build();
    mentions.mentionEveryoneInThread.mockResolvedValue({
      dryRun: false,
      status: 'NOT_A_THREAD',
      text: '',
    });
    const target = interaction();
    await responder.everyone(target, {});
    expect(target.editReply).toHaveBeenCalledWith({ content: t('mention.notAThread') });
  });

  it('does not post to the thread when the message to reply to cannot be found', async () => {
    const { responder, mentions, interaction } = build();
    const target = interaction();
    await responder.everyone(target, { replyMessage: 'nonsense' });

    expect(target.reply).toHaveBeenCalledWith({
      content: t('mention.replyNotFound'),
      ...ephemeral,
    });
    expect(mentions.mentionEveryoneInThread).not.toHaveBeenCalled();
  });
});
