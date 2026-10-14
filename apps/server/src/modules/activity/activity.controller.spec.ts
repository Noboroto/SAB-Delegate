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
import { ActivityController } from './activity.controller.js';
import { ActivityService } from './activity.service.js';

const service = { createActivity: vi.fn() };
const RESULT = {
  categoryId: snowflake(70),
  roles: { event: snowflake(71), multi: snowflake(72), mc: snowflake(73) },
  channels: { general: snowflake(74), threadOnly: snowflake(75), voice: snowflake(76) },
};
const BODY = { emoji: '🎲', name: 'Board games', shortName: 'bgm' };
let test: RestTestApp;

beforeAll(async () => {
  test = await createRestApp(
    [ActivityController],
    [{ provide: ActivityService, useValue: service }],
  );
});
afterAll(async () => {
  await test.app.close();
});
beforeEach(() => {
  vi.clearAllMocks();
  service.createActivity.mockResolvedValue(RESULT);
});

const request = (payload: object) => ({
  method: 'POST' as const,
  url: `/api/guilds/${GUILD}/activity`,
  payload,
});

describe('POST activity', () => {
  it('is closed to strangers and to people who may not manage the server', async () => {
    await expectGuarded(test, request(BODY));
    expect(service.createActivity).not.toHaveBeenCalled();
  });

  it('answers 400 for a short name that is not 3 characters', async () => {
    await expectInvalid(test, request({ ...BODY, shortName: 'ab' }), 'shortName');
    expect(service.createActivity).not.toHaveBeenCalled();
  });

  it('creates the activity as the HTTP caller and strips unknown fields', async () => {
    const response = await test.app.inject({
      ...request({ ...BODY, admin: true }),
      headers: asUser(),
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual(RESULT);
    const [guildId, input, actor] = service.createActivity.mock.calls[0] as unknown[];
    expect(guildId).toBe(GUILD);
    expect(actor).toEqual(HTTP_ACTOR);
    expect(input).toEqual(BODY);
  });
});
