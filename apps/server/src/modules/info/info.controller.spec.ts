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
import { InfoController } from './info.controller.js';
import { InfoService } from './info.service.js';

const service = {
  getIntroduction: vi.fn(),
  listReactorIds: vi.fn(),
  listRoleMemberIds: vi.fn(),
  createInvite: vi.fn(),
};
const CHANNEL = snowflake(10);
let test: RestTestApp;

beforeAll(async () => {
  test = await createRestApp([InfoController], [{ provide: InfoService, useValue: service }]);
});
afterAll(async () => {
  await test.app.close();
});
beforeEach(() => {
  vi.clearAllMocks();
});

const url = (path: string) => `/api/guilds/${GUILD}/info/${path}`;
const qs = (query: Record<string, string>) => new URLSearchParams(query).toString();
const read = (path: string, query: Record<string, string>) =>
  test.app.inject({ method: 'GET', url: `${url(path)}?${qs(query)}`, headers: asUser() });

describe('GET info/introduction', () => {
  const query = { userId: snowflake(31) };

  it('is guarded and validated', async () => {
    await expectGuarded(test, { method: 'GET', url: `${url('introduction')}?${qs(query)}` });
    await expectInvalid(test, { method: 'GET', url: url('introduction') }, 'userId');
    expect(service.getIntroduction).not.toHaveBeenCalled();
  });

  it('returns the introduction the service found', async () => {
    service.getIntroduction.mockResolvedValue({ status: 'NOT_FOUND', scanned: 4 });
    const response = await read('introduction', query);
    expect(response.json()).toEqual({ status: 'NOT_FOUND', scanned: 4 });
    expect(service.getIntroduction).toHaveBeenCalledWith(GUILD, query);
  });
});

describe('GET info/reactors', () => {
  const query = { channelId: CHANNEL, messageId: snowflake(11), emoji: '👍' };

  it('is guarded and validated', async () => {
    await expectGuarded(test, { method: 'GET', url: `${url('reactors')}?${qs(query)}` });
    await expectInvalid(
      test,
      { method: 'GET', url: `${url('reactors')}?${qs({ channelId: CHANNEL })}` },
      'messageId',
    );
  });

  it('looks for the message in this server only', async () => {
    service.listReactorIds.mockResolvedValue({
      url: 'https://example.test/m',
      emoji: '👍',
      userIds: [],
    });
    const response = await read('reactors', query);
    expect(response.statusCode).toBe(200);
    expect(service.listReactorIds).toHaveBeenCalledWith(GUILD, query);
  });
});

describe('GET info/role-members', () => {
  const query = { roleId: snowflake(30), channelId: CHANNEL };

  it('is guarded and validated', async () => {
    await expectGuarded(test, { method: 'GET', url: `${url('role-members')}?${qs(query)}` });
    await expectInvalid(test, { method: 'GET', url: url('role-members') }, 'roleId');
  });

  it('lists the members the service found', async () => {
    const found = { roleId: query.roleId, roleName: 'Members', userIds: [snowflake(31)] };
    service.listRoleMemberIds.mockResolvedValue({ ...found, secret: 'dropped' });
    const response = await read('role-members', query);
    expect(response.json()).toEqual(found);
    expect(service.listRoleMemberIds).toHaveBeenCalledWith(GUILD, query);
  });
});

describe('POST info/invite', () => {
  const request = (payload: object) => ({
    method: 'POST' as const,
    url: url('invite'),
    payload,
  });

  it('is guarded as a write and validated', async () => {
    await expectGuarded(test, request({ channelId: CHANNEL }));
    await expectInvalid(test, request({}), 'channelId');
    expect(service.createInvite).not.toHaveBeenCalled();
  });

  it('creates the invite as the HTTP caller', async () => {
    const invite = { url: 'https://discord.gg/abc', channelId: CHANNEL, channelName: 'general' };
    service.createInvite.mockResolvedValue(invite);
    const response = await test.app.inject({
      ...request({ channelId: CHANNEL, reason: 'for a guest' }),
      headers: asUser(),
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual(invite);
    expect(service.createInvite).toHaveBeenCalledWith(
      GUILD,
      { channelId: CHANNEL, reason: 'for a guest' },
      HTTP_ACTOR,
    );
  });
});
