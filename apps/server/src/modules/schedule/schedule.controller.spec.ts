import { ErrorCode } from '@sab/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceError } from '../../common/errors/service-error.js';
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
import { ScheduleController } from './schedule.controller.js';
import { ScheduleService } from './schedule.service.js';

const service = { list: vi.fn(), scheduleSend: vi.fn(), scheduleCopy: vi.fn(), cancel: vi.fn() };
const CHANNEL = snowflake(30);
const RUN_AT = '2099-01-01T10:00:00.000Z';
const base = `/api/guilds/${GUILD}/schedules`;
let test: RestTestApp;

const created = (dryRun: boolean) => ({
  dryRun,
  kind: 'SEND',
  channelId: CHANNEL,
  runAt: new Date(RUN_AT),
  content: 'hi',
  attachmentCount: 0,
  allowedMentions: { parse: [] },
  schedule: null,
});

beforeAll(async () => {
  test = await createRestApp(
    [ScheduleController],
    [{ provide: ScheduleService, useValue: service }],
  );
});
afterAll(async () => {
  await test.app.close();
});
beforeEach(() => {
  vi.clearAllMocks();
  test.consume.mockReset();
  service.list.mockResolvedValue([]);
  service.scheduleSend.mockImplementation((_g, _i, _a, opts: { dryRun: boolean }) =>
    Promise.resolve(created(opts.dryRun)),
  );
  service.scheduleCopy.mockImplementation((_g, _i, _a, opts: { dryRun: boolean }) =>
    Promise.resolve(created(opts.dryRun)),
  );
  service.cancel.mockImplementation((_g, seq: number, _a, opts: { dryRun: boolean }) =>
    Promise.resolve({ dryRun: opts.dryRun, code: 'CANCELED', seq, status: 'PENDING' }),
  );
});

describe('GET schedules', () => {
  it('is guarded and passes the coerced filter down', async () => {
    await expectGuarded(test, { method: 'GET', url: base });
    const response = await test.app.inject({
      method: 'GET',
      url: `${base}?status=PENDING&limit=5`,
      headers: asUser(),
    });
    expect(response.statusCode).toBe(200);
    expect(service.list).toHaveBeenCalledWith(GUILD, { status: 'PENDING', limit: 5 });
  });

  it('rejects an unknown status', async () => {
    await expectInvalid(test, { method: 'GET', url: `${base}?status=DONE` }, 'status');
  });
});

describe('POST schedules', () => {
  const send = { kind: 'send', channelId: CHANNEL, content: 'hi', runAt: RUN_AT };

  it('is guarded and validates by kind', async () => {
    await expectGuarded(test, { method: 'POST', url: base, payload: send });
    const call = (payload: object) => ({ method: 'POST' as const, url: base, payload });
    await expectInvalid(test, call({ ...send, kind: 'blast' }), 'kind');
    await expectInvalid(test, call({ ...send, runAt: 'tomorrow' }), 'runAt');
    await expectInvalid(test, call({ ...send, content: ' ' }), 'content');
    expect(service.scheduleSend).not.toHaveBeenCalled();
  });

  it('schedules a send as the HTTP actor and never forwards a mention request', async () => {
    const response = await test.app.inject({
      method: 'POST',
      url: base,
      headers: asUser(),
      payload: { ...send, allowedMentions: { parse: ['everyone'] } },
    });
    expect(response.statusCode).toBe(201);
    const [guildId, input, actor, opts] = service.scheduleSend.mock.calls[0] as unknown[];
    expect(guildId).toBe(GUILD);
    expect(actor).toEqual(HTTP_ACTOR);
    expect(opts).toEqual({ dryRun: false });
    expect(input).toEqual({ channelId: CHANNEL, content: 'hi', runAt: new Date(RUN_AT) });
    expect(test.consume).toHaveBeenCalledWith(GUILD, 'schedule');
  });

  it('schedules a copy, and a preview reaches the service as dryRun', async () => {
    const response = await test.app.inject({
      method: 'POST',
      url: base,
      headers: asUser(),
      payload: {
        kind: 'copy',
        channelId: CHANNEL,
        source: `${snowflake(31)}/${snowflake(32)}`,
        runAt: RUN_AT,
        dryRun: true,
      },
    });
    expect(response.statusCode).toBe(201);
    expect(service.scheduleSend).not.toHaveBeenCalled();
    expect(service.scheduleCopy.mock.calls[0]?.[3]).toEqual({ dryRun: true });
  });

  it('spends the schedule allowance on a real create only, never on a preview', async () => {
    const post = (dryRun: boolean) =>
      test.app.inject({
        method: 'POST',
        url: base,
        headers: asUser(),
        payload: { ...send, dryRun },
      });
    expect((await post(true)).statusCode).toBe(201);
    expect(test.consume).not.toHaveBeenCalled();
    expect((await post(false)).statusCode).toBe(201);
    expect(test.consume).toHaveBeenCalledTimes(1);
  });

  it('answers 429 once the server used up its allowance, before the service is asked', async () => {
    test.consume.mockImplementation(() => {
      throw new ServiceError(ErrorCode.RATE_LIMITED);
    });
    const response = await test.app.inject({
      method: 'POST',
      url: base,
      headers: asUser(),
      payload: send,
    });
    expect(response.statusCode).toBe(429);
    expect(response.json<{ code: string }>().code).toBe('RATE_LIMITED');
    expect(service.scheduleSend).not.toHaveBeenCalled();
  });
});

describe('DELETE schedules/:id', () => {
  const url = (query: string, id = '7') => `${base}/${id}?${query}`;

  it('is guarded, needs a preview or a confirmation and a numeric id', async () => {
    await expectGuarded(test, { method: 'DELETE', url: url('confirm=true') });
    await expectInvalid(test, { method: 'DELETE', url: url('') }, 'confirm');
    await expectInvalid(test, { method: 'DELETE', url: url('confirm=true', 'abc') }, 'id');
    expect(service.cancel).not.toHaveBeenCalled();
  });

  it('previews and cancels through the service in the path server', async () => {
    const preview = await test.app.inject({
      method: 'DELETE',
      url: url('dryRun=true'),
      headers: asUser(),
    });
    expect(preview.json()).toMatchObject({ dryRun: true, seq: 7 });
    expect(service.cancel).toHaveBeenLastCalledWith(GUILD, 7, HTTP_ACTOR, { dryRun: true });

    await test.app.inject({ method: 'DELETE', url: url('confirm=true'), headers: asUser() });
    expect(service.cancel).toHaveBeenLastCalledWith(GUILD, 7, HTTP_ACTOR, { dryRun: false });
  });
});
