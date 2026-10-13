import 'reflect-metadata';
import {
  COMMAND_DESCRIPTION_MAX_LENGTH,
  ErrorCode,
  MESSAGES,
  type BirthdayImportProblem,
} from '@sab/shared';
import { MessageFlags } from 'discord.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServiceError } from '../../common/errors/service-error.js';
import type { CommandPayload } from '../../discord/command-hash.js';
import { validateCommandMetadata } from '../../discord/validate-command-metadata.js';
import type { GuildLocaleService } from '../../i18n/guild-locale.service.js';
import { translatorFor } from '../../i18n/translator.js';
import type { GuildConfigService } from '../guild-config/guild-config.service.js';
import { BirthdayCommands } from './birthday.commands.js';
import {
  MAX_REPORTED_PROBLEMS,
  formatBirthdayMonths,
  formatImportReport,
} from './birthday.format.js';
import type { BirthdayService } from './birthday.service.js';

const GUILD = '100000000000000001';
const USER = '100000000000000002';
const ANN = '300000000000000001';
const HEADER = 'Name,ID,DiscordID,Day,Month';

afterEach(() => {
  vi.unstubAllGlobals();
});

function build(locale: 'vi' | 'en' = 'en') {
  const birthdays = {
    importRows: vi.fn(),
    list: vi.fn().mockResolvedValue([]),
    remove: vi.fn(),
  };
  const config = {
    assertChannelUsable: vi.fn().mockResolvedValue(undefined),
    patch: vi.fn().mockResolvedValue({}),
  };
  const commands = new BirthdayCommands(
    birthdays as unknown as BirthdayService,
    config as unknown as GuildConfigService,
    { resolve: vi.fn().mockResolvedValue(locale) } as unknown as GuildLocaleService,
  );
  const interaction = (guildId: string | null = GUILD) => {
    const target = {
      guildId,
      locale,
      user: { id: USER },
      replied: false,
      deferred: false,
      reply: vi.fn().mockImplementation(() => {
        target.replied = true;
        return Promise.resolve();
      }),
      deferReply: vi.fn().mockImplementation(() => {
        target.deferred = true;
        return Promise.resolve();
      }),
      editReply: vi.fn().mockResolvedValue(undefined),
      followUp: vi.fn().mockResolvedValue(undefined),
    };
    return target;
  };
  return { commands, birthdays, config, interaction };
}

const file = (
  overrides: Partial<{ url: string; size: number; contentType: string | null }> = {},
) => ({
  url: 'https://cdn.example/list.csv',
  size: 100,
  contentType: 'text/csv; charset=utf-8',
  ...overrides,
});

function serve(body: string, init: { ok?: boolean; status?: number } = {}) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    text: () => Promise.resolve(body),
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const edited = (target: { editReply: ReturnType<typeof vi.fn> }) =>
  (target.editReply.mock.calls[0]?.[0] as { content: string }).content;

describe('/birthday append-list', () => {
  it('defers privately before anything slow', async () => {
    const { commands, interaction, birthdays } = build();
    serve(`${HEADER}\n`);
    birthdays.importRows.mockResolvedValue({ added: 0, duplicates: [] });
    const target = interaction();
    await commands.onAppendList([target] as never, { file: file() });
    expect(target.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
  });

  it('refuses a file that is not a CSV, one that is too large, and a failed download', async () => {
    const { commands, interaction } = build();
    const notCsv = interaction();
    await commands.onAppendList([notCsv] as never, { file: file({ contentType: 'image/png' }) });
    expect(edited(notCsv)).toBe('File must be a csv');

    const noType = interaction();
    await commands.onAppendList([noType] as never, { file: file({ contentType: null }) });
    expect(edited(noType)).toBe('File must be a csv');

    const large = interaction();
    await commands.onAppendList([large] as never, { file: file({ size: 1024 * 1024 + 1 }) });
    expect(edited(large)).toBe('File is too large (max 1 MB)');

    serve('', { ok: false, status: 404 });
    const missing = interaction();
    await commands.onAppendList([missing] as never, { file: file() });
    expect(edited(missing)).toBe('Cannot download the file (HTTP 404)');
  });

  it('accepts a file of exactly 1 MB', async () => {
    const { commands, interaction, birthdays } = build();
    serve(`${HEADER}\n`);
    birthdays.importRows.mockResolvedValue({ added: 0, duplicates: [] });
    const target = interaction();
    await commands.onAppendList([target] as never, { file: file({ size: 1024 * 1024 }) });
    expect(edited(target)).toBe('Added 0 of 0 row(s).');
  });

  it('shows the expected header and an example when the header is wrong', async () => {
    const { commands, interaction, birthdays } = build();
    serve('Name,Id\nAnn,SE1\n');
    const target = interaction();
    await commands.onAppendList([target] as never, { file: file() });
    const text = edited(target);
    expect(text).toContain(HEADER);
    expect(text).toContain('Nguyen Van A');
    expect(birthdays.importRows).not.toHaveBeenCalled();
  });

  it('says the file cannot be read when the CSV is malformed', async () => {
    const { commands, interaction } = build();
    serve(`${HEADER}\n"Ann,SE1,${ANN},1,2\n`);
    const target = interaction();
    await commands.onAppendList([target] as never, { file: file() });
    expect(edited(target)).toBe('Cannot read the csv file');
  });

  it('imports the valid rows as the caller and reports the rest against their lines', async () => {
    const { commands, interaction, birthdays } = build();
    serve(
      [HEADER, `Ann,SE1,<@${ANN}>,15,3`, `Bob,SE2,${ANN},32,3`, `Cat,SE3,${ANN},1,2`].join('\r\n'),
    );
    birthdays.importRows.mockResolvedValue({ added: 1, duplicates: ['SE3'] });
    const target = interaction();
    await commands.onAppendList([target] as never, { file: file() });

    expect(birthdays.importRows).toHaveBeenCalledWith(
      GUILD,
      [
        { studentId: 'SE1', name: 'Ann', discordId: ANN, month: 3, day: 15 },
        { studentId: 'SE3', name: 'Cat', discordId: ANN, month: 2, day: 1 },
      ],
      { source: 'DISCORD', userId: USER },
    );
    expect(edited(target)).toBe(
      [
        'Added 1 of 3 row(s).',
        'Skipped 2:',
        'Row 3: invalid Day/Month',
        'Row 4: ID SE3 already exists',
      ].join('\n'),
    );
  });

  it('answers in the server language', async () => {
    const { commands, interaction, birthdays } = build('vi');
    serve(`${HEADER}\nAnn,SE1,${ANN},15,3\n`);
    birthdays.importRows.mockResolvedValue({ added: 1, duplicates: [] });
    const target = interaction();
    await commands.onAppendList([target] as never, { file: file() });
    expect(edited(target)).toBe('Đã thêm 1 trên 1 dòng.');
  });

  it('is refused outside a server before it defers', async () => {
    const { commands, interaction } = build();
    const target = interaction(null);
    await expect(commands.onAppendList([target] as never, { file: file() })).rejects.toMatchObject({
      code: ErrorCode.GUILD_NOT_FOUND,
    });
    expect(target.deferReply).not.toHaveBeenCalled();
  });
});

describe('/birthday get-list', () => {
  it('answers publicly first, then one follow-up per month that has anyone, then Done!', async () => {
    const { commands, interaction, birthdays } = build();
    birthdays.list.mockResolvedValue([
      { studentId: 'SE1', name: 'Ann', discordId: ANN, month: 1, day: 5 },
      { studentId: 'SE2', name: 'Bob', discordId: ANN, month: 3, day: 15 },
    ]);
    const target = interaction();
    await commands.onGetList([target] as never, {});

    expect(target.reply).toHaveBeenCalledWith({
      content: 'Getting list of users in the birthday list',
    });
    expect(target.deferReply).not.toHaveBeenCalled();
    const sent = target.followUp.mock.calls.map(
      ([options]) => options as { content: string; flags?: unknown },
    );
    expect(sent.map((message) => message.content)).toEqual([
      `## Month 1:\n### Day 5:\nSE1 - Ann - ${ANN}\n`,
      `## Month 3:\n### Day 15:\nSE2 - Bob - ${ANN}\n`,
      'Done!',
    ]);
    expect(sent.every((message) => message.flags === undefined)).toBe(true);
    expect(birthdays.list).toHaveBeenCalledWith(GUILD, {});
  });

  it('passes the month option on and still ends with Done! for an empty month', async () => {
    const { commands, interaction, birthdays } = build();
    const target = interaction();
    await commands.onGetList([target] as never, { month: 4 });
    expect(birthdays.list).toHaveBeenCalledWith(GUILD, { month: 4 });
    expect(
      target.followUp.mock.calls.map(([options]) => (options as { content: string }).content),
    ).toEqual(['Done!']);
  });

  it('treats an option the person left out (null) as no month', async () => {
    const { commands, interaction, birthdays } = build();
    await commands.onGetList([interaction()] as never, { month: null });
    expect(birthdays.list).toHaveBeenCalledWith(GUILD, {});
  });

  it('splits a month longer than 2000 characters across messages', async () => {
    const { commands, interaction, birthdays } = build();
    birthdays.list.mockResolvedValue(
      Array.from({ length: 60 }, (_, i) => ({
        studentId: `SE${i}`,
        name: 'N'.repeat(50),
        discordId: ANN,
        month: 3,
        day: 15,
      })),
    );
    const target = interaction();
    await commands.onGetList([target] as never, {});
    const contents = target.followUp.mock.calls.map(
      ([options]) => (options as { content: string }).content,
    );
    expect(contents.length).toBeGreaterThan(2);
    expect(contents.every((content) => content.length <= 2000)).toBe(true);
  });
});

describe('/birthday remove', () => {
  const run = async (
    options: { studentId?: string | null; user?: { id: string } | null },
    result: { code: string },
  ) => {
    const { commands, interaction, birthdays } = build();
    birthdays.remove.mockResolvedValue({ dryRun: false, count: 0, sample: [], ...result });
    const target = interaction();
    await commands.onRemove([target] as never, options);
    return { target, birthdays };
  };

  it('defers privately and removes as the caller', async () => {
    const { target, birthdays } = await run({ studentId: ' SE1 ' }, { code: 'REMOVED_BY_STUDENT' });
    expect(target.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(birthdays.remove).toHaveBeenCalledWith(
      GUILD,
      { studentId: 'SE1', discordId: undefined },
      { source: 'DISCORD', userId: USER },
    );
    expect(edited(target)).toBe('Birthday removed');
  });

  it('passes both selectors on and lets the service prefer the student ID', async () => {
    const { birthdays } = await run(
      { studentId: 'SE1', user: { id: ANN } },
      { code: 'REMOVED_BY_STUDENT' },
    );
    expect(birthdays.remove).toHaveBeenCalledWith(
      GUILD,
      { studentId: 'SE1', discordId: ANN },
      expect.anything(),
    );
  });

  it('says "No birthday found" for a student ID nobody has', async () => {
    const { target } = await run({ studentId: 'SE9' }, { code: 'NOT_FOUND' });
    expect(edited(target)).toBe('No birthday found');
  });

  it('says "No birthday found for this user" for a user nobody has', async () => {
    const { target } = await run({ user: { id: ANN } }, { code: 'NOT_FOUND' });
    expect(edited(target)).toBe('No birthday found for this user');
  });

  it('removed by user says "Birthday removed"', async () => {
    const { target } = await run({ user: { id: ANN } }, { code: 'REMOVED_BY_USER' });
    expect(edited(target)).toBe('Birthday removed');
  });

  it('asks for a selector when given none, treating a blank student ID as none', async () => {
    const { target, birthdays } = await run(
      { studentId: '  ', user: null },
      { code: 'NO_SELECTOR' },
    );
    expect(edited(target)).toBe('Please provide a student ID or a Discord user');
    expect(birthdays.remove).toHaveBeenCalledWith(
      GUILD,
      { studentId: undefined, discordId: undefined },
      expect.anything(),
    );
  });
});

describe('/birthday birthday-channel', () => {
  it('checks the channel before deferring, then sets it through the shared setting', async () => {
    const { commands, interaction, config } = build();
    const order: string[] = [];
    config.assertChannelUsable.mockImplementation(() => {
      order.push('check');
      return Promise.resolve();
    });
    config.patch.mockImplementation(() => {
      order.push('patch');
      return Promise.resolve({});
    });
    const target = interaction();
    target.deferReply.mockImplementation(() => {
      order.push('defer');
      target.deferred = true;
      return Promise.resolve();
    });
    await commands.onBirthdayChannel([target] as never, { channel: { id: '200000000000000001' } });

    expect(order).toEqual(['check', 'defer', 'patch']);
    expect(config.assertChannelUsable).toHaveBeenCalledWith(
      'birthdayChannelId',
      '200000000000000001',
    );
    expect(config.patch).toHaveBeenCalledWith(
      GUILD,
      { birthdayChannelId: '200000000000000001' },
      { source: 'DISCORD', userId: USER },
    );
    expect(target.deferReply).toHaveBeenCalledWith();
    expect(edited(target)).toContain('<#200000000000000001>');
  });

  it('does not defer or write when the channel is unusable', async () => {
    const { commands, interaction, config } = build();
    const refusal = new ServiceError(ErrorCode.DISCORD_MISSING_PERMISSIONS, { permission: 'send' });
    config.assertChannelUsable.mockRejectedValueOnce(refusal);
    const target = interaction();
    await expect(
      commands.onBirthdayChannel([target] as never, { channel: { id: '200000000000000001' } }),
    ).rejects.toBe(refusal);
    expect(target.deferReply).not.toHaveBeenCalled();
    expect(config.patch).not.toHaveBeenCalled();
  });
});

describe('birthday command descriptions', () => {
  const leaves = (node: unknown, path: string[] = []): Array<{ path: string; text: string }> => {
    if (typeof node === 'string') return [{ path: path.join('.'), text: node }];
    if (typeof node !== 'object' || node === null) return [];
    return Object.entries(node).flatMap(([key, child]) => leaves(child, [...path, key]));
  };

  it.each(['en', 'vi'] as const)('pass the Discord limits in %s', (locale) => {
    const subcommands = Object.entries(MESSAGES[locale].birthday.commands).map(([key, value]) => ({
      name: key.replaceAll(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`),
      type: 1,
      description: value.description,
    }));
    const payload = [
      {
        name: 'birthday',
        type: 1,
        description: MESSAGES[locale].commands.birthday.description,
        options: subcommands,
      },
    ] as unknown as CommandPayload[];
    expect(validateCommandMetadata(payload)).toEqual([]);
  });

  it('are within the length Discord allows and non-empty', () => {
    for (const locale of ['en', 'vi'] as const) {
      for (const { path, text } of leaves(MESSAGES[locale].birthday.commands)) {
        expect(text.length, `${locale} ${path}`).toBeGreaterThan(0);
        expect(text.length, `${locale} ${path}`).toBeLessThanOrEqual(
          COMMAND_DESCRIPTION_MAX_LENGTH,
        );
      }
    }
  });
});

const person = (studentId: string, name: string, month: number, day: number) => ({
  studentId,
  name,
  discordId: `10000000000000000${studentId.slice(-1)}`,
  month,
  day,
});

describe('formatBirthdayMonths', () => {
  it('prints the layout the command always used, per month, skipping empty months', () => {
    const months = formatBirthdayMonths([
      person('SE1', 'Ann', 1, 5),
      person('SE2', 'Bob', 3, 15),
      person('SE3', 'Cat', 3, 15),
      person('SE4', 'Dan', 3, 20),
    ]);
    expect(months).toEqual([
      { month: 1, text: '## Month 1:\n### Day 5:\nSE1 - Ann - 100000000000000001\n' },
      {
        month: 3,
        text:
          '## Month 3:\n' +
          '### Day 15:\n' +
          'SE2 - Bob - 100000000000000002\n' +
          'SE3 - Cat - 100000000000000003\n' +
          '### Day 20:\n' +
          'SE4 - Dan - 100000000000000004\n',
      },
    ]);
  });

  it('yields nothing for an empty list', () => {
    expect(formatBirthdayMonths([])).toEqual([]);
  });
});

const problem = (row: number, kind: BirthdayImportProblem['kind'], studentId?: string) => ({
  row,
  kind,
  ...(studentId === undefined ? {} : { studentId }),
});

describe('formatImportReport', () => {
  const en = translatorFor('en');

  it('says only how many were added when nothing was skipped', () => {
    expect(formatImportReport(en, { total: 3, added: 3, problems: [] })).toBe(
      'Added 3 of 3 row(s).',
    );
  });

  it('lists the skipped rows in line order with the legacy wording', () => {
    expect(
      formatImportReport(en, {
        total: 5,
        added: 2,
        problems: [
          problem(5, 'DUPLICATE_ID', 'SE9'),
          problem(2, 'MISSING_FIELDS'),
          problem(4, 'INVALID_DATE'),
        ],
      }),
    ).toBe(
      [
        'Added 2 of 5 row(s).',
        'Skipped 3:',
        'Row 2: missing Name, ID or DiscordID',
        'Row 4: invalid Day/Month',
        'Row 5: ID SE9 already exists',
      ].join('\n'),
    );
  });

  it('shows at most 20 problems and counts the rest', () => {
    const problems = Array.from({ length: MAX_REPORTED_PROBLEMS + 7 }, (_, i) =>
      problem(i + 2, 'INVALID_DATE'),
    );
    const lines = formatImportReport(en, { total: 40, added: 13, problems }).split('\n');
    expect(MAX_REPORTED_PROBLEMS).toBe(20);
    expect(lines).toHaveLength(1 + 1 + 20 + 1);
    expect(lines[1]).toBe('Skipped 27:');
    expect(lines.at(-1)).toBe('...and 7 more');
  });

  it('does not add a "more" line at exactly 20 problems', () => {
    const problems = Array.from({ length: 20 }, (_, i) => problem(i + 2, 'INVALID_DATE'));
    const lines = formatImportReport(en, { total: 20, added: 0, problems }).split('\n');
    expect(lines).toHaveLength(22);
    expect(lines.at(-1)).not.toContain('more');
  });

  it('speaks Vietnamese for a Vietnamese server', () => {
    const text = formatImportReport(translatorFor('vi'), {
      total: 2,
      added: 1,
      problems: [problem(3, 'INVALID_DISCORD_ID'), problem(4, 'INVALID_VALUE')],
    });
    expect(text).toContain('Đã thêm 1 trên 2 dòng.');
    expect(text).toContain('Dòng 3: DiscordID không hợp lệ');
    expect(text).not.toContain('Row');
  });
});
