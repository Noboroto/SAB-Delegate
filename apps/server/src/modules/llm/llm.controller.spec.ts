import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GUILD,
  asUser,
  createRestApp,
  expectGuarded,
  expectInvalid,
  type RestTestApp,
} from '../../common/rest/rest-test-app.js';
import { LlmController } from './llm.controller.js';
import { LlmService } from './llm.service.js';

const llm = { adminGuildId: GUILD, listGlobalModels: vi.fn() };

const url = `/api/guilds/${GUILD}/llm/models`;
const OTHER_GUILD = '100000000000000777';
const body = { baseUrl: 'https://llm.example.test/v1' };

let test: RestTestApp;

beforeAll(async () => {
  test = await createRestApp([LlmController], [{ provide: LlmService, useValue: llm }]);
});
afterAll(async () => {
  await test.app.close();
});
beforeEach(() => {
  vi.resetAllMocks();
  llm.listGlobalModels.mockResolvedValue({ ok: true, models: ['a', 'b'] });
});

const post = (payload: object, path = url) =>
  test.app.inject({ method: 'POST', url: path, payload, headers: asUser() });

describe('POST llm/models', () => {
  it('is closed to strangers and to people who cannot manage the server', async () => {
    await expectGuarded(test, { method: 'POST', url, payload: body });
  });

  it('answers 200 with the list and passes only the known fields on', async () => {
    const response = await post({ ...body, apiKey: 'k'.repeat(16), extra: 1 });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, models: ['a', 'b'] });
    expect(llm.listGlobalModels).toHaveBeenCalledWith({ ...body, apiKey: 'k'.repeat(16) });
  });

  it('answers a failure as ok:false with its reason', async () => {
    llm.listGlobalModels.mockResolvedValue({ ok: false, reason: 'unauthorized' });
    const response = await post(body);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: false, reason: 'unauthorized' });
  });

  it('is only for the admin server', async () => {
    const response = await post(body, `/api/guilds/${OTHER_GUILD}/llm/models`);
    expect(response.statusCode).toBe(404);
    expect(response.json<{ code: string }>().code).toBe('GUILD_NOT_FOUND');
    expect(llm.listGlobalModels).not.toHaveBeenCalled();
  });

  it('refuses a plain-http address', async () => {
    await expectInvalid(
      test,
      { method: 'POST', url, payload: { baseUrl: 'http://llm.example.test/v1' } },
      'baseUrl',
    );
    expect(llm.listGlobalModels).not.toHaveBeenCalled();
  });
});
