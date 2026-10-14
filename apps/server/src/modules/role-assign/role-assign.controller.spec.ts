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
import { RoleAssignController } from './role-assign.controller.js';
import { RoleAssignService } from './role-assign.service.js';

const service = { applyToMembers: vi.fn(), applyToReactors: vi.fn() };
const RESULT = {
  dryRun: true,
  status: 'OK',
  planned: 2,
  done: 0,
  skipped: 0,
  sample: [],
  failures: [],
};
const ROLE = snowflake(30);
const MEMBERS = { roleId: ROLE, userIds: [snowflake(31), snowflake(32)] };
const REACTORS = {
  roleId: ROLE,
  channelId: snowflake(10),
  messageId: snowflake(11),
  emoji: '👍',
};
let test: RestTestApp;

beforeAll(async () => {
  test = await createRestApp(
    [RoleAssignController],
    [{ provide: RoleAssignService, useValue: service }],
  );
});
afterAll(async () => {
  await test.app.close();
});
beforeEach(() => {
  vi.clearAllMocks();
  service.applyToMembers.mockResolvedValue(RESULT);
  service.applyToReactors.mockResolvedValue(RESULT);
});

const post = (path: string, payload: object) => ({
  method: 'POST' as const,
  url: `/api/guilds/${GUILD}/role-assign/${path}`,
  payload,
});
const send = (path: string, payload: object) =>
  test.app.inject({ ...post(path, payload), headers: asUser() });

describe.each([
  ['members', 'applyToMembers', MEMBERS],
  ['reactors', 'applyToReactors', REACTORS],
] as const)('POST role-assign/%s', (path, method, body) => {
  it('is closed to strangers and to people who may not manage the server', async () => {
    await expectGuarded(test, post(path, { ...body, confirm: true }));
    expect(service[method]).not.toHaveBeenCalled();
  });

  it('refuses to run without confirm, and without calling the service', async () => {
    await expectInvalid(test, post(path, body), 'confirm');
    await expectInvalid(test, post(path, { ...body, confirm: false }), 'confirm');
    expect(service[method]).not.toHaveBeenCalled();
  });

  it('previews through the service without confirm', async () => {
    const response = await send(path, { ...body, dryRun: true });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(RESULT);
    const [guildId, input, actor, opts] = service[method].mock.calls[0] as unknown[];
    expect(guildId).toBe(GUILD);
    expect(actor).toEqual(HTTP_ACTOR);
    expect(input).toMatchObject(body);
    expect(opts).toEqual({ dryRun: true });
  });

  it('runs for real with confirm, in this server only', async () => {
    await send(path, { ...body, confirm: true, crossGuild: true });
    const [, input, actor, opts] = service[method].mock.calls[0] as unknown[];
    expect(actor).toEqual(HTTP_ACTOR);
    expect(input).not.toHaveProperty('crossGuild');
    expect(opts).toEqual({ dryRun: false });
  });
});

describe('POST role-assign/members body', () => {
  it('needs somebody to change', async () => {
    await expectInvalid(test, post('members', { roleId: ROLE, confirm: true }), 'userIds');
  });
  it('rejects a malformed role id', async () => {
    await expectInvalid(test, post('members', { ...MEMBERS, roleId: 'x', dryRun: true }), 'roleId');
  });
});
