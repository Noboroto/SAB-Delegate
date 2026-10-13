import 'reflect-metadata';
import { ErrorCode, MESSAGES } from '@sab/shared';
import { DiscordjsErrorCodes, MessageFlags } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import type { GuildLocaleService } from '../../i18n/guild-locale.service.js';
import { CANCEL_BUTTON_ID, CONFIRM_BUTTON_ID } from '../../discord/helpers/confirm-buttons.js';
import { ThreadCommands } from './thread.commands.js';
import type { ThreadService } from './thread.service.js';

const GUILD = '100000000000000001';
const CHANNEL = '200000000000000001';
const OTHER_CHANNEL = '200000000000000002';
const USER = '300000000000000001';
const THREAD = '500000000000000001';

type Answer = 'confirm' | 'cancel' | 'timeout';

function build(answer: Answer = 'confirm') {
  const threads = {
    create: vi.fn(),
    renameByPrefix: vi.fn(),
    deleteByPrefix: vi.fn(),
  };
  const locales = { resolve: vi.fn().mockResolvedValue('en') };
  const commands = new ThreadCommands(
    threads as unknown as ThreadService,
    locales as unknown as GuildLocaleService,
  );

  const click = {
    customId: answer === 'confirm' ? CONFIRM_BUTTON_ID : CANCEL_BUTTON_ID,
    user: { id: USER },
    update: vi.fn().mockResolvedValue(undefined),
  };
  const prompt = {
    awaitMessageComponent: vi.fn(() =>
      answer === 'timeout'
        ? Promise.reject(
            Object.assign(new Error('time'), {
              code: DiscordjsErrorCodes.InteractionCollectorError,
            }),
          )
        : Promise.resolve(click),
    ),
  };
  const interaction = {
    guildId: GUILD as string | null,
    channelId: CHANNEL,
    locale: 'en-US',
    user: { id: USER },
    replied: false,
    deferred: false,
    deferReply: vi.fn(() => {
      interaction.deferred = true;
      return Promise.resolve();
    }),
    editReply: vi.fn().mockResolvedValue(prompt),
    deleteReply: vi.fn().mockResolvedValue(undefined),
    followUp: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
  };
  return { commands, threads, interaction, click };
}

const lastText = (interaction: { editReply: { mock: { calls: unknown[][] } } }) =>
  (interaction.editReply.mock.calls.at(-1)![0] as { content: string }).content;

describe('/thread create', () => {
  const options = {
    name: 'Planning',
    message: 'Hello',
    isPrivate: undefined,
    destination: undefined,
  };

  it('answers publicly, in this channel by default, with the invoker in the byline', async () => {
    const { commands, threads, interaction } = build();
    threads.create.mockResolvedValue({ status: 'CREATED', threadId: THREAD });

    await commands.onCreate([interaction] as never, options);

    expect(interaction.deferReply).toHaveBeenCalledWith();
    expect(threads.create).toHaveBeenCalledWith(
      GUILD,
      {
        channelId: CHANNEL,
        name: 'Planning',
        message: 'Hello',
        isPrivate: false,
        byline: `<@${USER}> created this thread.`,
      },
      { source: 'DISCORD', userId: USER },
    );
    expect(lastText(interaction)).toBe(`Created thread <#${THREAD}>.`);
  });

  it('uses the chosen destination and the private flag', async () => {
    const { commands, threads, interaction } = build();
    threads.create.mockResolvedValue({ status: 'CREATED', threadId: THREAD });

    await commands.onCreate([interaction] as never, {
      ...options,
      isPrivate: true,
      destination: { id: OTHER_CHANNEL },
    });

    expect(threads.create.mock.calls[0]![1]).toMatchObject({
      channelId: OTHER_CHANNEL,
      isPrivate: true,
    });
  });

  it('replaces the public placeholder with a private refusal', async () => {
    const { commands, threads, interaction } = build();
    threads.create.mockResolvedValue({ status: 'PRIVATE_NEEDS_TEXT_CHANNEL', threadId: null });

    await commands.onCreate([interaction] as never, options);

    expect(interaction.deleteReply).toHaveBeenCalled();
    expect(interaction.followUp).toHaveBeenCalledWith({
      content: MESSAGES.en.thread.create.PRIVATE_NEEDS_TEXT_CHANNEL,
      flags: MessageFlags.Ephemeral,
    });
  });

  it('explains a channel that cannot hold threads', async () => {
    const { commands, threads, interaction } = build();
    threads.create.mockResolvedValue({ status: 'CHANNEL_CANNOT_HOLD_THREADS', threadId: null });

    await commands.onCreate([interaction] as never, options);

    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ content: MESSAGES.en.thread.create.CHANNEL_CANNOT_HOLD_THREADS }),
    );
  });

  it('is refused outside a server before anything is deferred', async () => {
    const { commands, interaction } = build();
    interaction.guildId = null;

    await expect(commands.onCreate([interaction] as never, options)).rejects.toMatchObject({
      code: ErrorCode.GUILD_NOT_FOUND,
    });
    expect(interaction.deferReply).not.toHaveBeenCalled();
  });
});

describe('/thread edit-prefix', () => {
  const options = { oldPrefix: ' A- ', newPrefix: 'Z-', destination: undefined };

  it('answers privately with the count and a line per failure', async () => {
    const { commands, threads, interaction } = build();
    threads.renameByPrefix.mockResolvedValue({
      status: 'OK',
      count: 3,
      done: 1,
      failures: [
        { threadId: THREAD, name: 'A-bad', reason: 'NAME_INVALID' },
        { threadId: THREAD, name: 'A-locked', reason: 'Missing Permissions' },
      ],
    });

    await commands.onEditPrefix([interaction] as never, options);

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(threads.renameByPrefix.mock.calls[0]![1]).toEqual({
      channelId: CHANNEL,
      oldPrefix: ' A- ',
      newPrefix: 'Z-',
    });
    const text = lastText(interaction);
    expect(text).toContain('Done 1 thread(s)!');
    expect(text).toContain('Failed 2:');
    expect(text).toContain(`A-bad: ${MESSAGES.en.thread.prefix.NAME_INVALID}`);
    expect(text).toContain('A-locked: Missing Permissions');
  });

  it('says when no active thread matches', async () => {
    const { commands, threads, interaction } = build();
    threads.renameByPrefix.mockResolvedValue({ status: 'OK', count: 0, done: 0, failures: [] });

    await commands.onEditPrefix([interaction] as never, options);

    expect(lastText(interaction)).toBe(`No active thread in <#${CHANNEL}> starts with \`A-\`.`);
  });

  it('says when the channel has no threads to list', async () => {
    const { commands, threads, interaction } = build();
    threads.renameByPrefix.mockResolvedValue({
      status: 'CHANNEL_CANNOT_HOLD_THREADS',
      count: 0,
      done: 0,
      failures: [],
    });

    await commands.onEditPrefix([interaction] as never, options);

    expect(lastText(interaction)).toBe(MESSAGES.en.thread.prefix.CHANNEL_CANNOT_HOLD_THREADS);
  });
});

describe('/thread remove-by-prefix', () => {
  const options = { prefix: 'Old-', destination: undefined };
  const plan = {
    status: 'OK',
    count: 12,
    invalid: 0,
    sample: [
      { threadId: THREAD, name: 'Old-a' },
      { threadId: THREAD, name: 'Old-b' },
    ],
  };

  it('previews, asks with the names, and deletes only after Confirm', async () => {
    const { commands, threads, interaction, click } = build('confirm');
    threads.deleteByPrefix.mockImplementation(
      (_g: string, _i: unknown, _a: unknown, opts: { dryRun: boolean }) =>
        Promise.resolve(opts.dryRun ? plan : { status: 'OK', count: 12, done: 12, failures: [] }),
    );

    await commands.onRemoveByPrefix([interaction] as never, options);

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(threads.deleteByPrefix).toHaveBeenCalledTimes(2);
    expect(threads.deleteByPrefix.mock.calls[0]![3]).toEqual({ dryRun: true });
    expect(threads.deleteByPrefix.mock.calls[1]![3]).toEqual({ dryRun: false });

    const prompt = (interaction.editReply.mock.calls[0]![0] as { content: string }).content;
    expect(prompt).toContain('Delete 12 active threads');
    expect(prompt).toContain('- Old-a');
    expect(prompt).toContain('- Old-b');
    expect(prompt).toContain('...and 10 more');
    expect(click.update).toHaveBeenCalledWith({
      content: MESSAGES.en.thread.delete.working,
      components: [],
    });
    expect(lastText(interaction)).toBe('Done 12 thread(s)!');
  });

  it('deletes nothing after Cancel', async () => {
    const { commands, threads, interaction } = build('cancel');
    threads.deleteByPrefix.mockResolvedValue(plan);

    await commands.onRemoveByPrefix([interaction] as never, options);

    expect(threads.deleteByPrefix).toHaveBeenCalledTimes(1);
  });

  it('deletes nothing when nobody answers', async () => {
    const { commands, threads, interaction } = build('timeout');
    threads.deleteByPrefix.mockResolvedValue(plan);

    await commands.onRemoveByPrefix([interaction] as never, options);

    expect(threads.deleteByPrefix).toHaveBeenCalledTimes(1);
    expect(lastText(interaction)).toBe(MESSAGES.en.purge.confirm.expired);
  });

  it('does not ask when no active thread matches', async () => {
    const { commands, threads, interaction } = build('confirm');
    threads.deleteByPrefix.mockResolvedValue({ ...plan, count: 0, sample: [] });

    await commands.onRemoveByPrefix([interaction] as never, options);

    expect(threads.deleteByPrefix).toHaveBeenCalledTimes(1);
    expect(lastText(interaction)).toBe(`No active thread in <#${CHANNEL}> starts with \`Old-\`.`);
    expect(interaction.editReply).toHaveBeenCalledTimes(1);
  });
});
