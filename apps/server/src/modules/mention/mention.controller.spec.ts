import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCode } from '@sab/shared';
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
import { MentionController } from './mention.controller.js';
import { MentionService } from './mention.service.js';

const service = {
  mentionReactors: vi.fn(),
  mentionNonReactors: vi.fn(),
  mentionEveryoneInThread: vi.fn(),
};
const RESULT = {
  dryRun: false,
  status: 'OK',
  count: 1,
  sample: [snowflake(5)],
  chunks: ['<@5>'],
  delivered: false,
  postedChunks: 0,
};
const MESSAGE = { channelId: snowflake(10), messageId: snowflake(11) };
let test: RestTestApp;

beforeAll(async () => {
  test = await createRestApp([MentionController], [{ provide: MentionService, useValue: service }]);
});
afterAll(async () => {
  await test.app.close();
});
beforeEach(() => {
  vi.clearAllMocks();
  service.mentionReactors.mockResolvedValue(RESULT);
  service.mentionNonReactors.mockResolvedValue(RESULT);
});

const post = (path: string, payload: object) => ({
  method: 'POST' as const,
  url: `/api/guilds/${GUILD}/mention/${path}`,
  payload,
});

describe('POST mention/reactors', () => {
  it('is closed to strangers and to people who may not manage the server', async () => {
    await expectGuarded(test, post('reactors', { ...MESSAGE, emoji: '👍' }));
    expect(service.mentionReactors).not.toHaveBeenCalled();
  });

  it('answers 400 with the field that is wrong', async () => {
    await expectInvalid(test, post('reactors', { ...MESSAGE }), 'emoji');
    await expectInvalid(
      test,
      post('reactors', { ...MESSAGE, emoji: '👍', channelId: 'x' }),
      'channelId',
    );
    expect(service.mentionReactors).not.toHaveBeenCalled();
  });

  it('calls the service as the signed-in person over HTTP and never crosses servers', async () => {
    const response = await test.app.inject({
      ...post('reactors', { ...MESSAGE, emoji: '👍', crossGuild: true, extra: 'x' }),
      headers: asUser(),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(RESULT);
    const [guildId, input, actor, opts] = service.mentionReactors.mock.calls[0] as unknown[];
    expect(guildId).toBe(GUILD);
    expect(actor).toEqual(HTTP_ACTOR);
    expect(input).toMatchObject({ ...MESSAGE, emoji: '👍' });
    expect(input).not.toHaveProperty('crossGuild');
    expect(input).not.toHaveProperty('extra');
    expect(opts).toEqual({ dryRun: false });
  });

  it('spends the message budget only when it posts a reply', async () => {
    const send = (payload: object) =>
      test.app.inject({ ...post('reactors', payload), headers: asUser() });
    await send({ ...MESSAGE, emoji: '👍' });
    expect(test.consume).not.toHaveBeenCalled();
    await send({ ...MESSAGE, emoji: '👍', dryRun: true, replyTo: MESSAGE });
    expect(test.consume).not.toHaveBeenCalled();
    await send({ ...MESSAGE, emoji: '👍', replyTo: MESSAGE });
    expect(test.consume).toHaveBeenCalledWith(GUILD, 'message');
  });

  it('refuses with 429 when the server used up its message budget', async () => {
    test.consume.mockImplementationOnce(() => {
      throw new ServiceError(ErrorCode.RATE_LIMITED);
    });
    const response = await test.app.inject({
      ...post('reactors', { ...MESSAGE, emoji: '👍', replyTo: MESSAGE }),
      headers: asUser(),
    });
    expect(response.statusCode).toBe(429);
    expect(service.mentionReactors).not.toHaveBeenCalled();
  });

  it('hands the preview flag to the service', async () => {
    await test.app.inject({
      ...post('reactors', { ...MESSAGE, emoji: '👍', dryRun: true }),
      headers: asUser(),
    });
    expect((service.mentionReactors.mock.calls[0] as unknown[])[3]).toEqual({ dryRun: true });
  });
});

describe('POST mention/non-reactors', () => {
  it('is guarded, validated, and runs as the HTTP caller', async () => {
    await expectGuarded(test, post('non-reactors', MESSAGE));
    await expectInvalid(test, post('non-reactors', { channelId: MESSAGE.channelId }), 'messageId');

    const response = await test.app.inject({
      ...post('non-reactors', { ...MESSAGE, reply: true, crossGuild: true }),
      headers: asUser(),
    });
    expect(response.statusCode).toBe(200);
    const [guildId, input, actor, opts] = service.mentionNonReactors.mock.calls[0] as unknown[];
    expect(guildId).toBe(GUILD);
    expect(actor).toEqual(HTTP_ACTOR);
    expect(input).toMatchObject({ ...MESSAGE, reply: true });
    expect(input).not.toHaveProperty('crossGuild');
    expect(opts).toEqual({ dryRun: false });
    expect(test.consume).toHaveBeenCalledWith(GUILD, 'message');
  });
});

describe('mentionEveryoneInThread', () => {
  it('has no route: only a person at a slash command may ping everyone', async () => {
    const response = await test.app.inject({
      ...post('everyone', { threadId: snowflake(20) }),
      headers: asUser(),
    });
    expect(response.statusCode).toBe(404);
    expect(service.mentionEveryoneInThread).not.toHaveBeenCalled();
  });
});
