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
import { PurgeController } from './purge.controller.js';
import { PurgeService } from './purge.service.js';

const service = { purgeRange: vi.fn(), purgeLast: vi.fn() };
const PLAN = {
  status: 'OK',
  count: 3,
  fromMessageId: snowflake(50),
  olderCount: 1,
  sample: [snowflake(50)],
};
const DONE = { status: 'OK', count: 3, deleted: 3, failed: 0 };
const CHANNEL = snowflake(10);
const RANGE = { mode: 'range', channelId: CHANNEL, untilMessageId: snowflake(40) };
const LAST = { mode: 'last', channelId: CHANNEL, count: 5 };
let test: RestTestApp;

beforeAll(async () => {
  test = await createRestApp([PurgeController], [{ provide: PurgeService, useValue: service }]);
});
afterAll(async () => {
  await test.app.close();
});
beforeEach(() => {
  vi.clearAllMocks();
  service.purgeRange.mockImplementation((_g, _i, _a, opts: { dryRun: boolean }) =>
    Promise.resolve(opts.dryRun ? PLAN : DONE),
  );
  service.purgeLast.mockImplementation((_g, _i, _a, opts: { dryRun: boolean }) =>
    Promise.resolve(opts.dryRun ? PLAN : DONE),
  );
});

const post = (payload: object) => ({
  method: 'POST' as const,
  url: `/api/guilds/${GUILD}/purge`,
  payload,
});
const send = (payload: object) => test.app.inject({ ...post(payload), headers: asUser() });

describe('POST purge', () => {
  it('is closed to strangers and to people who may not manage the server', async () => {
    await expectGuarded(test, post({ ...LAST, confirm: true }));
    expect(service.purgeLast).not.toHaveBeenCalled();
  });

  it('answers 400 for an unknown mode or a field that is wrong', async () => {
    await expectInvalid(test, post({ ...LAST, mode: 'all', confirm: true }), 'mode');
    await expectInvalid(test, post({ ...LAST, count: 0, confirm: true }), 'count');
    await expectInvalid(test, post({ ...RANGE, channelId: 'x', dryRun: true }), 'channelId');
  });

  it.each([
    ['range', RANGE, 'purgeRange'],
    ['last', LAST, 'purgeLast'],
  ] as const)('refuses to delete by %s without confirm', async (_mode, body, method) => {
    await expectInvalid(test, post(body), 'confirm');
    await expectInvalid(test, post({ ...body, confirm: false }), 'confirm');
    expect(service[method]).not.toHaveBeenCalled();
  });

  it.each([
    ['range', RANGE, 'purgeRange'],
    ['last', LAST, 'purgeLast'],
  ] as const)(
    'previews a %s purge through the service and returns the plan',
    async (_mode, body, method) => {
      const response = await send({ ...body, dryRun: true });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(PLAN);
      const [guildId, input, actor, opts] = service[method].mock.calls[0] as unknown[];
      expect(guildId).toBe(GUILD);
      expect(actor).toEqual(HTTP_ACTOR);
      expect(input).toMatchObject({ channelId: CHANNEL });
      expect(opts).toEqual({ dryRun: true });
    },
  );

  it.each([
    ['range', RANGE, 'purgeRange', 'purgeLast'],
    ['last', LAST, 'purgeLast', 'purgeRange'],
  ] as const)(
    'deletes by %s with confirm and returns the outcome',
    async (_mode, body, method, other) => {
      const response = await send({ ...body, confirm: true });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(DONE);
      expect((service[method].mock.calls[0] as unknown[])[3]).toEqual({ dryRun: false });
      expect(service[other]).not.toHaveBeenCalled();
    },
  );
});
