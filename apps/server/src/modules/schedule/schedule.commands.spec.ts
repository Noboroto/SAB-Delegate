import 'reflect-metadata';
import { COMMAND_DESCRIPTION_MAX_LENGTH, ErrorCode, MESSAGES } from '@sab/shared';
import { ApplicationCommandOptionType, MessageFlags, TextInputStyle } from 'discord.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceError } from '../../common/errors/service-error.js';
import type { GuildLocaleService } from '../../i18n/guild-locale.service.js';
import { ScheduleCommands } from './schedule.commands.js';
import type { ScheduleService } from './schedule.service.js';
import { SchedulerCommands } from './scheduler-get.commands.js';

// Built at runtime: literal 18-digit ids trip the secret scanner.
const GUILD = '1'.repeat(18);
const CHANNEL = '2'.repeat(18);
const OTHER_CHANNEL = '3'.repeat(18);
const USER = '5'.repeat(18);
const OPTIONS_METADATA = 'necord:options_meta';

// Tuesday 13 October 2026, 10:00 in Vietnam.
const NOW = new Date('2026-10-13T03:00:00.000Z');

type Meta = Record<
  string,
  { name: string; type: number; required?: boolean; autocomplete?: boolean }
>;

/** What Necord registers for a handler: its options by property, in declaration order. */
const optionsOf = (handler: unknown): Meta =>
  Reflect.getMetadata(OPTIONS_METADATA, handler as object) as Meta;

/** The method a decorator wrote its metadata on; read, never called. */
const handlerOf = (command: { prototype: object }, name: string): unknown =>
  (command.prototype as Record<string, unknown>)[name];

const unixOf = (at: Date) => Math.floor(at.getTime() / 1000);

function interaction(overrides: { guildId?: string | null; channelId?: string } = {}) {
  const calls: string[] = [];
  const target = {
    guildId: GUILD as string | null,
    channelId: CHANNEL,
    locale: 'en-US',
    user: { id: USER },
    replied: false,
    deferred: false,
    fields: { getTextInputValue: vi.fn() },
    reply: vi.fn().mockImplementation(() => {
      calls.push('reply');
      target.replied = true;
      return Promise.resolve();
    }),
    showModal: vi.fn().mockImplementation(() => {
      calls.push('showModal');
      return Promise.resolve();
    }),
    deferReply: vi.fn().mockImplementation(() => {
      calls.push('deferReply');
      target.deferred = true;
      return Promise.resolve();
    }),
    editReply: vi.fn().mockImplementation(() => {
      calls.push('editReply');
      target.replied = true;
      return Promise.resolve();
    }),
    followUp: vi.fn().mockImplementation(() => {
      calls.push('followUp');
      return Promise.resolve();
    }),
    ...overrides,
  };
  return { target, calls };
}

const textOf = (mock: { mock: { calls: unknown[][] } }, call = 0) =>
  (mock.mock.calls[call]?.[0] as { content: string }).content;

function createdResult(seq = 1, runAt = new Date('2026-10-13T07:30:00.000Z')) {
  return { dryRun: false, runAt, schedule: { seq } };
}

function build(locale: 'vi' | 'en' = 'en') {
  const schedules = {
    scheduleSend: vi.fn().mockResolvedValue(createdResult()),
    scheduleCopy: vi.fn().mockResolvedValue(createdResult(2)),
    list: vi.fn().mockResolvedValue([]),
    cancel: vi
      .fn()
      .mockResolvedValue({ dryRun: false, code: 'CANCELED', seq: 4, status: 'CANCELED' }),
  };
  const locales = { resolve: vi.fn().mockResolvedValue(locale) };
  const commands = new ScheduleCommands(
    schedules as unknown as ScheduleService,
    locales as unknown as GuildLocaleService,
  );
  const scheduler = new SchedulerCommands(
    schedules as unknown as ScheduleService,
    locales as unknown as GuildLocaleService,
  );
  return { commands, scheduler, schedules, locales };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('/bot-message schedule-send', () => {
  it('schedules the message and tells the moment in Discord timestamps, privately', async () => {
    const { commands, schedules } = build();
    const { target } = interaction();
    await commands.onScheduleSend([target] as never, {
      time: '14:30',
      message: 'Meeting',
      date: undefined,
    });

    expect(target.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(schedules.scheduleSend).toHaveBeenCalledWith(
      GUILD,
      { channelId: CHANNEL, content: 'Meeting', runAt: new Date('2026-10-13T07:30:00.000Z') },
      { source: 'DISCORD', userId: USER },
    );
    const unix = unixOf(new Date('2026-10-13T07:30:00.000Z'));
    expect(textOf(target.editReply)).toBe(
      `Job has been scheduled with id 1 at <t:${unix}:F> (<t:${unix}:R>)`,
    );
  });

  it('sends to the destination and files the message under the server it ran in', async () => {
    const { commands, schedules } = build();
    const { target } = interaction();
    await commands.onScheduleSend([target] as never, {
      time: '2h',
      message: 'Hi',
      date: null,
      destination: { id: OTHER_CHANNEL },
    });
    expect(schedules.scheduleSend).toHaveBeenCalledWith(
      GUILD,
      { channelId: OTHER_CHANNEL, content: 'Hi', runAt: new Date('2026-10-13T05:00:00.000Z') },
      expect.anything(),
    );
  });

  it('keeps the message in the invoking server when the destination is in another one', async () => {
    const { commands, schedules } = build();
    const { target } = interaction();
    await commands.onScheduleSend([target] as never, {
      time: '2h',
      message: 'Hi',
      date: null,
      destination: { id: OTHER_CHANNEL, guildId: '9'.repeat(18) } as never,
    });
    expect(schedules.scheduleSend).toHaveBeenCalledWith(
      GUILD,
      expect.anything(),
      expect.anything(),
    );
  });

  it('opens a dialog as the first and only response when the text is missing', async () => {
    const { commands, schedules, locales } = build();
    const { target, calls } = interaction();
    await commands.onScheduleSend([target] as never, {
      time: '14:30',
      message: undefined,
      date: 'tomorrow',
      destination: { id: OTHER_CHANNEL },
    });

    expect(calls).toEqual(['showModal']);
    expect(schedules.scheduleSend).not.toHaveBeenCalled();
    // The dialog's language is the invoker's own: no lookup before it opens.
    expect(locales.resolve).not.toHaveBeenCalled();

    const modal = (
      target.showModal.mock.calls[0]?.[0] as {
        toJSON(): {
          custom_id: string;
          title: string;
          components: Array<{
            label: string;
            component: {
              custom_id: string;
              style: number;
              required?: boolean;
              max_length?: number;
            };
          }>;
        };
      }
    ).toJSON();
    // 14:30 tomorrow in Vietnam.
    const unix = unixOf(new Date('2026-10-14T07:30:00.000Z'));
    expect(modal.custom_id).toBe(`schedule-send/${OTHER_CHANNEL}/${unix}`);
    expect(modal.title).toBe('Scheduled message');
    const input = modal.components[0]?.component;
    expect(input).toMatchObject({
      custom_id: 'message',
      style: TextInputStyle.Paragraph,
      required: true,
      max_length: 2000,
    });
  });

  it('defaults the dialog to the channel the command ran in', async () => {
    const { commands } = build();
    const { target } = interaction();
    await commands.onScheduleSend([target] as never, { time: '30m', message: undefined });
    const modal = (
      target.showModal.mock.calls[0]?.[0] as { toJSON(): { custom_id: string } }
    ).toJSON();
    expect(modal.custom_id.startsWith(`schedule-send/${CHANNEL}/`)).toBe(true);
    expect(modal.custom_id.length).toBeLessThanOrEqual(100);
  });

  it.each([
    ['', undefined, 'Enter a time, for example 14:30 or 30m.'],
    ['25:00', undefined, 'Cannot read 25:00 as a time'],
    ['09:00', undefined, 'That moment has already passed: 09:00.'],
    ['09:00', '12/10/2026', 'That moment has already passed'],
    ['14:30', '31/02', '31/02 is not a day on the calendar.'],
    ['14:30', 'someday', 'Cannot read someday as a date'],
    ['30m', 'tomorrow', 'A time like 30m already counts from now'],
  ])('refuses time %j date %j before answering anything else', async (time, date, text) => {
    const { commands, schedules } = build();
    const { target, calls } = interaction();
    // `message` left out proves the check comes before the dialog too.
    await commands.onScheduleSend([target] as never, { time, message: undefined, date });

    expect(calls).toEqual(['reply']);
    expect(target.reply).toHaveBeenCalledWith(
      expect.objectContaining({ flags: MessageFlags.Ephemeral }),
    );
    expect(textOf(target.reply)).toContain(text);
    expect(schedules.scheduleSend).not.toHaveBeenCalled();
    expect(target.showModal).not.toHaveBeenCalled();
  });

  it('refuses in Vietnamese for a Vietnamese server', async () => {
    const { commands } = build('vi');
    const { target } = interaction();
    await commands.onScheduleSend([target] as never, { time: '25:00', message: 'x' });
    expect(textOf(target.reply)).toContain('Không đọc được 25:00 thành giờ');
  });

  it('is refused outside a server', async () => {
    const { commands } = build();
    const { target } = interaction({ guildId: null });
    await expect(
      commands.onScheduleSend([target] as never, { time: '14:30', message: 'x' }),
    ).rejects.toMatchObject({ code: ErrorCode.GUILD_NOT_FOUND });
  });

  it('lets a refusal from the service reach the exception filter', async () => {
    const { commands, schedules } = build();
    const refusal = new ServiceError(ErrorCode.DISCORD_MISSING_PERMISSIONS, { permission: 'send' });
    schedules.scheduleSend.mockRejectedValueOnce(refusal);
    const { target } = interaction();
    await expect(
      commands.onScheduleSend([target] as never, { time: '14:30', message: 'x' }),
    ).rejects.toBe(refusal);
  });
});

describe('the schedule-send dialog', () => {
  const unix = String(unixOf(new Date('2026-10-13T07:30:00.000Z')));

  it('schedules what was typed for the moment fixed when the command ran', async () => {
    const { commands, schedules } = build();
    const { target } = interaction();
    target.fields.getTextInputValue.mockReturnValue('Long text\nwith lines');
    await commands.onScheduleSendModal([target] as never, CHANNEL, unix);

    expect(target.fields.getTextInputValue).toHaveBeenCalledWith('message');
    expect(target.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(schedules.scheduleSend).toHaveBeenCalledWith(
      GUILD,
      {
        channelId: CHANNEL,
        content: 'Long text\nwith lines',
        runAt: new Date('2026-10-13T07:30:00.000Z'),
      },
      { source: 'DISCORD', userId: USER },
    );
    expect(textOf(target.editReply)).toContain('Job has been scheduled with id 1');
  });

  it('says so when the dialog stayed open past the moment', async () => {
    const { commands, schedules } = build();
    const { target } = interaction();
    target.fields.getTextInputValue.mockReturnValue('Late');
    vi.setSystemTime(new Date('2026-10-13T08:00:00.000Z'));
    await commands.onScheduleSendModal([target] as never, CHANNEL, unix);

    expect(schedules.scheduleSend).not.toHaveBeenCalled();
    expect(textOf(target.editReply)).toBe(
      'That moment has already passed: 13/10/2026 14:30. Choose a later time.',
    );
  });

  it('does not trust a moment that is not a number', async () => {
    const { commands, schedules } = build();
    const { target } = interaction();
    target.fields.getTextInputValue.mockReturnValue('x');
    await commands.onScheduleSendModal([target] as never, CHANNEL, 'abc');
    expect(schedules.scheduleSend).not.toHaveBeenCalled();
  });
});

describe('/bot-message schedule-copy', () => {
  const link = `https://discord.com/channels/${GUILD}/${OTHER_CHANNEL}/${'4'.repeat(18)}`;

  it('schedules the copy, resolving a bare id against the channel it ran in', async () => {
    const { commands, schedules } = build();
    const { target } = interaction();
    await commands.onScheduleCopy([target] as never, {
      messageLink: link,
      time: '14:30',
      date: 'today',
    });

    expect(target.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(schedules.scheduleCopy).toHaveBeenCalledWith(
      GUILD,
      {
        channelId: CHANNEL,
        source: link,
        sourceChannelId: CHANNEL,
        runAt: new Date('2026-10-13T07:30:00.000Z'),
      },
      { source: 'DISCORD', userId: USER },
    );
    expect(textOf(target.editReply)).toContain('Job has been scheduled with id 2');
  });

  it('explains a link that cannot be read instead of a generic error', async () => {
    const { commands, schedules } = build();
    schedules.scheduleCopy.mockRejectedValueOnce(
      new ServiceError(ErrorCode.VALIDATION_FAILED, { reason: 'MALFORMED' }),
    );
    const { target } = interaction();
    await commands.onScheduleCopy([target] as never, { messageLink: 'nope', time: '14:30' });
    expect(textOf(target.editReply)).toBe(MESSAGES.en.errors.invalidLink.MALFORMED);
  });

  it.each([
    [new ServiceError(ErrorCode.VALIDATION_FAILED, { reason: 'EMPTY_SOURCE' }), 'EMPTY_SOURCE'],
    [new ServiceError(ErrorCode.SCHEDULE_LIMIT_REACHED), 'SCHEDULE_LIMIT'],
    [new ServiceError(ErrorCode.SCHEDULE_TOO_FAR), 'TOO_FAR'],
    [new ServiceError(ErrorCode.MESSAGE_TOO_LONG), 'TOO_LONG'],
    [new ServiceError(ErrorCode.ATTACHMENTS_TOO_LARGE), 'FILES_TOO_LARGE'],
  ] as const)('explains the refusal %s in words', async (refusal, reason) => {
    const { commands, schedules } = build();
    schedules.scheduleCopy.mockRejectedValueOnce(refusal);
    const { target } = interaction();
    await commands.onScheduleCopy([target] as never, { messageLink: link, time: '14:30' });
    const text = textOf(target.editReply);
    expect(text).toBe(
      MESSAGES.en.schedule.problem[reason].replace('{max}', '500').replace('{days}', '366'),
    );
  });

  it('lets any other refusal reach the exception filter', async () => {
    const { commands, schedules } = build();
    const other = new ServiceError(ErrorCode.VALIDATION_FAILED, { reason: 'PAST' });
    schedules.scheduleCopy.mockRejectedValueOnce(other);
    const { target } = interaction();
    await expect(
      commands.onScheduleCopy([target] as never, { messageLink: link, time: '14:30' }),
    ).rejects.toBe(other);
  });

  it('refuses a time that cannot be read before deferring', async () => {
    const { commands, schedules } = build();
    const { target } = interaction();
    await commands.onScheduleCopy([target] as never, { messageLink: link, time: '99:99' });
    expect(target.deferReply).not.toHaveBeenCalled();
    expect(schedules.scheduleCopy).not.toHaveBeenCalled();
    expect(textOf(target.reply)).toContain('Cannot read 99:99 as a time');
  });
});

describe('the registered options of schedule-send and schedule-copy', () => {
  const NUMERIC = [ApplicationCommandOptionType.Integer, ApplicationCommandOptionType.Number];

  it('are time and date as text with suggestions, and no number for hour, minute, second, day, month or year', () => {
    for (const handler of [
      handlerOf(ScheduleCommands, 'onScheduleSend'),
      handlerOf(ScheduleCommands, 'onScheduleCopy'),
    ]) {
      const options = optionsOf(handler);
      for (const option of Object.values(options)) expect(NUMERIC).not.toContain(option.type);
      expect(options['time']).toMatchObject({
        name: 'time',
        type: ApplicationCommandOptionType.String,
        required: true,
        autocomplete: true,
      });
      expect(options['date']).toMatchObject({
        name: 'date',
        type: ApplicationCommandOptionType.String,
        autocomplete: true,
      });
      const names = Object.values(options).map((option) => option.name);
      for (const legacy of ['hour', 'minute', 'second', 'day', 'month', 'year']) {
        expect(names).not.toContain(legacy);
      }
    }
  });

  it('list the required options before the optional ones, which Discord insists on', () => {
    for (const handler of [
      handlerOf(ScheduleCommands, 'onScheduleSend'),
      handlerOf(ScheduleCommands, 'onScheduleCopy'),
    ]) {
      const flags = Object.values(optionsOf(handler)).map((option) => option.required === true);
      expect(flags).toEqual([...flags].sort((a, b) => Number(b) - Number(a)));
    }
  });

  it('are exactly the expected names', () => {
    const names = (handler: unknown) => Object.values(optionsOf(handler)).map((o) => o.name);
    expect(names(handlerOf(ScheduleCommands, 'onScheduleSend'))).toEqual([
      'time',
      'message',
      'date',
      'destination',
    ]);
    expect(names(handlerOf(ScheduleCommands, 'onScheduleCopy'))).toEqual([
      'message-link',
      'time',
      'date',
      'destination',
    ]);
  });
});

describe('/scheduler get', () => {
  it('says so when nothing is scheduled, publicly', async () => {
    const { scheduler } = build();
    const { target } = interaction();
    await scheduler.onGet([target] as never);
    expect(target.deferReply).toHaveBeenCalledWith();
    expect(textOf(target.editReply)).toBe('No job found');
  });

  it('lists every entry under a header, packed into messages of at most 2000 characters', async () => {
    const { scheduler, schedules } = build();
    const row = (seq: number, content: string) => ({
      id: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
      seq,
      kind: 'SEND',
      channelId: CHANNEL,
      content,
      sourceChannelId: null,
      sourceMessageId: null,
      allowedMentions: { parse: [] },
      runAt: new Date('2026-10-20T02:30:00.000Z'),
      status: seq === 2 ? 'CANCELED' : 'PENDING',
      attempts: 0,
      source: 'DISCORD',
      createdByUserId: USER,
      lastError: null,
      createdAt: new Date('2026-10-13T03:00:00.000Z'),
    });
    schedules.list.mockResolvedValue(
      Array.from({ length: 12 }, (_, index) => row(index + 1, 'x'.repeat(190))),
    );
    const { target } = interaction();
    await scheduler.onGet([target] as never);

    const sent = [
      ...target.editReply.mock.calls.map(([options]) => (options as { content: string }).content),
      ...target.followUp.mock.calls.map(([options]) => (options as { content: string }).content),
    ];
    expect(sent[0]).toBe('List of jobs:');
    for (const text of sent) expect(text.length).toBeLessThanOrEqual(2000);
    const body = sent.slice(1).join('\n');
    expect(body.match(/^## /gm)).toHaveLength(12);
    expect(body).toContain('## (End) [schedule-send] - 2');
    // Public: nothing is flagged ephemeral.
    for (const [options] of target.followUp.mock.calls) {
      expect((options as { flags?: unknown }).flags).toBeUndefined();
    }
  });

  it('is refused outside a server', async () => {
    const { scheduler } = build();
    const { target } = interaction({ guildId: null });
    await expect(scheduler.onGet([target] as never)).rejects.toMatchObject({
      code: ErrorCode.GUILD_NOT_FOUND,
    });
  });
});

describe('/scheduler cancel', () => {
  it('cancels by number and answers privately', async () => {
    const { scheduler, schedules } = build();
    const { target } = interaction();
    await scheduler.onCancel([target] as never, { id: 4 });

    expect(target.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(schedules.cancel).toHaveBeenCalledWith(GUILD, 4, { source: 'DISCORD', userId: USER });
    expect(textOf(target.editReply)).toBe('Job `4` has been canceled');
  });

  it('is not an error to cancel twice', async () => {
    const { scheduler, schedules } = build();
    schedules.cancel.mockResolvedValueOnce({
      dryRun: false,
      code: 'ALREADY_CANCELED',
      seq: 4,
      status: 'CANCELED',
    });
    const { target } = interaction();
    await scheduler.onCancel([target] as never, { id: 4 });
    expect(textOf(target.editReply)).toBe('Job `4` was already canceled');
  });

  it('declares its number as an integer with suggestions', () => {
    const options = optionsOf(handlerOf(SchedulerCommands, 'onCancel'));
    expect(options['id']).toMatchObject({
      type: ApplicationCommandOptionType.Integer,
      required: true,
      autocomplete: true,
    });
  });
});

describe('schedule command descriptions', () => {
  it.each(['en', 'vi'] as const)('pass the Discord limits in %s', (locale) => {
    for (const [key, value] of Object.entries(MESSAGES[locale].schedule.commands)) {
      expect(value.description.length, `${locale} ${key}`).toBeGreaterThan(0);
      expect(value.description.length, `${locale} ${key}`).toBeLessThanOrEqual(
        COMMAND_DESCRIPTION_MAX_LENGTH,
      );
    }
  });
});
