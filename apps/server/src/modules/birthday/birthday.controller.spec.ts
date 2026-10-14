import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GUILD,
  HTTP_ACTOR,
  asUser,
  createRestApp,
  expectGuarded,
  expectInvalid,
  snowflake,
  type RestTestApp,
} from '../../common/rest/rest-test-app.js';
import { BirthdayController } from './birthday.controller.js';
import { BIRTHDAY_CSV_MAX_BYTES } from './birthday.csv.js';
import { BirthdayService } from './birthday.service.js';

const service = { list: vi.fn(), add: vi.fn(), remove: vi.fn(), importRows: vi.fn() };
const PERSON = {
  studentId: 'SE000001',
  name: 'An',
  discordId: snowflake(70),
  month: 3,
  day: 15,
};
const base = `/api/guilds/${GUILD}/birthdays`;
let test: RestTestApp;

beforeAll(async () => {
  test = await createRestApp(
    [BirthdayController],
    [{ provide: BirthdayService, useValue: service }],
  );
});
afterAll(async () => {
  await test.app.close();
});
beforeEach(() => {
  vi.clearAllMocks();
  service.list.mockResolvedValue([{ ...PERSON, internalKey: 'x' }]);
  service.add.mockResolvedValue({ code: 'ADDED' });
  service.remove.mockImplementation((_g, _s, _a, opts: { dryRun: boolean }) =>
    Promise.resolve({
      dryRun: opts.dryRun,
      code: 'REMOVED_BY_STUDENT',
      count: 1,
      sample: [PERSON],
    }),
  );
  service.importRows.mockImplementation((_g, rows: unknown[], _a, opts: { dryRun: boolean }) =>
    Promise.resolve({
      dryRun: opts.dryRun,
      total: rows.length,
      added: rows.length,
      duplicates: [],
      sample: [],
    }),
  );
});

describe('GET birthdays', () => {
  it('is closed to strangers and to people who may not manage the server', async () => {
    await expectGuarded(test, { method: 'GET', url: base });
    expect(service.list).not.toHaveBeenCalled();
  });

  it('lists the server only, with the columns of the view and nothing else', async () => {
    const response = await test.app.inject({
      method: 'GET',
      url: `${base}?month=3`,
      headers: asUser(),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([PERSON]);
    expect(service.list).toHaveBeenCalledWith(GUILD, { month: 3 });
  });

  it('rejects a month that is not a month', async () => {
    await expectInvalid(test, { method: 'GET', url: `${base}?month=13` }, 'month');
  });
});

describe('POST birthdays', () => {
  it('adds one person as the HTTP actor and strips unknown fields', async () => {
    const response = await test.app.inject({
      method: 'POST',
      url: base,
      headers: asUser(),
      payload: { ...PERSON, guildId: snowflake(5) },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ code: 'ADDED' });
    expect(service.add).toHaveBeenCalledWith(GUILD, PERSON, HTTP_ACTOR);
  });

  it('answers 400 for an impossible date', async () => {
    await expectInvalid(
      test,
      { method: 'POST', url: base, payload: { ...PERSON, month: 2, day: 31 } },
      'day',
    );
    expect(service.add).not.toHaveBeenCalled();
  });
});

describe('DELETE birthdays', () => {
  const url = (query: string) => `${base}?${query}`;

  it('is guarded and needs a preview or a confirmation', async () => {
    await expectGuarded(test, { method: 'DELETE', url: url('studentId=SE000001&confirm=true') });
    await expectInvalid(test, { method: 'DELETE', url: url('studentId=SE000001') }, 'confirm');
    expect(service.remove).not.toHaveBeenCalled();
  });

  it('hands dryRun to the service for a preview and removes only with confirm', async () => {
    const preview = await test.app.inject({
      method: 'DELETE',
      url: url('studentId=SE000001&dryRun=true'),
      headers: asUser(),
    });
    expect(preview.statusCode).toBe(200);
    expect(service.remove).toHaveBeenLastCalledWith(
      GUILD,
      { studentId: 'SE000001', discordId: undefined },
      HTTP_ACTOR,
      { dryRun: true },
    );

    await test.app.inject({
      method: 'DELETE',
      url: url('studentId=SE000001&confirm=true'),
      headers: asUser(),
    });
    expect(service.remove).toHaveBeenLastCalledWith(
      GUILD,
      { studentId: 'SE000001', discordId: undefined },
      HTTP_ACTOR,
      { dryRun: false },
    );
  });

  it('rejects a flag that is not true or false', async () => {
    await expectInvalid(test, { method: 'DELETE', url: url('studentId=a&confirm=yes') }, 'confirm');
  });

  it('needs exactly one of studentId and discordId, never both or neither', async () => {
    const both = `studentId=SE000001&discordId=${snowflake(77)}&confirm=true`;
    await expectInvalid(test, { method: 'DELETE', url: url(both) }, 'studentId');
    await expectInvalid(test, { method: 'DELETE', url: url('confirm=true') }, 'studentId');
    await expectInvalid(test, { method: 'DELETE', url: url('dryRun=true') }, 'studentId');
    expect(service.remove).not.toHaveBeenCalled();

    const byDiscord = await test.app.inject({
      method: 'DELETE',
      url: url(`discordId=${snowflake(77)}&confirm=true`),
      headers: asUser(),
    });
    expect(byDiscord.statusCode).toBe(200);
  });
});

describe('POST birthdays/import', () => {
  const csv = (rows: string[]) => ['Name,ID,DiscordID,Day,Month', ...rows].join('\n');

  it('merges split rows and passes the preview flag down', async () => {
    const response = await test.app.inject({
      method: 'POST',
      url: `${base}/import`,
      headers: asUser(),
      payload: { rows: [PERSON], dryRun: true },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ dryRun: true, added: 1, problems: [] });
    expect(service.importRows).toHaveBeenCalledWith(GUILD, [PERSON], HTTP_ACTOR, { dryRun: true });
  });

  it('reads CSV text and reports the lines it could not take', async () => {
    const response = await test.app.inject({
      method: 'POST',
      url: `${base}/import`,
      headers: asUser(),
      payload: { csv: csv([`An,SE1,${PERSON.discordId},15,3`, 'Bo,SE2,not-an-id,1,1']) },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ problems: unknown[] }>().problems).toEqual([
      { row: 3, kind: 'INVALID_DISCORD_ID' },
    ]);
    expect(service.importRows).toHaveBeenCalledWith(
      GUILD,
      [{ studentId: 'SE1', name: 'An', discordId: PERSON.discordId, month: 3, day: 15 }],
      HTTP_ACTOR,
      { dryRun: false },
    );
  });

  it('names CSV_TOO_LARGE for a file over the limit instead of a generic body-size error', async () => {
    // Newlines double in the JSON text, so this body is well past 1 MiB.
    const big = 'a\n'.repeat(BIRTHDAY_CSV_MAX_BYTES / 2 + 1);
    const response = await test.app.inject({
      method: 'POST',
      url: `${base}/import`,
      headers: asUser(),
      payload: { csv: big },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ code: string; details: { reason: string } }>()).toMatchObject({
      code: 'VALIDATION_FAILED',
      details: { reason: 'CSV_TOO_LARGE' },
    });
    expect(service.importRows).not.toHaveBeenCalled();
  });

  it('wants exactly one of csv and rows, and a CSV with the right header', async () => {
    const call = { method: 'POST' as const, url: `${base}/import` };
    await expectInvalid(test, { ...call, payload: {} }, 'csv');
    await expectInvalid(test, { ...call, payload: { csv: 'a', rows: [PERSON] } }, 'csv');
    const badHeader = await test.app.inject({
      ...call,
      headers: asUser(),
      payload: { csv: 'Foo,Bar\n1,2' },
    });
    expect(badHeader.statusCode).toBe(400);
    expect(badHeader.json<{ details: { reason: string } }>().details.reason).toBe('BAD_HEADER');
    expect(service.importRows).not.toHaveBeenCalled();
  });
});
