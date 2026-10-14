import 'reflect-metadata';
import cookie from '@fastify/cookie';
import { StandardSchemaValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { ErrorCode } from '@sab/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTH_COOKIE_PREFIX, REST_SETTINGS } from '../../auth/better-auth.js';
import { OriginGuard } from '../../auth/origin.guard.js';
import type { PrincipalRequest } from '../../auth/principal.decorator.js';
import { SessionService } from '../../auth/session.service.js';
import { fastifyOptions } from '../../bootstrap/security-config.js';
import { ApiError, validationFailed } from '../../common/errors/http-error.js';
import { ServiceError } from '../../common/errors/service-error.js';
import { AllExceptionsFilter } from '../../common/filters/all-exceptions.filter.js';
import { snowflake } from '../../common/rest/rest-test-app.js';
import { ApiKeyController } from './api-key.controller.js';
import { ApiKeyService } from './api-key.service.js';

const APP_ORIGIN = 'https://bot.example.test';
const USER = snowflake(900);
const KEY_ID = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
const NOW = new Date('2026-10-14T00:00:00.000Z');
const VIEW = {
  id: KEY_ID,
  name: 'agent',
  prefix: 'sab_AbCd',
  mode: 'READ' as const,
  lastUsedIp: null,
  lastUsedAt: null,
  expiresAt: new Date('2027-01-12T00:00:00.000Z'),
  revokedAt: null,
  createdAt: NOW,
};
// Built at run time so no fixture reads as a real credential.
const PLAINTEXT = `sab_${'x'.repeat(43)}`;

const service = { list: vi.fn(), mint: vi.fn(), revoke: vi.fn() };

/** `x-user` is the signed-in account, `x-login-age-min` how long ago that login happened. */
const sessions = {
  requirePrincipal: (request: PrincipalRequest) => {
    const user = request.headers['x-user'];
    if (typeof user !== 'string') {
      return Promise.reject(new ApiError(ErrorCode.AUTH_UNAUTHENTICATED));
    }
    const age = Number(request.headers['x-login-age-min'] ?? 0);
    const principal = { discordUserId: user, createdAt: new Date(Date.now() - age * 60_000) };
    request.principal = principal;
    return Promise.resolve(principal);
  },
};

let app: NestFastifyApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [ApiKeyController],
    providers: [
      { provide: SessionService, useValue: sessions },
      { provide: ApiKeyService, useValue: service },
      { provide: REST_SETTINGS, useValue: { appUrl: APP_ORIGIN } },
      { provide: APP_GUARD, useClass: OriginGuard },
      {
        provide: APP_PIPE,
        useValue: new StandardSchemaValidationPipe({ exceptionFactory: validationFailed }),
      },
      { provide: APP_FILTER, useClass: AllExceptionsFilter },
    ],
  }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(fastifyOptions()),
  );
  await app.register(cookie);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  vi.clearAllMocks();
  service.list.mockResolvedValue([VIEW]);
  service.mint.mockResolvedValue({ ...VIEW, plaintext: PLAINTEXT });
  service.revoke.mockResolvedValue({ ...VIEW, revokedAt: NOW });
});

const login = (extra: Record<string, string> = {}) => ({ 'x-user': USER, ...extra });
const ROUTES = [
  { method: 'GET', url: '/api/me/api-keys' },
  { method: 'POST', url: '/api/me/api-keys', payload: { name: 'agent' } },
  { method: 'DELETE', url: `/api/me/api-keys/${KEY_ID}` },
] as const;

describe('/api/me/api-keys access', () => {
  it.each(ROUTES)('$method answers 401 without a login', async (route) => {
    const response = await app.inject(route);
    expect(response.statusCode).toBe(401);
    expect(response.json<{ code: string }>().code).toBe('AUTH_UNAUTHENTICATED');
  });

  it.each(ROUTES)('$method refuses a bearer header even next to a login', async (route) => {
    const response = await app.inject({
      ...route,
      headers: login({ authorization: `Bearer ${PLAINTEXT}` }),
    });
    expect(response.statusCode).toBe(401);
    expect(service.list).not.toHaveBeenCalled();
    expect(service.mint).not.toHaveBeenCalled();
    expect(service.revoke).not.toHaveBeenCalled();
  });

  it('refuses a bearer header with no cookie at all', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/me/api-keys',
      headers: { authorization: `Bearer ${PLAINTEXT}` },
    });
    expect(response.statusCode).toBe(401);
  });
});

describe('/api/me/api-keys writes from a browser', () => {
  const withCookie = (headers: Record<string, string>) => ({
    ...login(),
    cookie: `${AUTH_COOKIE_PREFIX}.session_token=value`,
    ...headers,
  });

  it('refuses a write that carries the login cookie from another origin', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/me/api-keys',
      payload: { name: 'agent' },
      headers: withCookie({ origin: 'https://evil.example.test' }),
    });
    expect(response.statusCode).toBe(403);
    expect(response.json<{ code: string }>().code).toBe('AUTH_ORIGIN_REJECTED');
    expect(service.mint).not.toHaveBeenCalled();
  });

  it('refuses a revoke from another origin and accepts one from the application', async () => {
    const url = `/api/me/api-keys/${KEY_ID}`;
    const foreign = await app.inject({
      method: 'DELETE',
      url,
      headers: withCookie({ origin: 'https://evil.example.test' }),
    });
    expect(foreign.statusCode).toBe(403);
    const own = await app.inject({
      method: 'DELETE',
      url,
      headers: withCookie({ origin: APP_ORIGIN }),
    });
    expect(own.statusCode).toBe(200);
  });
});

describe('GET /api/me/api-keys', () => {
  it('lists the keys of the signed-in person without hash or owner', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/me/api-keys', headers: login() });
    expect(response.statusCode).toBe(200);
    expect(service.list).toHaveBeenCalledWith(USER);
    expect(response.json<Record<string, unknown>[]>()[0]).toMatchObject({
      id: KEY_ID,
      prefix: 'sab_AbCd',
    });
    expect(response.body).not.toContain('keyHash');
    expect(response.body).not.toContain(USER);
  });
});

describe('POST /api/me/api-keys', () => {
  const mint = (payload: object, headers = login()) =>
    app.inject({ method: 'POST', url: '/api/me/api-keys', payload, headers });

  it('mints a read key with the secret in the answer and a no-store header', async () => {
    const response = await mint({ name: 'agent' });
    expect(response.statusCode).toBe(201);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json<{ plaintext: string }>().plaintext).toBe(PLAINTEXT);
    expect(service.mint).toHaveBeenCalledWith(
      USER,
      { name: 'agent', mode: 'READ', expiresInDays: 90 },
      { source: 'HTTP', userId: USER },
    );
  });

  it('lets a read key through on an old login', async () => {
    expect((await mint({ name: 'agent' }, login({ 'x-login-age-min': '600' }))).statusCode).toBe(
      201,
    );
  });

  it('mints a write key on a login from the last five minutes', async () => {
    const response = await mint({ name: 'w', mode: 'WRITE' }, login({ 'x-login-age-min': '4' }));
    expect(response.statusCode).toBe(201);
    expect(service.mint).toHaveBeenCalledWith(
      USER,
      { name: 'w', mode: 'WRITE', expiresInDays: 30 },
      expect.anything(),
    );
  });

  it('asks a write key on an older login to sign in again and mints nothing', async () => {
    const response = await mint({ name: 'w', mode: 'WRITE' }, login({ 'x-login-age-min': '6' }));
    expect(response.statusCode).toBe(403);
    expect(response.json<{ code: string }>().code).toBe('AUTH_REAUTH_REQUIRED');
    expect(service.mint).not.toHaveBeenCalled();
  });

  it.each([
    ['a missing name', {}],
    ['a read key over 365 days', { name: 'k', expiresInDays: 366 }],
    ['a write key over 30 days', { name: 'k', mode: 'WRITE', expiresInDays: 31 }],
  ])('answers 400 for %s', async (_label, payload) => {
    const response = await mint(payload);
    expect(response.statusCode).toBe(400);
    expect(response.json<{ code: string }>().code).toBe('VALIDATION_FAILED');
    expect(service.mint).not.toHaveBeenCalled();
  });

  it('answers 409 when the person already holds the maximum', async () => {
    service.mint.mockRejectedValueOnce(new ServiceError(ErrorCode.API_KEY_LIMIT_REACHED));
    const response = await mint({ name: 'agent' });
    expect(response.statusCode).toBe(409);
    expect(response.json<{ code: string }>().code).toBe('API_KEY_LIMIT_REACHED');
  });
});

describe('DELETE /api/me/api-keys/:id', () => {
  it('revokes the key for the signed-in person', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: `/api/me/api-keys/${KEY_ID}`,
      headers: login(),
    });
    expect(response.statusCode).toBe(200);
    expect(service.revoke).toHaveBeenCalledWith(USER, KEY_ID, { source: 'HTTP', userId: USER });
    expect(response.json<{ revokedAt: string | null }>().revokedAt).toBe(NOW.toISOString());
  });

  it("answers 404 for a key that is not the caller's", async () => {
    service.revoke.mockRejectedValueOnce(new ServiceError(ErrorCode.API_KEY_NOT_FOUND));
    const response = await app.inject({
      method: 'DELETE',
      url: `/api/me/api-keys/${KEY_ID}`,
      headers: login(),
    });
    expect(response.statusCode).toBe(404);
    expect(response.json<{ code: string }>().code).toBe('API_KEY_NOT_FOUND');
  });
});
