import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GUILD,
  asUser,
  createRestApp,
  expectGuarded,
  expectInvalid,
  snowflake,
  type RestTestApp,
} from '../../common/rest/rest-test-app.js';
import { AttendanceController } from './attendance.controller.js';
import { AttendanceService } from './attendance.service.js';

const service = { checkByRole: vi.fn() };
const QUERY = { roleId: snowflake(30), voiceChannelId: snowflake(80) };
const RESULT = {
  roleId: QUERY.roleId,
  roleName: 'Members',
  voiceChannelId: QUERY.voiceChannelId,
  total: 2,
  present: [{ userId: snowflake(31), username: 'a' }],
  absent: [{ userId: snowflake(32), username: 'b' }],
};
let test: RestTestApp;

beforeAll(async () => {
  test = await createRestApp(
    [AttendanceController],
    [{ provide: AttendanceService, useValue: service }],
  );
});
afterAll(async () => {
  await test.app.close();
});
beforeEach(() => {
  vi.clearAllMocks();
  service.checkByRole.mockResolvedValue(RESULT);
});

const get = (query: string) => ({
  method: 'GET' as const,
  url: `/api/guilds/${GUILD}/attendance?${query}`,
});
const qs = (query: Record<string, string>) => new URLSearchParams(query).toString();

describe('GET attendance', () => {
  it('is closed to strangers and to people who may not manage the server', async () => {
    await expectGuarded(test, get(qs(QUERY)));
    expect(service.checkByRole).not.toHaveBeenCalled();
  });

  it('answers 400 for a missing voice channel', async () => {
    await expectInvalid(test, get(qs({ roleId: QUERY.roleId })), 'voiceChannelId');
  });

  it('reads this server, with a cached permission answer, and strips unknown query fields', async () => {
    const response = await test.app.inject({
      ...get(qs({ ...QUERY, other: 'x' })),
      headers: asUser(),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(RESULT);
    expect(test.assertManageGuild).toHaveBeenLastCalledWith(expect.any(String), GUILD, {
      fresh: false,
    });
    expect(service.checkByRole).toHaveBeenCalledWith(GUILD, QUERY);
  });
});
