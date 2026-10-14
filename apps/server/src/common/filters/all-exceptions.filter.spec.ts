import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import {
  Body,
  Controller,
  Get,
  HttpException,
  Logger,
  NotFoundException,
  Post,
  ServiceUnavailableException,
  StandardSchemaValidationPipe,
  type ArgumentsHost,
} from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { ErrorCode, MESSAGES, z } from '@sab/shared';
import { DiscordAPIError, HTTPError, RateLimitError } from 'discord.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, validationFailed } from '../errors/http-error.js';
import { ServiceError } from '../errors/service-error.js';
import { AllExceptionsFilter } from './all-exceptions.filter.js';

const leak = `leak-${randomBytes(8).toString('hex')}`;

class PrismaClientKnownRequestError extends Error {
  readonly code = 'P2002';
  constructor() {
    super(`Unique constraint failed on the fields: (\`${leak}\`) in table "${leak}"`);
    this.name = 'PrismaClientKnownRequestError';
  }
}

const discordApiError = (status: number, code = 0): DiscordAPIError =>
  new DiscordAPIError({ message: leak, code }, code, status, 'GET', '/x', {});

const BodySchema = z.object({ name: z.string().min(1), count: z.number().int().optional() });

@Controller('t')
class ThrowingController {
  @Get('service-denied')
  denied(): never {
    throw new ServiceError(ErrorCode.GUILD_ACCESS_DENIED);
  }
  @Get('service-missing')
  missing(): never {
    throw new ServiceError(ErrorCode.GUILD_NOT_FOUND);
  }
  @Get('service-bot-missing')
  botMissing(): never {
    throw new ServiceError(ErrorCode.GUILD_BOT_MISSING);
  }
  @Get('service-permission')
  permission(): never {
    throw new ServiceError(ErrorCode.DISCORD_MISSING_PERMISSIONS, { permission: 'send' });
  }
  @Get('api-error')
  apiError(): never {
    throw new ApiError(ErrorCode.AUTH_REAUTH_REQUIRED);
  }
  @Get('http-404')
  http404(): never {
    throw new NotFoundException(leak);
  }
  @Get('http-401')
  http401(): never {
    throw new HttpException(leak, 401);
  }
  @Get('http-teapot')
  teapot(): never {
    throw new HttpException(leak, 418);
  }
  @Get('prisma')
  prisma(): never {
    throw new PrismaClientKnownRequestError();
  }
  @Get('unknown')
  unknown(): never {
    throw new Error(`password=${leak}`);
  }
  @Get('thrown-string')
  thrownString(): never {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- a non-Error value is exactly the case under test
    throw leak;
  }
  @Get('discord-rate-limit')
  rateLimited(): never {
    throw new RateLimitError({
      timeToReset: 1,
      limit: 1,
      method: 'GET',
      hash: leak,
      url: '/x',
      route: '/x',
      majorParameter: leak,
      global: false,
      retryAfter: 1,
      sublimitTimeout: 0,
      scope: 'user',
    });
  }
  @Get('discord-429')
  discord429(): never {
    throw discordApiError(429);
  }
  @Get('discord-500')
  discord500(): never {
    throw discordApiError(500);
  }
  @Get('discord-403')
  discord403(): never {
    throw discordApiError(403, 50013);
  }
  @Get('discord-http')
  discordHttp(): never {
    throw new HTTPError(502, 'Bad Gateway', 'GET', '/x', {});
  }
  @Post('body')
  body(@Body({ schema: BodySchema }) body: z.infer<typeof BodySchema>): unknown {
    return body;
  }
}

@Controller('health')
class HealthLikeController {
  @Get()
  check(): never {
    throw new ServiceUnavailableException({ status: 'unavailable', checks: { database: 'down' } });
  }
}

let app: NestFastifyApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [ThrowingController, HealthLikeController],
    providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
  }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  app.useGlobalPipes(new StandardSchemaValidationPipe({ exceptionFactory: validationFailed }));
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app.close();
});

let logged: string[];
beforeEach(() => {
  logged = [];
  vi.spyOn(Logger.prototype, 'error').mockImplementation((message: unknown) => {
    logged.push(String(message));
  });
});

async function get(path: string) {
  const response = await app.inject({ method: 'GET', url: `/t/${path}` });
  return {
    status: response.statusCode,
    body: response.json<Record<string, unknown>>(),
    raw: response.body,
  };
}

describe('AllExceptionsFilter over HTTP', () => {
  it('answers a stranger, a missing bot and a missing right with the identical 404 body', async () => {
    const [denied, missing, botMissing] = await Promise.all([
      get('service-denied'),
      get('service-missing'),
      get('service-bot-missing'),
    ]);
    expect(denied.status).toBe(404);
    expect(denied.raw).toBe(missing.raw);
    expect(botMissing.raw).toBe(missing.raw);
    expect(missing.body).toEqual({
      code: 'GUILD_NOT_FOUND',
      message: MESSAGES.en.errors.GUILD_NOT_FOUND,
    });
  });

  it('renders a ServiceError from the catalog, placeholders filled, with its status', async () => {
    const { status, body } = await get('service-permission');
    expect(status).toBe(422);
    expect(body['code']).toBe('DISCORD_MISSING_PERMISSIONS');
    expect(String(body['message'])).toContain('send messages');
    expect(String(body['message'])).not.toContain('{');
  });

  it('passes an ApiError through unchanged', async () => {
    const { status, body } = await get('api-error');
    expect(status).toBe(403);
    expect(body).toEqual({
      code: 'AUTH_REAUTH_REQUIRED',
      message: MESSAGES.en.errors.AUTH_REAUTH_REQUIRED,
    });
  });

  it.each([
    ['http-404', 404, 'GUILD_NOT_FOUND'],
    ['http-401', 401, 'AUTH_UNAUTHENTICATED'],
    ['http-teapot', 418, 'VALIDATION_FAILED'],
    ['nope', 404, 'GUILD_NOT_FOUND'],
  ])(
    'maps the HTTP exception on %s to %i %s without reading its message',
    async (path, status, code) => {
      const response = await get(path);
      expect(response.status).toBe(status);
      expect(response.body['code']).toBe(code);
      expect(response.raw).not.toContain(leak);
    },
  );

  it.each(['prisma', 'unknown', 'thrown-string'])(
    'answers 500 INTERNAL for %s and leaks nothing',
    async (path) => {
      const response = await get(path);
      expect(response.status).toBe(500);
      expect(response.body).toEqual({ code: 'INTERNAL', message: MESSAGES.en.errors.INTERNAL });
      expect(response.raw).not.toContain(leak);
      expect(logged).toHaveLength(1);
      expect(logged.join('\n')).not.toContain(leak);
    },
  );

  it('logs a database error by class and code only', async () => {
    await get('prisma');
    expect(logged[0]).toContain('PrismaClientKnownRequestError P2002');
    expect(logged[0]).toContain('GET /t/prisma');
  });

  it('does not log an expected failure', async () => {
    await get('service-denied');
    await get('api-error');
    await get('http-404');
    expect(logged).toEqual([]);
  });

  it.each([
    ['discord-rate-limit', 429, 'RATE_LIMITED'],
    ['discord-429', 429, 'RATE_LIMITED'],
    ['discord-500', 502, 'DISCORD_API_ERROR'],
    ['discord-403', 502, 'DISCORD_API_ERROR'],
    ['discord-http', 502, 'DISCORD_API_ERROR'],
  ])('turns the Discord failure on %s into %i %s', async (path, status, code) => {
    const response = await get(path);
    expect(response.status).toBe(status);
    expect(response.body['code']).toBe(code);
    expect(response.raw).not.toContain(leak);
  });

  it('keeps the readiness probe body', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: 'unavailable', checks: { database: 'down' } });
  });
});

describe('request validation', () => {
  const post = (payload: unknown) =>
    app.inject({
      method: 'POST',
      url: '/t/body',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify(payload),
    });

  it('answers 400 VALIDATION_FAILED with the field path and no submitted value', async () => {
    const secret = `value-${randomBytes(6).toString('hex')}`;
    const response = await post({ name: '', count: secret });
    expect(response.statusCode).toBe(400);
    const body = response.json<{ code: string; details: { issues: Array<{ path: string }> } }>();
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.details.issues.map((issue) => issue.path).sort()).toEqual(['count', 'name']);
    expect(response.body).not.toContain(secret);
  });

  it('strips a field the schema does not declare instead of rejecting or keeping it', async () => {
    const response = await post({ name: 'x', admin: true });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ name: 'x' });
  });

  it('answers 400 VALIDATION_FAILED for a body that is not JSON', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/t/body',
      headers: { 'content-type': 'application/json' },
      payload: `{"name": ${leak}`,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ code: string }>().code).toBe('VALIDATION_FAILED');
    expect(response.body).not.toContain(leak);
  });
});

describe('AllExceptionsFilter outside HTTP', () => {
  it('logs and re-throws instead of replying, for the Discord context', () => {
    const filter = new AllExceptionsFilter();
    const failure = new Error('interaction failed');
    const switchToHttp = vi.fn();
    const host = { getType: () => 'necord', switchToHttp } as unknown as ArgumentsHost;
    expect(() => filter.catch(failure, host)).toThrow(failure);
    expect(switchToHttp).not.toHaveBeenCalled();
  });
});
