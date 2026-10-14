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
import { WordGameController } from './word-game.controller.js';
import { WordGameService } from './word-game.service.js';

const service = { status: vi.fn(), listUsedWords: vi.fn(), configure: vi.fn(), reset: vi.fn() };
const CHANNEL = snowflake(40);
const base = `/api/guilds/${GUILD}/word-game`;
const SETTINGS = { channelId: CHANNEL, maxWords: 1500 };
let test: RestTestApp;

beforeAll(async () => {
  test = await createRestApp(
    [WordGameController],
    [{ provide: WordGameService, useValue: service }],
  );
});
afterAll(async () => {
  await test.app.close();
});
beforeEach(() => {
  vi.clearAllMocks();
  service.status.mockResolvedValue({
    started: true,
    lastWord: 'xin',
    lastUserId: snowflake(3),
    channelId: CHANNEL,
    maxWords: 1500,
    count: 4,
    finished: false,
    secret: 'x',
  });
  service.listUsedWords.mockResolvedValue({
    items: [{ word: 'xin' }],
    pagination: { page: 1, pageSize: 20, total: 1 },
  });
  service.configure.mockImplementation((_g, _c, _a, opts: { dryRun: boolean }) =>
    Promise.resolve({
      before: SETTINGS,
      after: SETTINGS,
      restarted: false,
      clearedWords: 0,
      sample: [],
      dryRun: opts.dryRun,
    }),
  );
  service.reset.mockImplementation((_g, _a, opts: { dryRun: boolean }) =>
    Promise.resolve({
      status: 'RESET',
      channelId: CHANNEL,
      clearedWords: 4,
      sample: ['xin'],
      dryRun: opts.dryRun,
    }),
  );
});

describe('GET word-game', () => {
  it('is guarded and answers the view only', async () => {
    await expectGuarded(test, { method: 'GET', url: base });
    const response = await test.app.inject({ method: 'GET', url: base, headers: asUser() });
    expect(response.json()).not.toHaveProperty('secret');
    expect(response.json()).toMatchObject({ count: 4, finished: false });
    expect(service.status).toHaveBeenCalledWith(GUILD);
  });
});

describe('GET word-game/words', () => {
  it('pages with the shared query and coerces the numbers', async () => {
    const response = await test.app.inject({
      method: 'GET',
      url: `${base}/words?page=2&pageSize=5&sort=word&order=desc`,
      headers: asUser(),
    });
    expect(response.statusCode).toBe(200);
    expect(service.listUsedWords).toHaveBeenCalledWith(GUILD, {
      page: 2,
      pageSize: 5,
      sort: 'word',
      order: 'desc',
    });
  });

  it('rejects a page size over the limit and a sort key that is not allowed', async () => {
    await expectInvalid(test, { method: 'GET', url: `${base}/words?pageSize=1000` }, 'pageSize');
    await expectInvalid(test, { method: 'GET', url: `${base}/words?sort=id` }, 'sort');
  });
});

describe('PATCH word-game/config', () => {
  it('is guarded and wants a channel or a limit', async () => {
    await expectGuarded(test, {
      method: 'PATCH',
      url: `${base}/config`,
      payload: { maxWords: 500 },
    });
    await expectInvalid(test, { method: 'PATCH', url: `${base}/config`, payload: {} }, '');
    await expectInvalid(
      test,
      { method: 'PATCH', url: `${base}/config`, payload: { maxWords: 5 } },
      'maxWords',
    );
    expect(service.configure).not.toHaveBeenCalled();
  });

  it('passes only the config and the preview flag to the service', async () => {
    const response = await test.app.inject({
      method: 'PATCH',
      url: `${base}/config`,
      headers: asUser(),
      payload: { channelId: CHANNEL, dryRun: true, extra: 1 },
    });
    expect(response.statusCode).toBe(200);
    expect(service.configure).toHaveBeenCalledWith(GUILD, { channelId: CHANNEL }, HTTP_ACTOR, {
      dryRun: true,
    });
  });
});

describe('POST word-game/reset', () => {
  const call = (payload: object) => ({ method: 'POST' as const, url: `${base}/reset`, payload });

  it('is guarded and refuses to run without confirm', async () => {
    await expectGuarded(test, call({ confirm: true }));
    await expectInvalid(test, call({}), 'confirm');
    expect(service.reset).not.toHaveBeenCalled();
  });

  it('previews, then resets once confirmed, the service doing the preview', async () => {
    const preview = await test.app.inject({ ...call({ dryRun: true }), headers: asUser() });
    expect(preview.json()).toMatchObject({ dryRun: true, clearedWords: 4 });
    expect(service.reset).toHaveBeenLastCalledWith(GUILD, HTTP_ACTOR, { dryRun: true });

    const done = await test.app.inject({ ...call({ confirm: true }), headers: asUser() });
    expect(done.json()).toMatchObject({ dryRun: false });
    expect(service.reset).toHaveBeenLastCalledWith(GUILD, HTTP_ACTOR, { dryRun: false });
  });
});
