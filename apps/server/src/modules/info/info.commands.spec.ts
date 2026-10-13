import 'reflect-metadata';
import { ErrorCode, MESSAGES } from '@sab/shared';
import { MessageFlags } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import type { GuildLocaleService } from '../../i18n/guild-locale.service.js';
import type { DiscordReactionService } from '../../discord/services/discord-reaction.service.js';
import type { MessageResolver } from '../../discord/services/message-resolver.service.js';
import { ServiceError } from '../../common/errors/service-error.js';
import { InfoCommands } from './info.commands.js';
import type { InfoService } from './info.service.js';

const GUILD = '100000000000000001';
const USER = '100000000000000002';
const CHANNEL = '200000000000000001';
const MESSAGE_URL = `https://discord.com/channels/${GUILD}/${CHANNEL}/300000000000000001`;
const LINK = MESSAGE_URL;
const REACTORS = ['400000000000000001', USER, '400000000000000003'];

const failsWith = (code: ErrorCode): unknown =>
  expect.objectContaining({ name: 'ServiceError', code });

function build(locale: 'vi' | 'en' = 'en') {
  const info = {
    getIntroduction: vi.fn(),
    listReactorIds: vi.fn().mockResolvedValue({ url: MESSAGE_URL, emoji: '👍', userIds: REACTORS }),
    listRoleMemberIds: vi.fn().mockResolvedValue({
      roleId: '500000000000000001',
      roleName: 'Mentors',
      userIds: REACTORS,
    }),
    createInvite: vi.fn().mockResolvedValue({
      url: 'https://discord.gg/abc',
      channelId: CHANNEL,
      channelName: 'general',
    }),
  };
  const message = {
    guildId: GUILD,
    channelId: CHANNEL,
    id: '300000000000000001',
    url: MESSAGE_URL,
    reply: vi.fn().mockResolvedValue(undefined),
    channel: { send: vi.fn().mockResolvedValue(undefined) },
  };
  const resolver = { fetch: vi.fn().mockResolvedValue({ status: 'OK', message }) };
  const reactions = { hasReaction: vi.fn().mockReturnValue(true) };
  const locales = { resolve: vi.fn().mockResolvedValue(locale) };
  const commands = new InfoCommands(
    info as unknown as InfoService,
    resolver as unknown as MessageResolver,
    reactions as unknown as DiscordReactionService,
    locales as unknown as GuildLocaleService,
  );
  const interaction = (guildId: string | null = GUILD) => {
    const target = {
      guildId,
      channelId: CHANNEL,
      locale: 'en',
      user: { id: USER, username: 'an', send: vi.fn().mockResolvedValue(undefined) },
      replied: false,
      deferred: false,
      reply: vi.fn().mockResolvedValue(undefined),
      deferReply: vi.fn().mockImplementation(() => {
        target.deferred = true;
        return Promise.resolve();
      }),
      editReply: vi.fn().mockResolvedValue(undefined),
      deleteReply: vi.fn().mockResolvedValue(undefined),
      followUp: vi.fn().mockResolvedValue(undefined),
    };
    return target;
  };
  return { commands, info, message, resolver, reactions, interaction };
}

const contentOf = (mock: { mock: { calls: unknown[][] } }, call = 0) =>
  (mock.mock.calls[call]?.[0] as { content: string }).content;

describe('/get intro', () => {
  const OPTIONS = { user: { id: '400000000000000009' } };

  it('defers, then links the introduction publicly', async () => {
    const { commands, info, interaction } = build();
    info.getIntroduction.mockResolvedValue({
      status: 'FOUND',
      channelId: CHANNEL,
      messageId: '300000000000000001',
      url: MESSAGE_URL,
      content: 'Hello, I am an',
    });
    const target = interaction();
    await commands.onIntro([target] as never, OPTIONS);

    expect(target.deferReply).toHaveBeenCalledWith();
    expect(info.getIntroduction).toHaveBeenCalledWith(GUILD, { userId: OPTIONS.user.id });
    const content = contentOf(target.editReply);
    expect(content).toContain(`[introduction](${MESSAGE_URL})`);
    expect(content).toContain(`<@${OPTIONS.user.id}>`);
    expect(content).toContain('Hello, I am an');
  });

  it('says the member has no introduction in the part that was searched', async () => {
    const { commands, info, interaction } = build();
    info.getIntroduction.mockResolvedValue({ status: 'NOT_FOUND', scanned: 10_000 });
    const target = interaction();
    await commands.onIntro([target] as never, OPTIONS);
    expect(contentOf(target.editReply)).toContain('10,000');
  });

  it('turns the public placeholder into a private answer when no intro channel is set', async () => {
    const { commands, info, interaction } = build();
    info.getIntroduction.mockResolvedValue({ status: 'NO_CHANNEL' });
    const target = interaction();
    await commands.onIntro([target] as never, OPTIONS);

    expect(target.deleteReply).toHaveBeenCalledTimes(1);
    expect(target.followUp).toHaveBeenCalledWith({
      content: MESSAGES.en.info.intro.noChannel,
      flags: MessageFlags.Ephemeral,
    });
    expect(target.editReply).not.toHaveBeenCalled();
  });

  it.each([[ErrorCode.DISCORD_CHANNEL_NOT_FOUND], [ErrorCode.DISCORD_MISSING_PERMISSIONS]])(
    'says the intro channel cannot be read, in the old words, for %s',
    async (code) => {
      const { commands, info, interaction } = build();
      info.getIntroduction.mockRejectedValue(new ServiceError(code));
      const target = interaction();
      await commands.onIntro([target] as never, OPTIONS);

      expect(contentOf(target.editReply)).toBe(
        "Cannot read the introduction channel, check the bot's permissions.",
      );
    },
  );

  it('leaves other failures to the error filter', async () => {
    const { commands, info, interaction } = build();
    info.getIntroduction.mockRejectedValue(new TypeError('boom'));
    await expect(commands.onIntro([interaction()] as never, OPTIONS)).rejects.toThrow(TypeError);
  });

  it('splits a long introduction into messages of at most 2000 characters', async () => {
    const { commands, info, interaction } = build();
    info.getIntroduction.mockResolvedValue({
      status: 'FOUND',
      channelId: CHANNEL,
      messageId: '300000000000000001',
      url: MESSAGE_URL,
      content: Array.from({ length: 200 }, (_, index) => `line ${index} ${'x'.repeat(30)}`).join(
        '\n',
      ),
    });
    const target = interaction();
    await commands.onIntro([target] as never, OPTIONS);
    const pieces = [
      contentOf(target.editReply),
      ...target.followUp.mock.calls.map((call) => (call[0] as { content: string }).content),
    ];
    expect(pieces.length).toBeGreaterThan(1);
    for (const piece of pieces) expect(piece.length).toBeLessThanOrEqual(2000);
  });

  it('has no server to search when run in a direct message', async () => {
    const { commands, interaction } = build();
    await expect(commands.onIntro([interaction(null)] as never, OPTIONS)).rejects.toEqual(
      failsWith(ErrorCode.GUILD_NOT_FOUND),
    );
  });
});

describe('/get id-by-reaction', () => {
  const OPTIONS = { messageLink: LINK, emoji: ' 👍 ' };

  it('lists the ids publicly, one per line, under a header that links the message', async () => {
    const { commands, info, interaction } = build();
    const target = interaction();
    await commands.onIdByReaction([target] as never, OPTIONS);

    expect(target.deferReply).toHaveBeenCalledWith({});
    expect(info.listReactorIds).toHaveBeenCalledWith(GUILD, {
      channelId: CHANNEL,
      messageId: '300000000000000001',
      emoji: '👍',
    });
    const sent = target.editReply.mock.calls[0]?.[0] as {
      content: string;
      allowedMentions?: unknown;
    };
    expect(sent.content).toBe(
      [
        `3 users [reacted to the message](${MESSAGE_URL}) with 👍:`,
        ...REACTORS.map((id) => `${id},`),
      ].join('\n'),
    );
    // Plain ids mention nobody.
    expect(sent.allowedMentions).toBeUndefined();
  });

  it('mentions the people, marks the caller, and lets only those mentions notify', async () => {
    const { commands, interaction } = build();
    const target = interaction();
    await commands.onIdByReaction([target] as never, {
      ...OPTIONS,
      mention: true,
      content: 'Please check in',
    });
    const sent = target.editReply.mock.calls[0]?.[0] as {
      content: string;
      allowedMentions: { users: string[] };
    };
    expect(sent.content).toContain(`<@${REACTORS[0]}>,`);
    expect(sent.content).toContain(`<@${USER}> (author),`);
    expect(sent.content.endsWith('\n\nPlease check in')).toBe(true);
    expect(sent.allowedMentions.users).toEqual(REACTORS);
  });

  it('never lets text typed into content notify anybody', async () => {
    const { commands, interaction } = build();
    const target = interaction();
    await commands.onIdByReaction([target] as never, {
      ...OPTIONS,
      mention: true,
      content: '<@999999999999999999> @everyone',
    });
    const sent = target.editReply.mock.calls[0]?.[0] as { allowedMentions: { users: string[] } };
    expect(sent.allowedMentions.users).not.toContain('999999999999999999');
  });

  it('splits a long list, each piece naming at most 100 people and staying within 2000 characters', async () => {
    const { commands, info, interaction } = build();
    const many = Array.from({ length: 400 }, (_, index) => `6${String(index).padStart(17, '0')}`);
    info.listReactorIds.mockResolvedValue({ url: MESSAGE_URL, emoji: '👍', userIds: many });
    const target = interaction();
    await commands.onIdByReaction([target] as never, { ...OPTIONS, mention: true });

    const pieces = [
      target.editReply.mock.calls[0]?.[0],
      ...target.followUp.mock.calls.map((call): unknown => call[0]),
    ] as Array<{ content: string; allowedMentions: { users: string[] } }>;
    expect(pieces.length).toBeGreaterThan(1);
    for (const piece of pieces) {
      expect(piece.content.length).toBeLessThanOrEqual(2000);
      expect(piece.allowedMentions.users.length).toBeLessThanOrEqual(100);
    }
    const covered = new Set(pieces.flatMap((piece) => piece.allowedMentions.users));
    expect(covered.size).toBe(many.length);
  });

  it('sends the list as a reply to another message and keeps the answer private', async () => {
    const { commands, resolver, message, interaction } = build();
    const replyTo = {
      reply: vi.fn().mockResolvedValue(undefined),
      channel: { send: vi.fn().mockResolvedValue(undefined) },
    };
    resolver.fetch
      .mockResolvedValueOnce({ status: 'OK', message })
      .mockResolvedValueOnce({ status: 'OK', message: replyTo });
    const target = interaction();
    await commands.onIdByReaction([target] as never, { ...OPTIONS, replyMessage: 'reply-link' });

    expect(target.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(replyTo.reply).toHaveBeenCalledTimes(1);
    expect(contentOf(replyTo.reply)).toContain(REACTORS[0]);
    expect(contentOf(target.editReply)).toBe(MESSAGES.en.info.reactors.sent);
  });

  it('tells the caller, without the error text, when it cannot reply there', async () => {
    const { commands, resolver, message, interaction } = build();
    const replyTo = {
      reply: vi.fn().mockRejectedValue(new Error('Missing Permissions: secret detail')),
      channel: { send: vi.fn() },
    };
    resolver.fetch
      .mockResolvedValueOnce({ status: 'OK', message })
      .mockResolvedValueOnce({ status: 'OK', message: replyTo });
    const target = interaction();
    await commands.onIdByReaction([target] as never, { ...OPTIONS, replyMessage: 'reply-link' });

    expect(contentOf(target.editReply)).toBe(MESSAGES.en.info.reactors.replyFailed);
    expect(contentOf(target.editReply)).not.toContain('secret');
  });

  it('refuses privately when the message to reply to cannot be found', async () => {
    const { commands, resolver, message, interaction } = build();
    resolver.fetch
      .mockResolvedValueOnce({ status: 'OK', message })
      .mockResolvedValueOnce({ status: 'NOT_FOUND' });
    const target = interaction();
    await commands.onIdByReaction([target] as never, { ...OPTIONS, replyMessage: 'reply-link' });
    expect(target.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(target.deleteReply).not.toHaveBeenCalled();
    expect(contentOf(target.editReply)).toBe(MESSAGES.en.info.reactors.replyNotFound);
  });

  it('defers before it reads either link, which can outlast the 3 s window', async () => {
    const { commands, resolver, message, interaction } = build();
    resolver.fetch
      .mockResolvedValueOnce({ status: 'OK', message })
      .mockResolvedValueOnce({ status: 'OK', message });
    const target = interaction();
    await commands.onIdByReaction([target] as never, { ...OPTIONS, replyMessage: 'reply-link' });

    const deferredAt = target.deferReply.mock.invocationCallOrder[0] ?? Infinity;
    expect(resolver.fetch).toHaveBeenCalledTimes(2);
    for (const read of resolver.fetch.mock.invocationCallOrder) {
      expect(deferredAt).toBeLessThan(read);
    }
  });

  it('replaces the public placeholder with a private refusal for an emoji nobody used', async () => {
    const { commands, reactions, info, interaction } = build();
    reactions.hasReaction.mockReturnValue(false);
    const target = interaction();
    await commands.onIdByReaction([target] as never, OPTIONS);
    expect(info.listReactorIds).not.toHaveBeenCalled();
    expect(target.deleteReply).toHaveBeenCalledTimes(1);
    expect(target.followUp).toHaveBeenCalledWith({
      content: MESSAGES.en.info.reactors.none,
      flags: MessageFlags.Ephemeral,
    });
  });

  it('explains a bad link by what is wrong with it', async () => {
    const { commands, resolver, interaction } = build();
    resolver.fetch.mockResolvedValue({ status: 'INVALID_LINK', reason: 'MALFORMED' });
    const target = interaction();
    await commands.onIdByReaction([target] as never, OPTIONS);
    expect(target.followUp).toHaveBeenCalledWith({
      content: MESSAGES.en.errors.invalidLink.MALFORMED,
      flags: MessageFlags.Ephemeral,
    });
  });

  it('lets the error filter answer for a message that does not exist or cannot be read', async () => {
    const missing = build();
    missing.resolver.fetch.mockResolvedValue({ status: 'NOT_FOUND' });
    await expect(
      missing.commands.onIdByReaction([missing.interaction()] as never, OPTIONS),
    ).rejects.toEqual(failsWith(ErrorCode.DISCORD_MESSAGE_NOT_FOUND));
    const denied = build();
    denied.resolver.fetch.mockResolvedValue({ status: 'NO_ACCESS' });
    await expect(
      denied.commands.onIdByReaction([denied.interaction()] as never, OPTIONS),
    ).rejects.toEqual(failsWith(ErrorCode.DISCORD_MISSING_PERMISSIONS));
  });

  it('works from a direct message: a link needs no server of its own', async () => {
    const { commands, info, interaction } = build();
    await commands.onIdByReaction([interaction(null)] as never, OPTIONS);
    expect(info.listReactorIds).toHaveBeenCalled();
  });
});

describe('/get id-by-role', () => {
  const ROLE = { id: '500000000000000001' };

  it('lists the ids publicly with no permission check of its own', async () => {
    const { commands, info, interaction } = build();
    const target = interaction();
    await commands.onIdByRole([target] as never, { role: ROLE });

    expect(target.deferReply).toHaveBeenCalledWith();
    expect(info.listRoleMemberIds).toHaveBeenCalledWith(GUILD, { roleId: ROLE.id });
    expect(contentOf(target.editReply)).toBe(
      ['3 users in Mentors:', ...REACTORS.map((id) => `${id},`)].join('\n'),
    );
  });

  it('narrows to the channel the command runs in when asked', async () => {
    const { commands, info, interaction } = build();
    await commands.onIdByRole([interaction()] as never, { role: ROLE, inThisChannel: true });
    expect(info.listRoleMemberIds).toHaveBeenCalledWith(GUILD, {
      roleId: ROLE.id,
      channelId: CHANNEL,
    });
  });

  it('answers in Vietnamese for a Vietnamese server', async () => {
    const { commands, interaction } = build('vi');
    const target = interaction();
    await commands.onIdByRole([target] as never, { role: ROLE });
    expect(contentOf(target.editReply).split('\n')[0]).toBe('3 người trong Mentors:');
  });
});

describe('/get invite-link', () => {
  it('defers privately, makes the invite and sends it by direct message', async () => {
    const { commands, info, interaction } = build();
    const target = interaction();
    await commands.onInviteLink([target] as never, { channel: null });

    expect(target.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(info.createInvite).toHaveBeenCalledWith(
      GUILD,
      { channelId: CHANNEL, reason: 'Requested by an' },
      { source: 'DISCORD', userId: USER },
    );
    expect(target.user.send).toHaveBeenCalledWith(
      'Invite link for `general` is https://discord.gg/abc',
    );
    expect(contentOf(target.editReply)).toBe(MESSAGES.en.info.invite.sent);
  });

  it('invites to the channel that was chosen', async () => {
    const { commands, info, interaction } = build();
    await commands.onInviteLink([interaction()] as never, {
      channel: { id: '200000000000000007' },
    });
    expect(info.createInvite.mock.calls[0]?.[1]).toMatchObject({ channelId: '200000000000000007' });
  });

  it('shows the link in the private answer when the direct message cannot be sent', async () => {
    const { commands, interaction } = build();
    const target = interaction();
    target.user.send.mockRejectedValue(new Error('Cannot send messages to this user'));
    await commands.onInviteLink([target] as never, {});
    const content = contentOf(target.editReply);
    expect(content).toContain('https://discord.gg/abc');
    expect(content).not.toContain('Cannot send messages');
  });

  it('has no server to invite to when run in a direct message', async () => {
    const { commands, interaction } = build();
    await expect(commands.onInviteLink([interaction(null)] as never, {})).rejects.toEqual(
      failsWith(ErrorCode.GUILD_NOT_FOUND),
    );
  });
});
