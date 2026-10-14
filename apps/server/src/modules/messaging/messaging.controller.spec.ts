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
import { MessagingController } from './messaging.controller.js';
import { MessagingService } from './messaging.service.js';

const service = {
  sendMessage: vi.fn(),
  copyMessage: vi.fn(),
  reactToMessage: vi.fn(),
  createReactionPoll: vi.fn(),
  editBotMessage: vi.fn(),
};
const CHANNEL = snowflake(20);
const MESSAGE = snowflake(21);
const base = `/api/guilds/${GUILD}/messages`;
let test: RestTestApp;

beforeAll(async () => {
  test = await createRestApp(
    [MessagingController],
    [{ provide: MessagingService, useValue: service }],
  );
});
afterAll(async () => {
  await test.app.close();
});
beforeEach(() => {
  vi.clearAllMocks();
  test.consume.mockReset();
  service.sendMessage.mockImplementation((_g, _i, _a, opts: { dryRun: boolean }) =>
    Promise.resolve({
      channelId: CHANNEL,
      messageId: opts.dryRun ? null : MESSAGE,
      replyToMessageId: null,
      content: 'hello',
      pings: [],
      dryRun: opts.dryRun,
    }),
  );
  service.copyMessage.mockResolvedValue({
    status: 'COPIED',
    channelId: CHANNEL,
    messageId: MESSAGE,
  });
  service.reactToMessage.mockResolvedValue({ channelId: CHANNEL, messageId: MESSAGE, count: 3 });
  service.createReactionPoll.mockImplementation((_g, _i, _a, opts: { dryRun: boolean }) =>
    Promise.resolve({
      channelId: CHANNEL,
      messageId: MESSAGE,
      created: false,
      emojis: ['1'],
      dryRun: opts.dryRun,
    }),
  );
  service.editBotMessage.mockImplementation(
    (_g, input: { target: object }, _a, opts: { dryRun: boolean }) =>
      Promise.resolve({ status: 'EDITED', ...input.target, content: 'new', dryRun: opts.dryRun }),
  );
});

const post = (path: string, payload: object) => ({
  method: 'POST' as const,
  url: `${base}/${path}`,
  payload,
});

describe('POST messages/send', () => {
  const body = { channelId: CHANNEL, content: 'hello' };

  it('is guarded and validates the body', async () => {
    await expectGuarded(test, post('send', body));
    await expectInvalid(test, post('send', { ...body, content: '' }), 'content');
    await expectInvalid(test, post('send', { ...body, content: 'x'.repeat(2001) }), 'content');
    await expectInvalid(test, post('send', { content: 'hello' }), 'channelId');
    expect(service.sendMessage).not.toHaveBeenCalled();
  });

  it('sends as the HTTP actor for the path server and spends the message allowance', async () => {
    const response = await test.app.inject({
      ...post('send', { ...body, extra: 1 }),
      headers: asUser(),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ messageId: MESSAGE, pings: [], dryRun: false });
    expect(service.sendMessage).toHaveBeenCalledWith(GUILD, body, HTTP_ACTOR, { dryRun: false });
    expect(test.consume).toHaveBeenCalledWith(GUILD, 'message');
  });

  it('hands the preview flag to the service', async () => {
    const response = await test.app.inject({
      ...post('send', { ...body, dryRun: true }),
      headers: asUser(),
    });
    expect(response.json()).toMatchObject({ messageId: null, dryRun: true });
    expect(service.sendMessage.mock.calls[0]?.[3]).toEqual({ dryRun: true });
    expect(test.consume).not.toHaveBeenCalled();
  });

  it('spends no allowance on a request that fails validation', async () => {
    await test.app.inject({ ...post('send', { content: 'hello' }), headers: asUser() });
    expect(test.consume).not.toHaveBeenCalled();
  });

  it('answers 429 when the server used up its allowance, without calling the service', async () => {
    test.consume.mockImplementation(() => {
      throw new ServiceError(ErrorCode.RATE_LIMITED);
    });
    const response = await test.app.inject({ ...post('send', body), headers: asUser() });
    expect(response.statusCode).toBe(429);
    expect(response.json<{ code: string }>().code).toBe('RATE_LIMITED');
    expect(service.sendMessage).not.toHaveBeenCalled();
  });
});

describe('POST messages/copy, react and poll', () => {
  it('copy: guarded, validated, calls copyMessage', async () => {
    const body = { source: { channelId: CHANNEL, messageId: MESSAGE }, channelId: snowflake(22) };
    await expectGuarded(test, post('copy', body));
    await expectInvalid(
      test,
      post('copy', { ...body, source: { channelId: CHANNEL } }),
      'source.messageId',
    );
    await test.app.inject({ ...post('copy', body), headers: asUser() });
    expect(service.copyMessage).toHaveBeenCalledWith(GUILD, body, HTTP_ACTOR);
    expect(test.consume).toHaveBeenCalledWith(GUILD, 'message');
  });

  it('react: guarded, validated, calls reactToMessage with the poll default', async () => {
    const body = { target: { channelId: CHANNEL, messageId: MESSAGE }, emoji: '👍' };
    await expectGuarded(test, post('react', body));
    await expectInvalid(test, post('react', { ...body, pollChoices: 11 }), 'pollChoices');
    await test.app.inject({ ...post('react', body), headers: asUser() });
    expect(service.reactToMessage).toHaveBeenCalledWith(
      GUILD,
      { ...body, pollChoices: 0 },
      HTTP_ACTOR,
    );
  });

  it('poll: guarded, validated, previews through the service', async () => {
    const body = { channelId: CHANNEL, choices: 3 };
    await expectGuarded(test, post('poll', body));
    await expectInvalid(test, post('poll', { ...body, choices: 0 }), 'choices');
    await test.app.inject({ ...post('poll', { ...body, dryRun: true }), headers: asUser() });
    expect(service.createReactionPoll).toHaveBeenCalledWith(GUILD, body, HTTP_ACTOR, {
      dryRun: true,
    });
    expect(test.consume).not.toHaveBeenCalled();

    await test.app.inject({ ...post('poll', body), headers: asUser() });
    expect(test.consume).toHaveBeenCalledTimes(1);
    expect(test.consume).toHaveBeenCalledWith(GUILD, 'message');
  });
});

describe('PATCH messages/:channelId/:messageId', () => {
  const url = `${base}/${CHANNEL}/${MESSAGE}`;

  it('is guarded and validates the route ids and the text', async () => {
    await expectGuarded(test, { method: 'PATCH', url, payload: { content: 'new' } });
    await expectInvalid(test, { method: 'PATCH', url, payload: { content: '' } }, 'content');
    await expectInvalid(
      test,
      { method: 'PATCH', url: `${base}/abc/${MESSAGE}`, payload: { content: 'new' } },
      'channelId',
    );
    expect(service.editBotMessage).not.toHaveBeenCalled();
  });

  it('edits the message the route names, as the HTTP actor', async () => {
    const response = await test.app.inject({
      method: 'PATCH',
      url,
      headers: asUser(),
      payload: { content: 'new', dryRun: true },
    });
    expect(response.json()).toMatchObject({ status: 'EDITED', messageId: MESSAGE, dryRun: true });
    expect(service.editBotMessage).toHaveBeenCalledWith(
      GUILD,
      { target: { channelId: CHANNEL, messageId: MESSAGE }, content: 'new' },
      HTTP_ACTOR,
      { dryRun: true },
    );
    expect(test.consume).not.toHaveBeenCalled();
  });

  it('spends the message allowance on a real edit', async () => {
    await test.app.inject({ method: 'PATCH', url, headers: asUser(), payload: { content: 'new' } });
    expect(test.consume).toHaveBeenCalledTimes(1);
    expect(test.consume).toHaveBeenCalledWith(GUILD, 'message');
  });
});
