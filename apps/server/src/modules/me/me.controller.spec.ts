import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { Global, Logger, Module } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import {
  BOT_INVITE_PERMISSIONS,
  BOT_INVITE_PERMISSION_BITS,
  ErrorCode,
  GuildPickerItemSchema,
  z,
} from '@sab/shared';
import { Client, DiscordAPIError, PermissionFlagsBits, RateLimitError } from 'discord.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { REST_SETTINGS } from '../../auth/better-auth.js';
import type { PrincipalRequest } from '../../auth/principal.decorator.js';
import { SessionService } from '../../auth/session.service.js';
import { ServiceError } from '../../common/errors/service-error.js';
import {
  DiscordUserClient,
  type DiscordProfile,
} from '../../common/guild-access/discord-user.client.js';
import {
  UserGuildsClient,
  type ManageableGuild,
} from '../../common/guild-access/user-guilds.client.js';
import {
  GUILD_LIST_RATE_LIMIT,
  rateLimitOptions,
} from '../../common/rate-limit/rate-limit.util.js';
import type { RestSettings } from '../../config/env.js';
import { MeModule, meModules } from './me.module.js';

const ORIGIN = 'https://bot.example.test';
const USER = '200000000000000001';
const BOT_GUILD = '100000000000000001';
const BOT_GUILD_2 = '100000000000000002';
const NO_BOT_GUILD = '100000000000000003';
const settings: RestSettings = {
  appUrl: ORIGIN,
  discordClientId: '1'.repeat(18),
  discordClientSecret: `cs-${randomBytes(8).toString('hex')}`,
  authSecret: randomBytes(32).toString('base64'),
  trustedProxies: [],
};
const ACCESS_TOKEN = `at-${randomBytes(8).toString('hex')}`;

const item = (id: string): ManageableGuild => ({ id, name: `server ${id}`, icon: null });

/** Stands in for the cookie login: `x-user` is the signed-in account, `x-token` the Discord token. */
const sessions = {
  principalOf: (request: PrincipalRequest) => {
    const user = request.headers['x-user'];
    return Promise.resolve(
      typeof user === 'string' ? { discordUserId: user, createdAt: new Date() } : null,
    );
  },
  requirePrincipal: async (request: PrincipalRequest) => {
    const principal = await sessions.principalOf(request);
    if (principal === null) {
      const { ApiError } = await import('../../common/errors/http-error.js');
      throw new ApiError(ErrorCode.AUTH_UNAUTHENTICATED);
    }
    request.principal = principal;
    return principal;
  },
  discordAccessToken: (headers: Record<string, unknown>) =>
    Promise.resolve(typeof headers['x-token'] === 'string' ? headers['x-token'] : null),
};

const discordUser = { profileOf: vi.fn<(id: string, token: string) => Promise<DiscordProfile>>() };
const oauth = { manageableGuilds: vi.fn<(token: string) => Promise<ManageableGuild[]>>() };

@Global()
@Module({
  providers: [
    {
      provide: Client,
      useValue: {
        guilds: {
          cache: new Map([
            [BOT_GUILD, {}],
            [BOT_GUILD_2, {}],
          ]),
        },
      },
    },
  ],
  exports: [Client],
})
class FakeDiscordModule {}

let app: NestFastifyApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [FakeDiscordModule, MeModule] })
    .overrideProvider(REST_SETTINGS)
    .useValue(settings)
    .overrideProvider(SessionService)
    .useValue(sessions)
    .overrideProvider(UserGuildsClient)
    .useValue(oauth)
    .overrideProvider(DiscordUserClient)
    .useValue(discordUser)
    .compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.register(cookie);
  await app.register(rateLimit, rateLimitOptions(sessions));
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  oauth.manageableGuilds.mockReset();
  discordUser.profileOf.mockReset();
});

const asUser = (id: string, extra: Record<string, string> = {}) => ({ 'x-user': id, ...extra });

describe('GET /api/me', () => {
  it('answers 401 without a login', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/me' });
    expect(response.statusCode).toBe(401);
    expect(response.json<{ code: string }>().code).toBe('AUTH_UNAUTHENTICATED');
  });

  const PROFILE: DiscordProfile = {
    username: 'sabi',
    globalName: 'Sabi Bot',
    avatarUrl: 'https://cdn.discordapp.com/embed/avatars/3.png',
  };
  const meRequest = (n: number, headers: Record<string, string> = {}) => ({
    method: 'GET' as const,
    url: '/api/me',
    headers: asUser(randomId(n), headers),
  });

  it('returns the account with the name and picture Discord shows for it', async () => {
    discordUser.profileOf.mockResolvedValue(PROFILE);
    const response = await app.inject(meRequest(1, { 'x-token': ACCESS_TOKEN }));
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ discordUserId: randomId(1), ...PROFILE });
    expect(discordUser.profileOf).toHaveBeenCalledWith(randomId(1), ACCESS_TOKEN);
  });

  it('keeps the globalName null for an account without a display name', async () => {
    discordUser.profileOf.mockResolvedValue({ ...PROFILE, globalName: null });
    const response = await app.inject(meRequest(2, { 'x-token': ACCESS_TOKEN }));
    expect(response.json<{ globalName: null }>().globalName).toBeNull();
  });

  it('answers 200 with nulls when the login holds no Discord token', async () => {
    const response = await app.inject(meRequest(3));
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      discordUserId: randomId(3),
      username: null,
      globalName: null,
      avatarUrl: null,
    });
    expect(discordUser.profileOf).not.toHaveBeenCalled();
  });

  it('answers 200 with nulls when Discord fails, and never logs the token', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    discordUser.profileOf.mockRejectedValue(new Error(`Bearer ${ACCESS_TOKEN} rejected`));
    const response = await app.inject(meRequest(4, { 'x-token': ACCESS_TOKEN }));
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      discordUserId: randomId(4),
      username: null,
      globalName: null,
      avatarUrl: null,
    });
    expect(warn).toHaveBeenCalledOnce();
    expect(JSON.stringify(warn.mock.calls)).not.toContain(ACCESS_TOKEN);
    warn.mockRestore();
  });
});

function randomId(n: number): string {
  return String(500_000_000_000_000_000n + BigInt(n));
}

describe('GET /api/guilds', () => {
  // The server list is remembered per person, so each test is a new person.
  let next = 1000;
  const picker = (token = ACCESS_TOKEN) => ({
    method: 'GET' as const,
    url: '/api/guilds',
    headers: asUser(randomId(next++), { 'x-token': token }),
  });

  it('lists the servers with the bot first and flags the ones it is not in', async () => {
    oauth.manageableGuilds.mockResolvedValue([
      item(NO_BOT_GUILD),
      item(BOT_GUILD),
      item(BOT_GUILD_2),
    ]);
    const response = await app.inject(picker());
    expect(response.statusCode).toBe(200);
    expect(z.array(GuildPickerItemSchema).parse(response.json())).toEqual([
      { ...item(BOT_GUILD), botPresent: true, invite: null },
      { ...item(BOT_GUILD_2), botPresent: true, invite: null },
      {
        ...item(NO_BOT_GUILD),
        botPresent: false,
        invite: { clientId: settings.discordClientId, permissions: BOT_INVITE_PERMISSIONS },
      },
    ]);
    expect(oauth.manageableGuilds).toHaveBeenCalledWith(ACCESS_TOKEN);
  });

  it('never lists a server the person may not manage, with or without the bot', async () => {
    // The OAuth client already dropped servers without Manage Server.
    oauth.manageableGuilds.mockResolvedValue([item(BOT_GUILD)]);
    const response = await app.inject(picker());
    expect(response.body).not.toContain(NO_BOT_GUILD);
    expect(response.body).not.toContain(BOT_GUILD_2);
  });

  it('invites with exactly the permissions discord.js names for the bot features', () => {
    const expected = Object.keys(BOT_INVITE_PERMISSION_BITS).reduce(
      (bits, name) => bits | PermissionFlagsBits[name as keyof typeof PermissionFlagsBits],
      0n,
    );
    expect(BOT_INVITE_PERMISSIONS).toBe(expected.toString());
  });

  it('answers 401 without a login and asks to sign in again when the login holds no Discord token', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/guilds' })).statusCode).toBe(401);
    const noToken = await app.inject({ method: 'GET', url: '/api/guilds', headers: asUser(USER) });
    expect(noToken.statusCode).toBe(403);
    expect(noToken.json<{ code: string }>().code).toBe('AUTH_REAUTH_REQUIRED');
  });

  it('asks to sign in again when Discord rejects the token', async () => {
    oauth.manageableGuilds.mockRejectedValue(new ServiceError(ErrorCode.AUTH_REAUTH_REQUIRED));
    const response = await app.inject(picker());
    expect(response.statusCode).toBe(403);
    expect(response.json<{ code: string }>().code).toBe('AUTH_REAUTH_REQUIRED');
  });

  it('answers 429 and 502, never 500, when Discord limits or fails', async () => {
    oauth.manageableGuilds.mockRejectedValueOnce(
      new RateLimitError({
        timeToReset: 1,
        limit: 1,
        method: 'GET',
        hash: 'h',
        url: '/x',
        route: '/x',
        majorParameter: 'm',
        global: false,
        retryAfter: 1,
        sublimitTimeout: 0,
        scope: 'user',
      }),
    );
    const limited = await app.inject(picker('t1'));
    expect(limited.statusCode).toBe(429);
    expect(limited.json<{ code: string }>().code).toBe('RATE_LIMITED');

    oauth.manageableGuilds.mockRejectedValueOnce(
      new DiscordAPIError({ message: 'down', code: 0 }, 0, 503, 'GET', '/x', {}),
    );
    const failed = await app.inject({
      method: 'GET',
      url: '/api/guilds',
      headers: asUser(randomId(7), { 'x-token': 't2' }),
    });
    expect(failed.statusCode).toBe(502);
    expect(failed.json<{ code: string }>().code).toBe('DISCORD_API_ERROR');
  });

  it('has its own small bucket per person', async () => {
    oauth.manageableGuilds.mockResolvedValue([]);
    const person = asUser(randomId(99), { 'x-token': 't3' });
    const call = () => app.inject({ method: 'GET', url: '/api/guilds', headers: person });
    for (let i = 0; i < GUILD_LIST_RATE_LIMIT.max; i++) expect((await call()).statusCode).toBe(200);
    expect((await call()).statusCode).toBe(429);
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: person });
    expect(me.statusCode).toBe(200);
  });
});

describe('meModules', () => {
  it('loads the caller routes when REST is on and the bot is logged in', () => {
    expect(meModules({ APP_URL: ORIGIN })).toEqual([MeModule]);
    expect(meModules({ APP_URL: ORIGIN, MIGRATION_PENDING: 'false' })).toEqual([MeModule]);
  });

  it('leaves them out while REST is off or a migration is pending', () => {
    expect(meModules({})).toEqual([]);
    expect(meModules({ APP_URL: ORIGIN, MIGRATION_PENDING: 'true' })).toEqual([]);
  });
});
