import 'reflect-metadata';
import { Controller, Get, Post, UseGuards, type ExecutionContext } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { ErrorCode } from '@sab/shared';
import { Client } from 'discord.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AllExceptionsFilter } from '../filters/all-exceptions.filter.js';
import { UserGuildsClient } from './user-guilds.client.js';
import type { SessionPrincipal } from '../../auth/principal.decorator.js';
import { SessionService } from '../../auth/session.service.js';
import { ApiError, errorBody } from '../errors/http-error.js';
import { GuildAccessService, GuildNotFoundError } from './guild-access.service.js';
import { ManageGuildGuard } from './manage-guild.guard.js';

const USER = '200000000000000001';
const GUILD = '100000000000000001';

function setup(options: { signedIn?: boolean; allowed?: boolean; failure?: Error } = {}) {
  const { signedIn = true, allowed = true, failure } = options;
  const principal: SessionPrincipal = { discordUserId: USER, createdAt: new Date() };
  const requirePrincipal = vi.fn(() =>
    signedIn
      ? Promise.resolve(principal)
      : Promise.reject(new ApiError(ErrorCode.AUTH_UNAUTHENTICATED)),
  );
  const assertManageGuild = vi.fn(() => {
    if (failure !== undefined) return Promise.reject(failure);
    return allowed ? Promise.resolve() : Promise.reject(new GuildNotFoundError());
  });
  const guard = new ManageGuildGuard(
    { requirePrincipal } as unknown as SessionService,
    { assertManageGuild } as unknown as GuildAccessService,
  );
  const run = (method: string, params: Record<string, unknown> = { guildId: GUILD }) =>
    guard.canActivate({
      switchToHttp: () => ({ getRequest: () => ({ method, params, headers: {} }) }),
    } as unknown as ExecutionContext);
  return { run, assertManageGuild, requirePrincipal };
}

describe('ManageGuildGuard', () => {
  it('lets a manager through and asks about this caller and this server', async () => {
    const { run, assertManageGuild } = setup();
    expect(await run('GET')).toBe(true);
    expect(assertManageGuild).toHaveBeenCalledWith(
      USER,
      GUILD,
      expect.objectContaining({ fresh: false }),
    );
  });

  it.each(['POST', 'PATCH', 'PUT', 'DELETE'])('asks Discord again for %s', async (method) => {
    const { run, assertManageGuild } = setup();
    await run(method);
    expect(assertManageGuild).toHaveBeenCalledWith(
      USER,
      GUILD,
      expect.objectContaining({ fresh: true }),
    );
  });

  it('answers 401 before looking at the server when nobody is signed in', async () => {
    const { run, assertManageGuild } = setup({ signedIn: false });
    await expect(run('GET')).rejects.toMatchObject({ code: ErrorCode.AUTH_UNAUTHENTICATED });
    expect(assertManageGuild).not.toHaveBeenCalled();
  });

  it('gives a stranger, a server without the bot and a missing right the same refusal', async () => {
    const refusal = await setup({ allowed: false })
      .run('GET')
      .catch((e: unknown) => e);
    expect(refusal).toBeInstanceOf(GuildNotFoundError);
    // The error carries only the code; the response body derives from it alone.
    expect(errorBody((refusal as GuildNotFoundError).code)).toEqual(
      errorBody(ErrorCode.GUILD_NOT_FOUND),
    );
  });

  it.each([undefined, '', 'abc', '12', '1'.repeat(30), '../health'])(
    'refuses the server id %j without asking Discord',
    async (guildId) => {
      const { run, assertManageGuild } = setup();
      await expect(run('GET', { guildId })).rejects.toBeInstanceOf(GuildNotFoundError);
      expect(assertManageGuild).not.toHaveBeenCalled();
    },
  );

  it('lets a Discord failure through unchanged instead of calling it "no access"', async () => {
    const failure = new Error('discord down');
    await expect(setup({ failure }).run('GET')).rejects.toBe(failure);
  });
});

// The same guard on real routes, with the real access service in front of a
// fake Discord: what a client can observe from outside.
describe('ManageGuildGuard on a route', () => {
  const MANAGE_GUILD = 1n << 5n;
  const BOT_GUILD = '100000000000000009';
  const STRANGER_GUILD = '100000000000000008';
  const rights = new Map<string, bigint>();
  /** The servers each person's own Discord login lists as manageable. */
  const lists = new Map<string, string[]>();
  const fetchMember = vi.fn(({ user }: { user: string }) => {
    const bits = rights.get(user);
    if (bits === undefined) {
      return Promise.reject(Object.assign(new Error('Unknown Member'), { code: 10007 }));
    }
    return Promise.resolve({ permissions: { bitfield: bits } });
  });
  const client = {
    guilds: {
      cache: new Map([[BOT_GUILD, { ownerId: '9'.repeat(18), members: { fetch: fetchMember } }]]),
    },
  };

  @Controller('api/guilds/:guildId/probe')
  @UseGuards(ManageGuildGuard)
  class Probe {
    @Get()
    read(): { ok: true } {
      return { ok: true };
    }
    @Post()
    write(): { ok: true } {
      return { ok: true };
    }
  }

  const sessions = {
    discordAccessToken: (headers: Record<string, unknown>) =>
      Promise.resolve(
        typeof headers['x-user'] === 'string' && headers['x-no-token'] === undefined
          ? headers['x-user']
          : null,
      ),
    requirePrincipal: (request: { headers: Record<string, unknown> }) => {
      const user = request.headers['x-user'];
      return typeof user === 'string'
        ? Promise.resolve({ discordUserId: user, createdAt: new Date() })
        : Promise.reject(new ApiError(ErrorCode.AUTH_UNAUTHENTICATED));
    },
  };

  let app: NestFastifyApplication;
  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [Probe],
      providers: [
        GuildAccessService,
        {
          provide: UserGuildsClient,
          useValue: {
            // The fake token is the user id.
            manageableGuilds: (token: string) =>
              Promise.resolve((lists.get(token) ?? []).map((id) => ({ id, name: id, icon: null }))),
          },
        },
        { provide: Client, useValue: client },
        { provide: SessionService, useValue: sessions },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
      ],
    }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    rights.clear();
    lists.clear();
    fetchMember.mockClear();
  });

  const call = (method: 'GET' | 'POST', guild: string, user: string | undefined) =>
    app.inject({
      method,
      url: `/api/guilds/${guild}/probe`,
      headers: user === undefined ? {} : { 'x-user': user },
    });

  it('answers 401, 200, and the same 404 for a stranger, an absent bot and a malformed id', async () => {
    const manager = '700000000000000001';
    const outsider = '700000000000000002';
    rights.set(manager, MANAGE_GUILD);
    rights.set(outsider, 0n);
    lists.set(manager, [BOT_GUILD, STRANGER_GUILD]);

    expect((await call('GET', BOT_GUILD, undefined)).statusCode).toBe(401);
    expect((await call('GET', BOT_GUILD, manager)).statusCode).toBe(200);

    const noRight = await call('GET', BOT_GUILD, outsider);
    const noBot = await call('GET', STRANGER_GUILD, manager);
    const notMember = await call('GET', BOT_GUILD, '700000000000000003');
    const malformed = await call('GET', 'not-a-server', manager);
    for (const response of [noRight, noBot, notMember, malformed]) {
      expect(response.statusCode).toBe(404);
      expect(response.body).toBe(noRight.body);
    }
    expect(JSON.parse(noRight.body)).toMatchObject({ code: 'GUILD_NOT_FOUND' });
  });

  it('lets a read use a recent answer but makes a write ask Discord again', async () => {
    const user = '700000000000000010';
    rights.set(user, MANAGE_GUILD);
    lists.set(user, [BOT_GUILD]);
    expect((await call('GET', BOT_GUILD, user)).statusCode).toBe(200);

    rights.set(user, 0n);
    expect((await call('GET', BOT_GUILD, user)).statusCode).toBe(200);
    expect(fetchMember).toHaveBeenCalledTimes(1);
    const write = await call('POST', BOT_GUILD, user);
    expect(write.statusCode).toBe(404);
    expect(fetchMember).toHaveBeenCalledTimes(2);
  });

  it('refuses a server outside the caller own list without asking Discord about the member', async () => {
    const user = '700000000000000020';
    // The right exists on the server, but the person's login does not list it.
    rights.set(user, MANAGE_GUILD);
    lists.set(user, [STRANGER_GUILD]);

    const response = await call('GET', BOT_GUILD, user);
    expect(response.statusCode).toBe(404);
    expect(JSON.parse(response.body)).toMatchObject({ code: 'GUILD_NOT_FOUND' });
    expect(fetchMember).not.toHaveBeenCalled();
  });

  it('asks for a new login when the session holds no Discord token', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/guilds/${BOT_GUILD}/probe`,
      headers: { 'x-user': '700000000000000021', 'x-no-token': '1' },
    });
    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.body)).toMatchObject({ code: 'AUTH_REAUTH_REQUIRED' });
  });
});
