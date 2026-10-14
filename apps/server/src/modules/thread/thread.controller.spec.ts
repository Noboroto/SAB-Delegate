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
import { PrivateThreadService } from './private-thread.service.js';
import { ThreadController } from './thread.controller.js';
import { ThreadService } from './thread.service.js';

const threads = { create: vi.fn(), renameByPrefix: vi.fn(), deleteByPrefix: vi.fn() };
const privateThreads = {
  createPrivateThreads: vi.fn(),
  createPrivateThreadsFromReactors: vi.fn(),
};
const CHANNEL = snowflake(10);
const PRIVATE_RESULT = { status: 'OK', linkProblem: null, total: 1, created: 1, failures: [] };
const PLAN = { status: 'OK', count: 2, invalid: 0, sample: [] };
const DONE = { status: 'OK', count: 2, done: 2, failures: [] };
let test: RestTestApp;

beforeAll(async () => {
  test = await createRestApp(
    [ThreadController],
    [
      { provide: ThreadService, useValue: threads },
      { provide: PrivateThreadService, useValue: privateThreads },
    ],
  );
});
afterAll(async () => {
  await test.app.close();
});
beforeEach(() => {
  vi.clearAllMocks();
  threads.create.mockResolvedValue({ status: 'CREATED', threadId: snowflake(60) });
  privateThreads.createPrivateThreads.mockResolvedValue(PRIVATE_RESULT);
  privateThreads.createPrivateThreadsFromReactors.mockResolvedValue(PRIVATE_RESULT);
  for (const method of [threads.renameByPrefix, threads.deleteByPrefix]) {
    method.mockImplementation((_g, _i, _a, opts: { dryRun: boolean }) =>
      Promise.resolve(opts.dryRun ? PLAN : DONE),
    );
  }
});

const post = (path: string, payload: object) => ({
  method: 'POST' as const,
  url: `/api/guilds/${GUILD}/threads${path}`,
  payload,
});
const send = (path: string, payload: object) =>
  test.app.inject({ ...post(path, payload), headers: asUser() });

describe('POST threads', () => {
  const body = { channelId: CHANNEL, name: 'Planning', message: 'Hello' };

  it('is closed to strangers and to people who may not manage the server', async () => {
    await expectGuarded(test, post('', body));
    expect(threads.create).not.toHaveBeenCalled();
  });

  it('answers 400 for a missing name', async () => {
    await expectInvalid(test, post('', { channelId: CHANNEL, message: 'Hello' }), 'name');
  });

  it('creates as the HTTP caller, without a byline, and spends the message budget', async () => {
    const response = await send('', { ...body, byline: 'Somebody else said', crossGuild: true });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ status: 'CREATED', threadId: snowflake(60) });
    const [guildId, input, actor] = threads.create.mock.calls[0] as unknown[];
    expect(guildId).toBe(GUILD);
    expect(actor).toEqual(HTTP_ACTOR);
    expect(input).toMatchObject(body);
    expect(input).not.toHaveProperty('byline');
    expect(input).not.toHaveProperty('crossGuild');
    expect(test.consume).toHaveBeenCalledWith(GUILD, 'message');
  });
});

describe.each([
  ['rename', 'renameByPrefix', { channelId: CHANNEL, oldPrefix: 'old-', newPrefix: 'new-' }],
  ['delete', 'deleteByPrefix', { channelId: CHANNEL, prefix: 'old-' }],
] as const)('POST threads/%s', (path, method, body) => {
  it('is closed to strangers and to people who may not manage the server', async () => {
    await expectGuarded(test, post(`/${path}`, { ...body, confirm: true }));
    expect(threads[method]).not.toHaveBeenCalled();
  });

  it('refuses to run without confirm, and without calling the service', async () => {
    await expectInvalid(test, post(`/${path}`, body), 'confirm');
    expect(threads[method]).not.toHaveBeenCalled();
  });

  it('previews through the service and returns the plan', async () => {
    const response = await send(`/${path}`, { ...body, dryRun: true });
    expect(response.json()).toEqual(PLAN);
    const [guildId, input, actor, opts] = threads[method].mock.calls[0] as unknown[];
    expect(guildId).toBe(GUILD);
    expect(actor).toEqual(HTTP_ACTOR);
    expect(input).toMatchObject(body);
    expect(opts).toEqual({ dryRun: true });
  });

  it('runs with confirm and returns the outcome', async () => {
    const response = await send(`/${path}`, { ...body, confirm: true });
    expect(response.json()).toEqual(DONE);
    expect((threads[method].mock.calls[0] as unknown[])[3]).toEqual({ dryRun: false });
  });
});

describe('POST threads/private', () => {
  const body = { channelId: CHANNEL, prefix: 'room', message: 'Welcome', userIds: [snowflake(31)] };

  it('is guarded and validated', async () => {
    await expectGuarded(test, post('/private', body));
    await expectInvalid(test, post('/private', { ...body, userIds: [] }), 'userIds');
    expect(privateThreads.createPrivateThreads).not.toHaveBeenCalled();
  });

  it('opens the threads as the HTTP caller and spends the message budget', async () => {
    const response = await send('/private', body);
    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual(PRIVATE_RESULT);
    const [guildId, input, actor] = privateThreads.createPrivateThreads.mock.calls[0] as unknown[];
    expect(guildId).toBe(GUILD);
    expect(actor).toEqual(HTTP_ACTOR);
    expect(input).toMatchObject(body);
    expect(test.consume).toHaveBeenCalledWith(GUILD, 'message');
  });
});

describe('POST threads/private/reactors', () => {
  const body = {
    channelId: CHANNEL,
    prefix: 'room',
    message: 'Welcome',
    messageLink: `https://discord.com/channels/${GUILD}/${CHANNEL}/${snowflake(11)}`,
    emoji: '👍',
  };

  it('is guarded and validated', async () => {
    await expectGuarded(test, post('/private/reactors', body));
    await expectInvalid(test, post('/private/reactors', { ...body, emoji: '' }), 'emoji');
  });

  it('stays in this server: the service gets no crossGuild option', async () => {
    await send('/private/reactors', { ...body, crossGuild: true });
    const call = privateThreads.createPrivateThreadsFromReactors.mock.calls[0] as unknown[];
    expect(call[2]).toEqual(HTTP_ACTOR);
    expect(call).toHaveLength(3);
    expect(call[1]).not.toHaveProperty('crossGuild');
    expect(test.consume).toHaveBeenCalledWith(GUILD, 'message');
  });
});
