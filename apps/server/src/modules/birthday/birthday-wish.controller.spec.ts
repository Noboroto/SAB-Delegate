import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GUILD,
  HTTP_ACTOR,
  asUser,
  createRestApp,
  expectGuarded,
  expectInvalid,
  type RestTestApp,
} from '../../common/rest/rest-test-app.js';
import { ServiceError } from '../../common/errors/service-error.js';
import { BirthdayWishController } from './birthday-wish.controller.js';
import { BirthdayWishService } from './birthday-wish.service.js';

const service = { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() };
const WISH = { id: '0190a3b4-0000-7000-8000-000000000001', text: 'Chúc ${name}!', used: false };
const base = `/api/guilds/${GUILD}/birthday-wishes`;
let test: RestTestApp;

beforeAll(async () => {
  test = await createRestApp(
    [BirthdayWishController],
    [{ provide: BirthdayWishService, useValue: service }],
  );
});
afterAll(async () => {
  await test.app.close();
});
beforeEach(() => {
  vi.clearAllMocks();
  service.list.mockResolvedValue([{ ...WISH, guildId: 'internal' }]);
  service.create.mockResolvedValue(WISH);
  service.update.mockResolvedValue({ ...WISH, text: 'Mừng ${name}' });
  service.remove.mockResolvedValue(undefined);
});

describe('GET birthday-wishes', () => {
  it('is closed to people who may not manage the server', async () => {
    await expectGuarded(test, { method: 'GET', url: base });
    expect(service.list).not.toHaveBeenCalled();
  });

  it('lists the columns of the view and nothing else', async () => {
    const response = await test.app.inject({ method: 'GET', url: base, headers: asUser() });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([WISH]);
    expect(service.list).toHaveBeenCalledWith(GUILD);
  });
});

describe('POST birthday-wishes', () => {
  it('is guarded and adds the trimmed text as the signed-in person', async () => {
    await expectGuarded(test, { method: 'POST', url: base, payload: { text: 'Hi ${name}' } });
    const response = await test.app.inject({
      method: 'POST',
      url: base,
      headers: asUser(),
      payload: { text: '  Hi ${name}  ', used: true },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual(WISH);
    expect(service.create).toHaveBeenCalledWith(GUILD, { text: 'Hi ${name}' }, HTTP_ACTOR);
  });

  it('rejects a wish that never mentions the celebrant', async () => {
    await expectInvalid(test, { method: 'POST', url: base, payload: { text: 'Hi' } }, 'text');
  });

  it('answers 409 with the limit once the server is full', async () => {
    service.create.mockRejectedValueOnce(
      new ServiceError('BIRTHDAY_WISH_LIMIT_REACHED', { max: 200 }),
    );
    const response = await test.app.inject({
      method: 'POST',
      url: base,
      headers: asUser(),
      payload: { text: 'Hi ${name}' },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json<{ code: string }>().code).toBe('BIRTHDAY_WISH_LIMIT_REACHED');
  });
});

describe('PATCH and DELETE birthday-wishes/:id', () => {
  it('rewrites the named wish', async () => {
    await expectGuarded(test, {
      method: 'PATCH',
      url: `${base}/${WISH.id}`,
      payload: { text: 'Mừng ${name}' },
    });
    const response = await test.app.inject({
      method: 'PATCH',
      url: `${base}/${WISH.id}`,
      headers: asUser(),
      payload: { text: 'Mừng ${name}' },
    });
    expect(response.statusCode).toBe(200);
    expect(service.update).toHaveBeenCalledWith(
      GUILD,
      WISH.id,
      { text: 'Mừng ${name}' },
      HTTP_ACTOR,
    );
  });

  it('removes the named wish with no body, and answers 404 for an unknown one', async () => {
    await expectGuarded(test, { method: 'DELETE', url: `${base}/${WISH.id}` });
    const removed = await test.app.inject({
      method: 'DELETE',
      url: `${base}/${WISH.id}`,
      headers: asUser(),
    });
    expect(removed.statusCode).toBe(204);
    expect(service.remove).toHaveBeenCalledWith(GUILD, WISH.id, HTTP_ACTOR);

    service.remove.mockRejectedValueOnce(new ServiceError('BIRTHDAY_WISH_NOT_FOUND'));
    const missing = await test.app.inject({
      method: 'DELETE',
      url: `${base}/${WISH.id}`,
      headers: asUser(),
    });
    expect(missing.statusCode).toBe(404);
  });
});
