import 'reflect-metadata';
import { ErrorCode, MESSAGES, PURGE_RANGE_MAX, type PurgePlan } from '@sab/shared';
import { DiscordjsErrorCodes } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import type { GuildLocaleService } from '../../i18n/guild-locale.service.js';
import { CANCEL_BUTTON_ID, CONFIRM_BUTTON_ID } from '../../discord/helpers/confirm-buttons.js';
import { PurgeFlow } from './purge.flow.js';
import type { PurgeService } from './purge.service.js';

const GUILD = '100000000000000001';
const CHANNEL = '200000000000000001';
const OTHER_CHANNEL = '200000000000000002';
const USER = '300000000000000001';
const UNTIL = '400000000000000001';
const FROM = '400000000000000009';

const link = (message: string, channel = CHANNEL) =>
  `https://discord.com/channels/${GUILD}/${channel}/${message}`;

const plan = (overrides: Partial<PurgePlan> = {}): PurgePlan => ({
  status: 'OK',
  count: 3,
  fromMessageId: '400000000000000007',
  olderCount: 0,
  sample: [],
  ...overrides,
});

type Answer = 'confirm' | 'cancel' | 'timeout';

function build(answer: Answer = 'confirm', plans: PurgePlan = plan()) {
  const purge = {
    purgeRange: vi.fn((_g: string, _i: unknown, _a: unknown, opts?: { dryRun?: boolean }) =>
      Promise.resolve(
        opts?.dryRun === true ? plans : { status: 'OK', count: 3, deleted: 3, failed: 0 },
      ),
    ),
    purgeLast: vi.fn((_g: string, _i: unknown, _a: unknown, opts?: { dryRun?: boolean }) =>
      Promise.resolve(
        opts?.dryRun === true ? plans : { status: 'OK', count: 5, deleted: 4, failed: 1 },
      ),
    ),
  };
  const locales = { resolve: vi.fn().mockResolvedValue('en') };
  const flow = new PurgeFlow(
    purge as unknown as PurgeService,
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
    editReply: vi.fn().mockResolvedValue(prompt),
    followUp: vi.fn().mockResolvedValue(undefined),
  };
  return { flow, purge, interaction, click };
}

const shown = (interaction: { editReply: { mock: { calls: unknown[][] } } }, call = -1) => {
  const calls = interaction.editReply.mock.calls;
  return (calls.at(call)?.[0] as { content: string }).content;
};

describe('PurgeFlow.runCommand: what was asked', () => {
  it('asks for until-link or count when neither is given', async () => {
    const { flow, interaction, purge } = build();
    await flow.runCommand(interaction, {});
    expect(shown(interaction)).toBe(MESSAGES.en.purge.needsUntilOrCount);
    expect(purge.purgeRange).not.toHaveBeenCalled();
  });

  it('refuses until-link together with count, and from-link together with count', async () => {
    const both = build();
    await both.flow.runCommand(both.interaction, { untilLink: link(UNTIL), count: 5 });
    expect(shown(both.interaction)).toBe(MESSAGES.en.purge.untilAndCountConflict);

    const fromCount = build();
    await fromCount.flow.runCommand(fromCount.interaction, { fromLink: link(FROM), count: 5 });
    expect(shown(fromCount.interaction)).toBe(MESSAGES.en.purge.fromWithCount);
    expect(both.purge.purgeLast).not.toHaveBeenCalled();
  });

  it('explains a link that is not a message link', async () => {
    const { flow, interaction, purge } = build();
    await flow.runCommand(interaction, { untilLink: 'not a link' });
    expect(shown(interaction)).toBe(MESSAGES.en.errors.invalidLink.MALFORMED);
    expect(purge.purgeRange).not.toHaveBeenCalled();
  });

  it('only touches the channel where the command runs', async () => {
    const { flow, interaction, purge } = build();
    await flow.runCommand(interaction, { untilLink: link(UNTIL, OTHER_CHANNEL) });
    expect(shown(interaction)).toBe(MESSAGES.en.purge.wrongChannel);

    await flow.runCommand(interaction, {
      untilLink: link(UNTIL),
      fromLink: link(FROM, OTHER_CHANNEL),
    });
    expect(shown(interaction)).toBe(MESSAGES.en.purge.wrongChannel);
    expect(purge.purgeRange).not.toHaveBeenCalled();
  });

  it('is refused outside a server', async () => {
    const { flow, interaction } = build();
    interaction.guildId = null;
    await expect(flow.runCommand(interaction, { count: 3 })).rejects.toMatchObject({
      code: ErrorCode.GUILD_NOT_FOUND,
    });
  });
});

describe('PurgeFlow: preview, confirmation, deletion', () => {
  it('previews, asks, and on Confirm deletes with the start pinned to the newest previewed message', async () => {
    const { flow, purge, interaction, click } = build('confirm');
    await flow.runCommand(interaction, { untilLink: link(UNTIL) });

    expect(purge.purgeRange).toHaveBeenCalledTimes(2);
    const [, previewInput, , previewOpts] = purge.purgeRange.mock.calls[0]!;
    expect(previewOpts).toEqual({ dryRun: true });
    expect(previewInput).toMatchObject({ channelId: CHANNEL, untilMessageId: UNTIL });

    const [, runInput, runActor, runOpts] = purge.purgeRange.mock.calls[1]!;
    expect(runOpts).toEqual({ dryRun: false });
    expect(runInput).toMatchObject({ untilMessageId: UNTIL, fromMessageId: '400000000000000007' });
    expect(runActor).toEqual({ source: 'DISCORD', userId: USER });

    expect(interaction.editReply.mock.calls[0]![0]).toMatchObject({
      content: expect.stringContaining('Delete 3 messages') as string,
    });
    expect(click.update).toHaveBeenCalledWith({
      content: MESSAGES.en.purge.confirm.working,
      components: [],
    });
    expect(shown(interaction)).toBe('Deleted 3 messages.');
  });

  it('keeps an explicit from message', async () => {
    const { flow, purge, interaction } = build('confirm');
    await flow.runCommand(interaction, { untilLink: link(UNTIL), fromLink: link(FROM) });

    expect(purge.purgeRange.mock.calls[1]![1]).toMatchObject({ fromMessageId: FROM });
  });

  it('never deletes after Cancel', async () => {
    const { flow, purge, interaction, click } = build('cancel');
    await flow.runCommand(interaction, { untilLink: link(UNTIL) });

    expect(purge.purgeRange).toHaveBeenCalledTimes(1);
    expect(click.update).toHaveBeenCalledWith({
      content: MESSAGES.en.purge.confirm.cancelled,
      components: [],
    });
  });

  it('never deletes when nobody answers in time', async () => {
    const { flow, purge, interaction } = build('timeout');
    await flow.runCommand(interaction, { untilLink: link(UNTIL) });

    expect(purge.purgeRange).toHaveBeenCalledTimes(1);
    expect(shown(interaction)).toBe(MESSAGES.en.purge.confirm.expired);
  });

  it('counts the latest messages for count, pinned the same way, and reports failures', async () => {
    const { flow, purge, interaction } = build('confirm');
    await flow.runCommand(interaction, { count: 5 });

    expect(purge.purgeRange).not.toHaveBeenCalled();
    expect(purge.purgeLast.mock.calls[0]![1]).toEqual({
      kind: 'last',
      channelId: CHANNEL,
      count: 5,
    });
    expect(purge.purgeLast.mock.calls[1]![1]).toMatchObject({
      count: 5,
      fromMessageId: '400000000000000007',
    });
    expect(shown(interaction)).toBe('Deleted 4 messages. Failed to delete 1.');
  });

  it('warns that old messages are deleted one by one', async () => {
    const { flow, interaction } = build('confirm', plan({ olderCount: 2 }));
    await flow.runCommand(interaction, { count: 3 });

    const prompt = (interaction.editReply.mock.calls[0]![0] as { content: string }).content;
    expect(prompt).toContain('2 of them are older than 14 days');
  });

  it('says so when there is nothing to delete, without asking', async () => {
    const { flow, interaction, purge } = build('confirm', plan({ count: 0, fromMessageId: null }));
    await flow.runCommand(interaction, { untilLink: link(UNTIL) });

    expect(shown(interaction)).toBe(MESSAGES.en.purge.nothing);
    expect(purge.purgeRange).toHaveBeenCalledTimes(1);
  });

  it('explains a refused preview in words', async () => {
    const missing = build('confirm', plan({ status: 'UNTIL_NOT_FOUND', count: 0 }));
    await missing.flow.runCommand(missing.interaction, { untilLink: link(UNTIL) });
    expect(shown(missing.interaction)).toBe(MESSAGES.en.purge.UNTIL_NOT_FOUND);

    const large = build('confirm', plan({ status: 'RANGE_TOO_LARGE', count: 0 }));
    await large.flow.runCommand(large.interaction, { untilLink: link(UNTIL) });
    expect(shown(large.interaction)).toContain(String(PURGE_RANGE_MAX));
  });
});

describe('PurgeFlow.run (context menu)', () => {
  it('deletes everything newer than the chosen message after confirmation', async () => {
    const { flow, purge, interaction } = build('confirm');
    await flow.run(interaction, { kind: 'range', channelId: CHANNEL, untilMessageId: UNTIL });

    expect(purge.purgeRange).toHaveBeenCalledTimes(2);
    expect(purge.purgeRange.mock.calls[1]![1]).toMatchObject({
      channelId: CHANNEL,
      untilMessageId: UNTIL,
      fromMessageId: '400000000000000007',
    });
  });
});
