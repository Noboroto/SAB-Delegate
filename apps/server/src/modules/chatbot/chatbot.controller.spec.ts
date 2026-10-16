import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FreshAuthGuard } from '../../auth/session.guard.js';
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
import { ChatbotConfigService } from './chatbot-config.service.js';
import { ChatbotHistoryService } from './chatbot-history.service.js';
import { ChatbotMemoryService } from './chatbot-memory.service.js';
import { ChatbotNamesService } from './chatbot-names.service.js';
import { ChatbotQuotaService } from './chatbot-quota.service.js';
import { ChatbotController } from './chatbot.controller.js';

const config = {
  get: vi.fn(),
  configure: vi.fn(),
  addChannel: vi.fn(),
  removeChannel: vi.fn(),
  saveOverride: vi.fn(),
  clearOverride: vi.fn(),
  testOverride: vi.fn(),
};
const quota = { list: vi.fn(), setLimit: vi.fn(), grant: vi.fn(), reset: vi.fn() };
const memory = { clear: vi.fn() };
const history = { list: vi.fn(), get: vi.fn(), delete: vi.fn() };
const names = { resolve: vi.fn() };

const CHANNEL = snowflake(40);
const MEMBER = snowflake(50);
const OTHER_MEMBER = snowflake(51);
const TURN = '0190a000-0000-7000-8000-0000000000aa';
const base = `/api/guilds/${GUILD}/chatbot`;
// The test helper types the methods it knows; the guard check is the same for PUT.
type Call = Parameters<typeof expectGuarded>[1];
const put = (url: string, payload?: object): Call => ({ method: 'PUT', url, payload }) as never;

/** What the service gives: more than the response may carry. */
const CONFIG = {
  enabled: true,
  defaultMonthlyLimit: 1000,
  channels: [CHANNEL],
  llm: {
    source: 'guild',
    baseUrl: 'https://llm.example.test/v1',
    model: 'model-x',
    keyLast4: 'wxyz',
    globalAvailable: true,
    llmApiKeyEnc: 'sealed-column',
    apiKey: 'plain-column',
  },
  llmApiKeyEnc: 'sealed-column',
};
const QUOTA = { used: 10, limit: 100, bonus: 5, overridden: true, remaining: 95 };
const TURN_ROW = {
  id: TURN,
  createdAt: '2026-10-16T01:00:00.000Z',
  channelId: CHANNEL,
  userId: MEMBER,
  triggerMessageId: snowflake(60),
  replyMessageId: null,
  status: 'OK',
  estimated: false,
  failureReason: null,
  question: 'q',
  answer: 'a',
  model: null,
  llmSource: null,
  inputTokens: 1,
  outputTokens: 2,
};

let test: RestTestApp;

beforeAll(async () => {
  test = await createRestApp(
    [ChatbotController],
    [
      { provide: ChatbotConfigService, useValue: config },
      { provide: ChatbotQuotaService, useValue: quota },
      { provide: ChatbotMemoryService, useValue: memory },
      { provide: ChatbotHistoryService, useValue: history },
      { provide: ChatbotNamesService, useValue: names },
    ],
  );
});
afterAll(async () => {
  await test.app.close();
});
beforeEach(() => {
  vi.resetAllMocks();
  for (const method of ['get', 'configure', 'saveOverride', 'clearOverride']) {
    config[method as 'get'].mockResolvedValue(CONFIG);
  }
  config.addChannel.mockResolvedValue(undefined);
  config.removeChannel.mockResolvedValue(undefined);
  names.resolve.mockResolvedValue(new Map([[MEMBER, 'An']]));
  quota.setLimit.mockResolvedValue(QUOTA);
  quota.grant.mockResolvedValue(QUOTA);
});

const inject = (call: Call) => test.app.inject({ ...call, headers: asUser() });

describe('guards', () => {
  it('closes every route to strangers and to people who cannot manage the server', async () => {
    const calls: Call[] = [
      { method: 'GET', url: base },
      { method: 'PATCH', url: `${base}/config`, payload: { enabled: true } },
      put(`${base}/channels/${CHANNEL}`),
      { method: 'DELETE', url: `${base}/channels/${CHANNEL}` },
      put(`${base}/llm`, { baseUrl: 'https://llm.example.test/v1', model: 'm' }),
      { method: 'DELETE', url: `${base}/llm` },
      {
        method: 'POST',
        url: `${base}/llm/test`,
        payload: { baseUrl: 'https://x.test', model: 'm' },
      },
      { method: 'GET', url: `${base}/quota` },
      put(`${base}/quota/${MEMBER}`, { limit: 5 }),
      { method: 'POST', url: `${base}/quota/${MEMBER}/grant`, payload: { tokens: 5 } },
      { method: 'POST', url: `${base}/quota/${MEMBER}/reset`, payload: {} },
      { method: 'POST', url: `${base}/memory/clear`, payload: { scope: 'all' } },
      { method: 'GET', url: `${base}/turns` },
      { method: 'GET', url: `${base}/turns/${TURN}` },
      { method: 'DELETE', url: `${base}/turns`, payload: { scope: 'all' } },
    ];
    for (const call of calls) await expectGuarded(test, call);
  });

  it('asks for a recent login where the key or its address changes, and nowhere else', () => {
    const guardsOf = (name: keyof ChatbotController): unknown[] =>
      (Reflect.getMetadata(
        GUARDS_METADATA,
        Object.getOwnPropertyDescriptor(ChatbotController.prototype, name)?.value as object,
      ) ?? []) as unknown[];
    expect(guardsOf('saveLlm')).toContain(FreshAuthGuard);
    expect(guardsOf('clearLlm')).toContain(FreshAuthGuard);
    for (const name of [
      'testLlm',
      'configure',
      'addChannel',
      'listQuota',
      'deleteTurns',
    ] as const) {
      expect(guardsOf(name)).not.toContain(FreshAuthGuard);
    }
  });
});

describe('config and channels', () => {
  it('answers the config and never the key material', async () => {
    const responses = await Promise.all([
      inject({ method: 'GET', url: base }),
      inject({ method: 'PATCH', url: `${base}/config`, payload: { enabled: false } }),
      inject(put(`${base}/channels/${CHANNEL}`)),
      inject({ method: 'DELETE', url: `${base}/channels/${CHANNEL}` }),
      inject(
        put(`${base}/llm`, {
          baseUrl: 'https://llm.example.test/v1',
          model: 'm',
          apiKey: 'body-credential',
        }),
      ),
      inject({ method: 'DELETE', url: `${base}/llm` }),
    ]);
    for (const response of responses) {
      expect(response.statusCode).toBe(200);
      expect(response.body).not.toMatch(/apiKey|llmApiKeyEnc|sealed-column|plain-column/);
      expect(response.json()).toMatchObject({ enabled: true, llm: { keyLast4: 'wxyz' } });
    }
  });

  it('sends only the fields given, so a patch of enabled leaves the limit alone', async () => {
    const response = await inject({
      method: 'PATCH',
      url: `${base}/config`,
      payload: { enabled: false, extra: 1 },
    });
    expect(response.statusCode).toBe(200);
    expect(config.configure).toHaveBeenCalledWith(GUILD, { enabled: false }, HTTP_ACTOR);
  });

  it('refuses a negative default limit', async () => {
    await expectInvalid(
      test,
      { method: 'PATCH', url: `${base}/config`, payload: { defaultMonthlyLimit: -1 } },
      'defaultMonthlyLimit',
    );
    expect(config.configure).not.toHaveBeenCalled();
  });

  it('adds and removes a channel for the caller, then reads the config back', async () => {
    await inject(put(`${base}/channels/${CHANNEL}`));
    expect(config.addChannel).toHaveBeenCalledWith(GUILD, CHANNEL, HTTP_ACTOR);
    await inject({ method: 'DELETE', url: `${base}/channels/${CHANNEL}` });
    expect(config.removeChannel).toHaveBeenCalledWith(GUILD, CHANNEL, HTTP_ACTOR);
    expect(config.get).toHaveBeenCalledTimes(2);
  });

  it('refuses a channel id that is not a snowflake', async () => {
    const response = await inject(put(`${base}/channels/not-an-id`));
    expect(response.statusCode).toBe(400);
    expect(response.json<{ code: string }>().code).toBe('VALIDATION_FAILED');
    expect(config.addChannel).not.toHaveBeenCalled();
  });

  it('saves the override with the key from the body, and tests without changing anything', async () => {
    const body = { baseUrl: 'https://llm.example.test/v1', model: 'm', apiKey: 'body-credential' };
    await inject(put(`${base}/llm`, { ...body, extra: 1 }));
    expect(config.saveOverride).toHaveBeenCalledWith(GUILD, body, HTTP_ACTOR);

    config.testOverride.mockResolvedValue({ ok: true });
    const tested = await inject({ method: 'POST', url: `${base}/llm/test`, payload: body });
    expect(tested.statusCode).toBe(200);
    expect(config.testOverride).toHaveBeenCalledWith(GUILD, body);
    expect(config.saveOverride).toHaveBeenCalledTimes(1);
  });
});

describe('quota', () => {
  it('pages the month and names only the ids on the page', async () => {
    quota.list.mockResolvedValue({
      items: [
        { userId: MEMBER, ...QUOTA },
        { userId: OTHER_MEMBER, ...QUOTA },
      ],
      total: 7,
      period: '2026-09',
      defaultLimit: 250,
    });
    const response = await inject({
      method: 'GET',
      url: `${base}/quota?page=2&pageSize=2&sort=used&order=desc`,
    });
    expect(response.statusCode).toBe(200);
    expect(quota.list).toHaveBeenCalledWith(GUILD, {
      page: 2,
      pageSize: 2,
      sort: 'used',
      order: 'desc',
    });
    expect(names.resolve).toHaveBeenCalledWith(GUILD, [MEMBER, OTHER_MEMBER]);
    const body = response.json<{
      items: { userId: string; displayName: string | null }[];
      pagination: object;
      period: string;
      defaultLimit: number;
    }>();
    expect(body.items.map((item) => item.displayName)).toEqual(['An', null]);
    expect(body.pagination).toEqual({ page: 2, pageSize: 2, total: 7 });
    expect(body.period).toBe('2026-09');
    expect(body.defaultLimit).toBe(250);
    expect(config.get).not.toHaveBeenCalled();
  });

  it('refuses a sort key that is not allowed', async () => {
    await expectInvalid(test, { method: 'GET', url: `${base}/quota?sort=id` }, 'sort');
  });

  it('sets a limit, clears it with null, and grants a signed amount', async () => {
    const set = await inject(put(`${base}/quota/${MEMBER}`, { limit: 50 }));
    expect(quota.setLimit).toHaveBeenLastCalledWith(GUILD, MEMBER, 50, HTTP_ACTOR);
    expect(set.json()).toEqual({ userId: MEMBER, displayName: 'An', ...QUOTA });
    await inject(put(`${base}/quota/${MEMBER}`, { limit: null }));
    expect(quota.setLimit).toHaveBeenLastCalledWith(GUILD, MEMBER, null, HTTP_ACTOR);

    await inject({ method: 'POST', url: `${base}/quota/${MEMBER}/grant`, payload: { tokens: -3 } });
    expect(quota.grant).toHaveBeenCalledWith(GUILD, MEMBER, -3, HTTP_ACTOR);
  });

  it('refuses a zero grant, a missing limit and a member id that is not a snowflake', async () => {
    await expectInvalid(
      test,
      { method: 'POST', url: `${base}/quota/${MEMBER}/grant`, payload: { tokens: 0 } },
      'tokens',
    );
    await expectInvalid(test, put(`${base}/quota/${MEMBER}`, {}), 'limit');
    const bad = await inject(put(`${base}/quota/abc`, { limit: 1 }));
    expect(bad.statusCode).toBe(400);
    expect(quota.setLimit).not.toHaveBeenCalled();
    expect(quota.grant).not.toHaveBeenCalled();
  });

  it('resets after a dry run only when told to, the service doing the preview', async () => {
    quota.reset.mockImplementation((_g, _u, _a, options: { dryRun: boolean }) =>
      Promise.resolve({ dryRun: options.dryRun, used: 10 }),
    );
    const call = (payload: object): Call => ({
      method: 'POST',
      url: `${base}/quota/${MEMBER}/reset`,
      payload,
    });
    const preview = await inject(call({ dryRun: true }));
    expect(preview.json()).toEqual({ dryRun: true, used: 10 });
    expect(quota.reset).toHaveBeenLastCalledWith(GUILD, MEMBER, HTTP_ACTOR, { dryRun: true });
    await inject(call({}));
    expect(quota.reset).toHaveBeenLastCalledWith(GUILD, MEMBER, HTTP_ACTOR, { dryRun: false });
  });
});

describe('memory', () => {
  it('clears by scope, naming only the id the scope needs', async () => {
    memory.clear.mockResolvedValue({ dryRun: true, userMemories: 1, channelMemories: 0 });
    const response = await inject({
      method: 'POST',
      url: `${base}/memory/clear`,
      payload: { scope: 'user', userId: MEMBER, dryRun: true },
    });
    expect(response.json()).toEqual({ dryRun: true, userMemories: 1, channelMemories: 0 });
    expect(memory.clear).toHaveBeenCalledWith(
      GUILD,
      { scope: 'user', userId: MEMBER, dryRun: true },
      HTTP_ACTOR,
    );
  });

  it('refuses a scope without its id and an id the scope does not take', async () => {
    for (const payload of [{ scope: 'user' }, { scope: 'all', channelId: CHANNEL }]) {
      const response = await inject({ method: 'POST', url: `${base}/memory/clear`, payload });
      expect(response.statusCode).toBe(400);
    }
    expect(memory.clear).not.toHaveBeenCalled();
  });
});

describe('history', () => {
  it('lists turns with the shared filters and no context snapshot', async () => {
    history.list.mockResolvedValue({
      items: [{ ...TURN_ROW, context: { system: 'x' } }],
      total: 1,
    });
    const response = await inject({
      method: 'GET',
      url: `${base}/turns?userId=${MEMBER}&status=OK&from=2026-10-01T00:00:00.000Z`,
    });
    expect(response.statusCode).toBe(200);
    expect(history.list).toHaveBeenCalledWith(
      GUILD,
      expect.objectContaining({ userId: MEMBER, status: 'OK', order: 'desc', page: 1 }),
    );
    const body = response.json<{ items: object[]; pagination: object }>();
    expect(body.items[0]).not.toHaveProperty('context');
    expect(body.items[0]).toMatchObject({ userId: MEMBER, displayName: 'An' });
    expect(names.resolve).toHaveBeenCalledWith(GUILD, [MEMBER]);
    expect(body.pagination).toEqual({ page: 1, pageSize: 20, total: 1 });
  });

  it('refuses a range that ends before it starts and an unknown status', async () => {
    const reversed = `from=2026-10-02T00:00:00.000Z&to=2026-10-01T00:00:00.000Z`;
    await expectInvalid(test, { method: 'GET', url: `${base}/turns?${reversed}` }, 'from');
    await expectInvalid(test, { method: 'GET', url: `${base}/turns?status=NOPE` }, 'status');
  });

  it('reads one turn with its context, and answers 404 for one the server does not have', async () => {
    history.get.mockResolvedValueOnce({
      ...TURN_ROW,
      context: { system: 's', channelMessages: [], memory: {}, recentTurns: 0, attachments: [] },
    });
    const found = await inject({ method: 'GET', url: `${base}/turns/${TURN}` });
    expect(found.json()).toMatchObject({ id: TURN, context: { system: 's' } });
    expect(history.get).toHaveBeenCalledWith(GUILD, TURN);

    history.get.mockResolvedValueOnce(null);
    const missing = await inject({ method: 'GET', url: `${base}/turns/${TURN}` });
    expect(missing.statusCode).toBe(404);
    expect(missing.json<{ code: string }>().code).toBe('CHATBOT_TURN_NOT_FOUND');

    const bad = await inject({ method: 'GET', url: `${base}/turns/nope` });
    expect(bad.statusCode).toBe(400);
  });

  it('deletes by scope and lets the service count a dry run', async () => {
    history.delete.mockResolvedValue({ dryRun: true, count: 4 });
    const response = await inject({
      method: 'DELETE',
      url: `${base}/turns`,
      payload: { scope: 'turn', turnId: TURN, dryRun: true },
    });
    expect(response.json()).toEqual({ dryRun: true, count: 4 });
    expect(history.delete).toHaveBeenCalledWith(
      GUILD,
      { scope: 'turn', turnId: TURN, dryRun: true },
      HTTP_ACTOR,
    );
  });

  it('refuses a delete whose ids do not match its scope', async () => {
    for (const payload of [{ scope: 'turn' }, { scope: 'all', userId: MEMBER }, {}]) {
      const response = await inject({ method: 'DELETE', url: `${base}/turns`, payload });
      expect(response.statusCode).toBe(400);
    }
    expect(history.delete).not.toHaveBeenCalled();
  });
});
