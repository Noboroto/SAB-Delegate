import 'reflect-metadata';
import { StandardSchemaValidationPipe, type Provider, type Type } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { ErrorCode } from '@sab/shared';
import { expect, vi } from 'vitest';
import type { PrincipalRequest } from '../../auth/principal.decorator.js';
import { SessionService } from '../../auth/session.service.js';
import { ApiError, validationFailed } from '../errors/http-error.js';
import { AllExceptionsFilter } from '../filters/all-exceptions.filter.js';
import { GuildAccessService, GuildNotFoundError } from '../guild-access/guild-access.service.js';
import { GuildActionLimiter } from '../limiter/guild-action.limiter.js';

/** Snowflake-shaped ids built at run time, so no fixture looks like a real id or token. */
export const snowflake = (n: number): string => String(100_000_000_000_000_000n + BigInt(n));

export const GUILD = snowflake(1);
const USER = snowflake(900);

/**
 * Boots only the given controllers behind the real `ManageGuildGuard`, the
 * global validation pipe and the HTTP error filter, the way `main.ts` wires
 * them. The login is the `x-user` header; Discord permission is a mock.
 */
export async function createRestApp(controllers: Type[], providers: Provider[]) {
  const assertManageGuild = vi.fn(() => Promise.resolve());
  const consume = vi.fn();
  const sessions = {
    requirePrincipal: (request: PrincipalRequest) => {
      const user = request.headers['x-user'];
      if (typeof user !== 'string') {
        return Promise.reject(new ApiError(ErrorCode.AUTH_UNAUTHENTICATED));
      }
      const principal = { discordUserId: user, createdAt: new Date() };
      request.principal = principal;
      return Promise.resolve(principal);
    },
  };
  const moduleRef = await Test.createTestingModule({
    controllers,
    providers: [
      { provide: SessionService, useValue: sessions },
      { provide: GuildAccessService, useValue: { assertManageGuild } },
      { provide: GuildActionLimiter, useValue: { consume } },
      {
        provide: APP_PIPE,
        useValue: new StandardSchemaValidationPipe({ exceptionFactory: validationFailed }),
      },
      { provide: APP_FILTER, useClass: AllExceptionsFilter },
      ...providers,
    ],
  }).compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return { app, assertManageGuild, consume };
}

/** The permission answer of `assertManageGuild` resolves to allow and rejects to refuse; `consume` stands in for the shared action limiter. */
export type RestTestApp = Awaited<ReturnType<typeof createRestApp>>;

export const asUser = (): Record<string, string> => ({ 'x-user': USER });

type Call = { method: 'GET' | 'POST' | 'PATCH' | 'DELETE'; url: string; payload?: object };

/** A route is closed to a stranger (401) and to someone who may not manage the server (the one 404). */
export async function expectGuarded(test: RestTestApp, call: Call): Promise<void> {
  const anonymous = await test.app.inject(call);
  expect(anonymous.statusCode).toBe(401);
  expect(anonymous.json<{ code: string }>().code).toBe('AUTH_UNAUTHENTICATED');

  test.assertManageGuild.mockRejectedValueOnce(new GuildNotFoundError());
  const refused = await test.app.inject({ ...call, headers: asUser() });
  expect(refused.statusCode).toBe(404);
  expect(refused.json<{ code: string }>().code).toBe('GUILD_NOT_FOUND');
  // The permission is asked about this person and this server, with a fresh answer for writes.
  expect(test.assertManageGuild).toHaveBeenLastCalledWith(USER, GUILD, {
    fresh: call.method !== 'GET',
  });
}

/** A body that fails validation answers the 400 `{ code, message, details.issues[] }` contract. */
export async function expectInvalid(test: RestTestApp, call: Call, field: string): Promise<void> {
  const response = await test.app.inject({ ...call, headers: asUser() });
  expect(response.statusCode).toBe(400);
  const body = response.json<{
    code: string;
    message: string;
    details: { issues: { path: string; message: string }[] };
  }>();
  expect(body.code).toBe('VALIDATION_FAILED');
  expect(typeof body.message).toBe('string');
  expect(body.details.issues.map((issue) => issue.path)).toContain(field);
}

/** What every service call from a REST controller carries as its actor. */
export const HTTP_ACTOR = { source: 'HTTP', userId: USER } as const;
