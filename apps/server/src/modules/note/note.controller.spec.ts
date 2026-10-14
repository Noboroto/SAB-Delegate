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
import { NoteController } from './note.controller.js';
import { NoteService } from './note.service.js';

const service = {
  listAll: vi.fn(),
  listByRole: vi.fn(),
  upsert: vi.fn(),
  remove: vi.fn(),
};
const ROLE = snowflake(60);
const UPDATED = new Date('2026-01-02T03:04:05.000Z');
const NOTE = { roleId: ROLE, topic: 'rules', content: 'be kind', updatedAt: UPDATED.toISOString() };
const base = `/api/guilds/${GUILD}/notes`;
let test: RestTestApp;

beforeAll(async () => {
  test = await createRestApp([NoteController], [{ provide: NoteService, useValue: service }]);
});
afterAll(async () => {
  await test.app.close();
});
beforeEach(() => {
  vi.clearAllMocks();
  const row = { ...NOTE, updatedAt: UPDATED, createdAt: new Date() };
  service.listAll.mockResolvedValue([row]);
  service.listByRole.mockResolvedValue([row]);
  service.upsert.mockResolvedValue(row);
  service.remove.mockImplementation((_g, _k, _a, opts: { dryRun: boolean }) =>
    Promise.resolve(
      opts.dryRun ? { count: 1, sample: [{ roleId: ROLE, topic: 'rules' }] } : { count: 1 },
    ),
  );
});

describe('GET notes', () => {
  it('is guarded', async () => {
    await expectGuarded(test, { method: 'GET', url: base });
    expect(service.listAll).not.toHaveBeenCalled();
  });

  it('lists the server, or one role, without columns outside the view', async () => {
    const all = await test.app.inject({ method: 'GET', url: base, headers: asUser() });
    expect(all.json()).toEqual([NOTE]);
    expect(service.listAll).toHaveBeenCalledWith(GUILD);

    await test.app.inject({ method: 'GET', url: `${base}?roleId=${ROLE}`, headers: asUser() });
    expect(service.listByRole).toHaveBeenCalledWith(GUILD, ROLE);
  });

  it('rejects a role that is not an id', async () => {
    await expectInvalid(test, { method: 'GET', url: `${base}?roleId=everyone` }, 'roleId');
  });
});

describe.each(['POST', 'PATCH'] as const)('%s notes', (method) => {
  const payload = { roleId: ROLE, topic: 'rules', content: 'be kind' };

  it('is guarded and validates the body', async () => {
    await expectGuarded(test, { method, url: base, payload });
    await expectInvalid(
      test,
      { method, url: base, payload: { ...payload, content: '   ' } },
      'content',
    );
    await expectInvalid(test, { method, url: base, payload: { ...payload, topic: '' } }, 'topic');
    expect(service.upsert).not.toHaveBeenCalled();
  });

  it('saves for the path server whatever the body says about servers', async () => {
    const response = await test.app.inject({
      method,
      url: base,
      headers: asUser(),
      payload: { ...payload, guildId: snowflake(9) },
    });
    expect(response.statusCode).toBe(method === 'POST' ? 201 : 200);
    expect(response.json()).toEqual(NOTE);
    expect(service.upsert).toHaveBeenCalledWith(GUILD, payload, HTTP_ACTOR);
  });
});

describe('DELETE notes', () => {
  const key = `roleId=${ROLE}&topic=rules`;

  it('is guarded and needs a preview or a confirmation', async () => {
    await expectGuarded(test, { method: 'DELETE', url: `${base}?${key}&confirm=true` });
    await expectInvalid(test, { method: 'DELETE', url: `${base}?${key}` }, 'confirm');
    expect(service.remove).not.toHaveBeenCalled();
  });

  it('previews through the service and deletes only with confirm, in the path server', async () => {
    const preview = await test.app.inject({
      method: 'DELETE',
      url: `${base}?${key}&dryRun=true`,
      headers: asUser(),
    });
    expect(preview.json()).toEqual({ count: 1, sample: [{ roleId: ROLE, topic: 'rules' }] });
    expect(service.remove).toHaveBeenLastCalledWith(
      GUILD,
      { roleId: ROLE, topic: 'rules' },
      HTTP_ACTOR,
      {
        dryRun: true,
      },
    );

    const done = await test.app.inject({
      method: 'DELETE',
      url: `${base}?${key}&confirm=true`,
      headers: asUser(),
    });
    expect(done.json()).toEqual({ count: 1 });
    expect(service.remove).toHaveBeenLastCalledWith(
      GUILD,
      { roleId: ROLE, topic: 'rules' },
      HTTP_ACTOR,
      {
        dryRun: false,
      },
    );
  });

  it('answers only the fields of the plan and result schemas', async () => {
    service.remove.mockResolvedValueOnce({ count: 2, sample: [], guildKey: 'internal' });
    const plan = await test.app.inject({
      method: 'DELETE',
      url: `${base}?${key}&dryRun=true`,
      headers: asUser(),
    });
    expect(plan.json()).toEqual({ count: 2, sample: [] });

    service.remove.mockResolvedValueOnce({ count: 1, guildKey: 'internal' });
    const done = await test.app.inject({
      method: 'DELETE',
      url: `${base}?${key}&confirm=true`,
      headers: asUser(),
    });
    expect(done.json()).toEqual({ count: 1 });
  });
});
