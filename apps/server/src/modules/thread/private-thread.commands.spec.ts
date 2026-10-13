import 'reflect-metadata';
import { MESSAGES } from '@sab/shared';
import { MessageFlags } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import type { GuildLocaleService } from '../../i18n/guild-locale.service.js';
import { PrivateThreadCommands } from './private-thread.commands.js';
import type { PrivateThreadService } from './private-thread.service.js';

const GUILD = '100000000000000001';
const CHANNEL = '200000000000000001';
const OTHER_CHANNEL = '200000000000000002';
const USER = '300000000000000001';
const ALICE = '300000000000000002';
const BOB = '300000000000000003';
const MESSAGE = '400000000000000001';

function build() {
  const service = { createPrivateThreads: vi.fn(), createPrivateThreadsFromReactors: vi.fn() };
  const locales = { resolve: vi.fn().mockResolvedValue('en') };
  const commands = new PrivateThreadCommands(
    service as unknown as PrivateThreadService,
    locales as unknown as GuildLocaleService,
  );
  const interaction = {
    guildId: GUILD,
    channelId: CHANNEL,
    locale: 'en-US',
    user: { id: USER },
    replied: false,
    deferred: false,
    deferReply: vi.fn(() => {
      interaction.deferred = true;
      return Promise.resolve();
    }),
    editReply: vi.fn().mockResolvedValue(undefined),
    followUp: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
  };
  return { commands, service, interaction };
}

const ok = (created: number, total: number, failures: unknown[] = []) => ({
  status: 'OK',
  linkProblem: null,
  total,
  created,
  failures,
});
const none = (status: string, linkProblem: string | null = null) => ({
  status,
  linkProblem,
  total: 0,
  created: 0,
  failures: [],
});

const text = (interaction: { editReply: { mock: { calls: unknown[][] } } }) =>
  (interaction.editReply.mock.calls.at(-1)![0] as { content: string }).content;

describe('/private-thread list', () => {
  it('reads ids out of mentions and free text, defers privately, and uses the default message', async () => {
    const { commands, service, interaction } = build();
    service.createPrivateThreads.mockResolvedValue(ok(2, 2));

    await commands.onList([interaction] as never, {
      prefix: 'Team',
      ids: `<@${ALICE}>, <@!${BOB}> ${ALICE} <@&600000000000000001> nonsense 123`,
    });

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(service.createPrivateThreads).toHaveBeenCalledWith(
      GUILD,
      {
        channelId: CHANNEL,
        prefix: 'Team',
        message: MESSAGES.en.thread.privateThread.defaultMessage,
        userIds: [ALICE, BOB],
      },
      { source: 'DISCORD', userId: USER },
    );
    expect(text(interaction)).toBe('Done 2/2 thread(s)!');
  });

  it('adds a role and a chosen destination and message', async () => {
    const { commands, service, interaction } = build();
    service.createPrivateThreads.mockResolvedValue(ok(1, 1));

    await commands.onList([interaction] as never, {
      prefix: 'Team',
      role: { id: '600000000000000001' },
      message: 'Hi',
      destination: { id: OTHER_CHANNEL },
    });

    expect(service.createPrivateThreads.mock.calls[0]![1]).toEqual({
      channelId: OTHER_CHANNEL,
      prefix: 'Team',
      message: 'Hi',
      userIds: [],
      roleId: '600000000000000001',
    });
  });

  it('asks for ids or a role when there is nothing to work from', async () => {
    const { commands, service, interaction } = build();

    await commands.onList([interaction] as never, { prefix: 'Team', ids: 'no ids here' });

    expect(service.createPrivateThreads).not.toHaveBeenCalled();
    expect(text(interaction)).toBe(MESSAGES.en.thread.privateThread.needsIdsOrRole);
  });

  it('lists each failure by member in plain words', async () => {
    const { commands, service, interaction } = build();
    service.createPrivateThreads.mockResolvedValue(
      ok(1, 3, [
        { userId: ALICE, reason: 'MEMBER_NOT_FOUND' },
        { userId: BOB, reason: 'Missing Permissions' },
      ]),
    );

    await commands.onList([interaction] as never, { prefix: 'Team', ids: ALICE });

    const reply = text(interaction);
    expect(reply).toContain('Done 1/3 thread(s)!');
    expect(reply).toContain(`<@${ALICE}>: ${MESSAGES.en.thread.privateThread.MEMBER_NOT_FOUND}`);
    expect(reply).toContain(`<@${BOB}>: Missing Permissions`);
  });

  it('explains a channel that is not a text channel and a role with no members', async () => {
    const { commands, service, interaction } = build();

    service.createPrivateThreads.mockResolvedValueOnce(none('CHANNEL_NOT_TEXT'));
    await commands.onList([interaction] as never, { prefix: 'Team', ids: ALICE });
    expect(text(interaction)).toBe(MESSAGES.en.thread.privateThread.CHANNEL_NOT_TEXT);

    service.createPrivateThreads.mockResolvedValueOnce(none('NO_MEMBERS'));
    await commands.onList([interaction] as never, { prefix: 'Team', ids: ALICE });
    expect(text(interaction)).toBe(MESSAGES.en.thread.privateThread.noMembers);
  });
});

describe('/private-thread by-reaction', () => {
  const options = {
    prefix: 'Team',
    messageLink: `https://discord.com/channels/${GUILD}/${CHANNEL}/${MESSAGE}`,
    emoji: ' 👍 ',
  };

  it('passes the message as a channel/message pair so a bare id means this channel', async () => {
    const { commands, service, interaction } = build();
    service.createPrivateThreadsFromReactors.mockResolvedValue(ok(2, 2));

    await commands.onByReaction([interaction] as never, { ...options, messageLink: MESSAGE });

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(service.createPrivateThreadsFromReactors).toHaveBeenCalledWith(
      GUILD,
      {
        channelId: CHANNEL,
        prefix: 'Team',
        message: MESSAGES.en.thread.privateThread.defaultMessage,
        messageLink: `${CHANNEL}/${MESSAGE}`,
        emoji: ' 👍 ',
      },
      { source: 'DISCORD', userId: USER },
    );
  });

  it('says nobody reacted with that emoji instead of "Done 0"', async () => {
    const { commands, service, interaction } = build();
    service.createPrivateThreadsFromReactors.mockResolvedValue(none('NO_MEMBERS'));

    await commands.onByReaction([interaction] as never, options);

    expect(text(interaction)).toBe(
      `Nobody reacted to that message with 👍, so no thread was created.`,
    );
  });

  it('explains a link that could not be used', async () => {
    const { commands, service, interaction } = build();

    service.createPrivateThreadsFromReactors.mockResolvedValueOnce(
      none('INVALID_LINK', 'MALFORMED'),
    );
    await commands.onByReaction([interaction] as never, { ...options, messageLink: 'nope' });
    expect(text(interaction)).toBe(MESSAGES.en.errors.invalidLink.MALFORMED);

    service.createPrivateThreadsFromReactors.mockResolvedValueOnce(none('MESSAGE_NOT_FOUND'));
    await commands.onByReaction([interaction] as never, options);
    expect(text(interaction)).toBe(MESSAGES.en.thread.privateThread.MESSAGE_NOT_FOUND);

    service.createPrivateThreadsFromReactors.mockResolvedValueOnce(none('NO_ACCESS'));
    await commands.onByReaction([interaction] as never, options);
    expect(text(interaction)).toBe(MESSAGES.en.thread.privateThread.NO_ACCESS);
  });
});
