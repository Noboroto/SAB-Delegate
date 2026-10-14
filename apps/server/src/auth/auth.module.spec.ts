import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import cookie from '@fastify/cookie';
import { Controller, Get, Logger, Post, UseGuards } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { RestSettings } from '../config/env.js';
import { mountAuth } from './auth.handler.js';
import { AuthModule, authModules, restEnabledFromEnv } from './auth.module.js';
import {
  ALLOWED_AUTH_PATHS,
  AUTH,
  AUTH_COOKIE_PREFIX,
  REST_SETTINGS,
  SESSION_TTL_SECONDS,
  createAuth,
  type Auth,
} from './better-auth.js';
import { Principal, type SessionPrincipal } from './principal.decorator.js';
import { FRESH_AUTH_WINDOW_MS, FreshAuthGuard, SessionGuard } from './session.guard.js';
import { SessionService } from './session.service.js';

// Every value is generated per run: nothing here may look like a real id or key.
const DISCORD_USER = '8'.repeat(17);
const ACCESS_TOKEN = `at-${randomBytes(12).toString('hex')}`;
const REFRESH_TOKEN = `rt-${randomBytes(12).toString('hex')}`;
const ORIGIN = 'https://bot.example.test';
const settings: RestSettings = {
  appUrl: ORIGIN,
  discordClientId: '1'.repeat(18),
  discordClientSecret: `cs-${randomBytes(12).toString('hex')}`,
  authSecret: randomBytes(32).toString('base64'),
  trustedProxies: [],
};

@Controller('api/probe')
class ProbeController {
  @Get('me')
  @UseGuards(SessionGuard)
  me(@Principal() principal: SessionPrincipal): { id: string } {
    return { id: principal.discordUserId };
  }

  @Post('write')
  @UseGuards(SessionGuard)
  write(): { ok: true } {
    return { ok: true };
  }

  @Post('sensitive')
  @UseGuards(FreshAuthGuard)
  sensitive(): { ok: true } {
    return { ok: true };
  }
}

type Calls = { guilds: Array<string | null>; urls: string[] };

/** Answers Discord's token, profile and guild endpoints; everything else is refused. */
function stubDiscord(): Calls {
  const calls: Calls = { guilds: [], urls: [] };
  const json = (body: unknown): Response =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  vi.stubGlobal('fetch', (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = decodeURIComponent(raw);
    calls.urls.push(url);
    if (url === 'https://discord.com/api/oauth2/token') {
      return Promise.resolve(
        json({
          access_token: ACCESS_TOKEN,
          token_type: 'Bearer',
          expires_in: 604_800,
          refresh_token: REFRESH_TOKEN,
          scope: 'identify guilds',
        }),
      );
    }
    if (url === 'https://discord.com/api/users/@me') {
      return Promise.resolve(
        json({
          id: DISCORD_USER,
          username: 'fixture',
          discriminator: '0',
          global_name: 'Fixture',
          avatar: 'fixtureavatar',
          verified: true,
          email: null,
        }),
      );
    }
    calls.guilds.push(new Headers(init?.headers).get('authorization'));
    return Promise.reject(new Error(`unexpected fetch ${url}`));
  });
  return calls;
}

class Jar {
  private readonly cookies = new Map<string, string>();

  absorb(setCookies: string[]): void {
    for (const raw of setCookies) {
      const pair = raw.split(';')[0] ?? '';
      const at = pair.indexOf('=');
      const name = pair.slice(0, at);
      const value = pair.slice(at + 1);
      if (/max-age=0/i.test(raw) || value === '') this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  header(): string {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  names(): string[] {
    return [...this.cookies.keys()];
  }

  bytes(): number {
    return Buffer.byteLength(this.header());
  }
}

function setCookiesOf(response: { headers: Record<string, unknown> }): string[] {
  const value = response.headers['set-cookie'];
  if (Array.isArray(value)) return value.map(String);
  return typeof value === 'string' ? [value] : [];
}

async function buildApp(
  module: TestingModule,
  options: { useCookies?: boolean } = {},
): Promise<NestFastifyApplication> {
  const app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  if (options.useCookies !== false) await app.register(cookie);
  mountAuth(app.getHttpAdapter().getInstance(), app.get<Auth>(AUTH));
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

async function login(app: NestFastifyApplication, jar: Jar): Promise<void> {
  const signIn = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-in/social',
    headers: { origin: ORIGIN, 'content-type': 'application/json' },
    payload: { provider: 'discord', callbackURL: '/servers' },
  });
  expect(signIn.statusCode).toBe(200);
  jar.absorb(setCookiesOf(signIn));
  const state = new URL(signIn.json<{ url: string }>().url).searchParams.get('state') ?? '';
  const callback = await app.inject({
    method: 'GET',
    url: `/api/auth/callback/discord?code=fixture&state=${encodeURIComponent(state)}`,
    headers: { cookie: jar.header() },
  });
  expect(callback.statusCode).toBe(302);
  expect(callback.headers.location).toBe('/servers');
  jar.absorb(setCookiesOf(callback));
}

const anyString = expect.any(String) as string;

let moduleRef: TestingModule;
let app: NestFastifyApplication;
let sessions: SessionService;
let discord: Calls;

beforeAll(async () => {
  discord = stubDiscord();
  moduleRef = await Test.createTestingModule({
    imports: [AuthModule],
    controllers: [ProbeController],
  })
    .overrideProvider(REST_SETTINGS)
    .useValue(settings)
    .compile();
  app = await buildApp(moduleRef);
  sessions = moduleRef.get(SessionService);
});

afterAll(async () => {
  await app.close();
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('AuthModule wiring', () => {
  it('is loaded exactly when APP_URL is set', () => {
    expect(restEnabledFromEnv({})).toBe(false);
    expect(restEnabledFromEnv({ APP_URL: '  ' })).toBe(false);
    expect(authModules({})).toEqual([]);
    expect(authModules({ APP_URL: ORIGIN })).toEqual([AuthModule]);
  });

  it('resolves the session service and both guards through the container', () => {
    expect(moduleRef.get(SessionService)).toBeInstanceOf(SessionService);
    expect(moduleRef.get(SessionGuard)).toBeInstanceOf(SessionGuard);
    expect(moduleRef.get(FreshAuthGuard)).toBeInstanceOf(FreshAuthGuard);
  });

  it('builds its settings from the environment when not overridden', async () => {
    const stubbed = {
      APP_ENV: 'production',
      DISCORD_TOKEN: `t-${randomBytes(6).toString('hex')}`,
      DISCORD_CLIENT_ID: settings.discordClientId,
      DISCORD_ALLOWED_APP_IDS: settings.discordClientId,
      ADMIN_GUILD_ID: '3'.repeat(18),
      POSTGRES_DB: 'sab',
      POSTGRES_USER: 'sab_app',
      POSTGRES_PASSWORD: `p-${randomBytes(6).toString('hex')}`,
      APP_URL: `${ORIGIN}/`,
      DISCORD_CLIENT_SECRET: settings.discordClientSecret,
      BETTER_AUTH_SECRET: settings.authSecret,
      TRUSTED_PROXY_IPS: '10.0.0.0/8',
    };
    for (const [name, value] of Object.entries(stubbed)) vi.stubEnv(name, value);
    vi.stubEnv('DISCORD_DEV_GUILD_ID', '');
    try {
      const built = await Test.createTestingModule({ imports: [AuthModule] }).compile();
      expect(built.get(REST_SETTINGS)).toMatchObject({
        appUrl: ORIGIN,
        trustedProxies: ['10.0.0.0/8'],
      });
      await built.close();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('Better Auth over HTTP', () => {
  it('exposes exactly the four routes the login needs', () => {
    expect([...ALLOWED_AUTH_PATHS].sort()).toEqual([
      '/callback/:id',
      '/get-session',
      '/sign-in/social',
      '/sign-out',
    ]);
  });

  const denied: Array<[string, string]> = [
    ['POST', '/api/auth/update-user'],
    ['POST', '/api/auth/sign-up/email'],
    ['POST', '/api/auth/sign-in/email'],
    ['POST', '/api/auth/delete-user'],
    ['POST', '/api/auth/change-email'],
    ['POST', '/api/auth/set-password'],
    ['POST', '/api/auth/get-access-token'],
    ['POST', '/api/auth/refresh-token'],
    ['GET', '/api/auth/account-info'],
    ['GET', '/api/auth/list-accounts'],
    ['POST', '/api/auth/link-social'],
    ['GET', '/api/auth/list-sessions'],
    ['POST', '/api/auth/revoke-session'],
    ['POST', '/api/auth/update-session'],
    ['GET', '/api/auth/ok'],
    ['GET', '/api/auth/error'],
    ['POST', '/api/auth/unlink-account'],
  ];

  it.each(denied)('answers %s %s with 404', async (method, url) => {
    const response = await app.inject({
      method: method as 'GET' | 'POST',
      url,
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      ...(method === 'POST' ? { payload: {} } : {}),
    });
    expect(response.statusCode).toBe(404);
  });

  it('refuses a client write of name, image or discordId through update-user', async () => {
    const jar = new Jar();
    await login(app, jar);
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/update-user',
      headers: { origin: ORIGIN, cookie: jar.header(), 'content-type': 'application/json' },
      payload: {
        name: 'x',
        image: 'https://tracker.example.test/p.png',
        discordId: '1'.repeat(18),
      },
    });
    expect(response.statusCode).toBe(404);
    expect((await sessions.getPrincipal({ cookie: jar.header() }))?.discordUserId).toBe(
      DISCORD_USER,
    );
  });

  it('asks Discord for the identity and server list only, and nothing else', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/social',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      payload: { provider: 'discord', callbackURL: '/servers' },
    });
    const url = new URL(response.json<{ url: string }>().url);
    expect(url.origin).toBe('https://discord.com');
    expect(url.searchParams.get('scope')).toBe('identify guilds');
    expect(url.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/api/auth/callback/discord`);
  });

  it('does not let the sign-in request choose the stored Discord id', async () => {
    const jar = new Jar();
    const signIn = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/social',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      payload: {
        provider: 'discord',
        callbackURL: '/servers',
        additionalData: { discordId: '2'.repeat(18) },
      },
    });
    jar.absorb(setCookiesOf(signIn));
    const state = new URL(signIn.json<{ url: string }>().url).searchParams.get('state') ?? '';
    const callback = await app.inject({
      method: 'GET',
      url: `/api/auth/callback/discord?code=fixture&state=${encodeURIComponent(state)}`,
      headers: { cookie: jar.header() },
    });
    jar.absorb(setCookiesOf(callback));
    expect((await sessions.getPrincipal({ cookie: jar.header() }))?.discordUserId).toBe(
      DISCORD_USER,
    );
  });

  it('stores no name, avatar or email, and the token is not in the session', async () => {
    const jar = new Jar();
    await login(app, jar);
    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/get-session',
      headers: { cookie: jar.header() },
    });
    const body = response.json<{
      user: Record<string, unknown>;
      session: Record<string, unknown>;
    }>();
    expect(body.user['discordId']).toBe(DISCORD_USER);
    expect(body.user['name']).toBe('');
    expect(body.user['image'] ?? null).toBeNull();
    expect(body.user['email']).toBe(`${DISCORD_USER}@discord.invalid`);
    expect(JSON.stringify(body)).not.toContain(ACCESS_TOKEN);
    const lifetime = new Date(body.session['expiresAt'] as string).getTime() - Date.now();
    expect(lifetime).toBeLessThanOrEqual(SESSION_TTL_SECONDS * 1000);
    expect(lifetime).toBeGreaterThan((SESSION_TTL_SECONDS - 60) * 1000);
  });

  it('sets HttpOnly, Secure, SameSite=Lax cookies that stay far below the header limit', async () => {
    const signIn = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/social',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      payload: { provider: 'discord', callbackURL: '/servers' },
    });
    const jar = new Jar();
    jar.absorb(setCookiesOf(signIn));
    const state = new URL(signIn.json<{ url: string }>().url).searchParams.get('state') ?? '';
    const callback = await app.inject({
      method: 'GET',
      url: `/api/auth/callback/discord?code=fixture&state=${encodeURIComponent(state)}`,
      headers: { cookie: jar.header() },
    });
    const cookies = setCookiesOf(callback);
    expect(cookies.length).toBeGreaterThan(0);
    for (const raw of cookies) {
      expect(raw).toMatch(/HttpOnly/i);
      expect(raw).toMatch(/Secure/i);
      expect(raw).toMatch(/SameSite=Lax/i);
    }
    jar.absorb(cookies);
    expect(jar.bytes()).toBeLessThan(3500);
  });

  it('refuses a foreign Origin on a cookie-authenticated sign-out', async () => {
    const jar = new Jar();
    await login(app, jar);
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-out',
      headers: {
        origin: 'https://evil.example.test',
        cookie: jar.header(),
        'content-type': 'application/json',
      },
      payload: {},
    });
    expect(response.statusCode).toBe(403);
  });

  it('refuses a callback URL outside the application', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/social',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      payload: { provider: 'discord', callbackURL: 'https://evil.example.test/x' },
    });
    expect(response.statusCode).toBe(403);
  });

  it('clears every login cookie on sign-out', async () => {
    const jar = new Jar();
    await login(app, jar);
    const names = jar.names();
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-out',
      headers: { origin: ORIGIN, cookie: jar.header(), 'content-type': 'application/json' },
      payload: {},
    });
    expect(response.statusCode).toBe(200);
    const cleared = setCookiesOf(response)
      .filter((raw) => /max-age=0/i.test(raw))
      .map((raw) => raw.split('=')[0]);
    for (const name of names.filter((n) => n.includes('session') || n.includes('account'))) {
      expect(cleared).toContain(name);
    }
  });
});

describe('SessionService', () => {
  it('returns the Discord id and login time for a valid cookie', async () => {
    const jar = new Jar();
    await login(app, jar);
    const principal = await sessions.getPrincipal({ cookie: jar.header() });
    expect(principal?.discordUserId).toBe(DISCORD_USER);
    expect(Math.abs((principal?.createdAt.getTime() ?? 0) - Date.now())).toBeLessThan(60_000);
  });

  it('returns null without a cookie and for a tampered one', async () => {
    expect(await sessions.getPrincipal({})).toBeNull();
    const jar = new Jar();
    await login(app, jar);
    const tampered = jar.header().replace(/(session_token=[^;]{10})/, '$1x');
    expect(await sessions.getPrincipal({ cookie: tampered })).toBeNull();
  });

  it('rejects a cookie issued under a different secret', async () => {
    const jar = new Jar();
    await login(app, jar);
    const other = new SessionService(
      createAuth({ ...settings, authSecret: randomBytes(32).toString('base64') }),
    );
    expect(await other.getPrincipal({ cookie: jar.header() })).toBeNull();
  });

  it('rejects a cookie once the session is older than eight hours', async () => {
    const jar = new Jar();
    await login(app, jar);
    const issued = Date.now();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(issued + (SESSION_TTL_SECONDS - 120) * 1000);
    expect(await sessions.getPrincipal({ cookie: jar.header() })).not.toBeNull();
    vi.setSystemTime(issued + (SESSION_TTL_SECONDS + 120) * 1000);
    expect(await sessions.getPrincipal({ cookie: jar.header() })).toBeNull();
  });

  it('reads the Discord access token from the account cookie, never from the session', async () => {
    const jar = new Jar();
    await login(app, jar);
    expect(await sessions.discordAccessToken({ cookie: jar.header() })).toBe(ACCESS_TOKEN);
    expect(await sessions.discordAccessToken({})).toBeNull();
    expect(discord.urls.every((url) => url.startsWith('https://discord.com/'))).toBe(true);
  });
});

describe('guards behind the login', () => {
  const jar = new Jar();
  beforeAll(async () => {
    await login(app, jar);
  });

  const body = (code: string): unknown => expect.objectContaining({ code, message: anyString });

  it('answers 401 AUTH_UNAUTHENTICATED without a cookie and exposes the principal with one', async () => {
    const anonymous = await app.inject({ method: 'GET', url: '/api/probe/me' });
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json()).toEqual(body('AUTH_UNAUTHENTICATED'));
    const signedIn = await app.inject({
      method: 'GET',
      url: '/api/probe/me',
      headers: { cookie: jar.header() },
    });
    expect(signedIn.json()).toEqual({ id: DISCORD_USER });
  });

  it('lets a write without any cookie through to the authentication guard (401, not 403)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/probe/write',
      headers: { origin: 'https://evil.example.test' },
    });
    expect(response.statusCode).toBe(401);
  });

  it.each([
    ['a foreign Origin', { origin: 'https://evil.example.test' }],
    ['no Origin', {}],
    ['the null Origin', { origin: 'null' }],
    ['a cross-site fetch', { origin: ORIGIN, 'sec-fetch-site': 'cross-site' }],
    ['a same-site sibling', { origin: ORIGIN, 'sec-fetch-site': 'same-site' }],
  ])('rejects a cookie write with %s', async (_label, headers) => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/probe/write',
      headers: { cookie: jar.header(), ...headers },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual(body('AUTH_ORIGIN_REJECTED'));
  });

  it('accepts a cookie write from the application origin', async () => {
    for (const extra of [{}, { 'sec-fetch-site': 'same-origin' }]) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/probe/write',
        headers: { cookie: jar.header(), origin: ORIGIN, ...extra },
      });
      expect(response.statusCode, JSON.stringify(extra)).toBe(201);
    }
  });

  it('does not apply the Origin check to reads', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/probe/me',
      headers: { cookie: jar.header(), origin: 'https://evil.example.test' },
    });
    expect(response.statusCode).toBe(200);
  });

  it('accepts a fresh login for a sensitive action and asks for a new one after five minutes', async () => {
    const fresh = await app.inject({
      method: 'POST',
      url: '/api/probe/sensitive',
      headers: { cookie: jar.header(), origin: ORIGIN },
    });
    expect(fresh.statusCode).toBe(201);

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + FRESH_AUTH_WINDOW_MS + 60_000);
    const stale = await app.inject({
      method: 'POST',
      url: '/api/probe/sensitive',
      headers: { cookie: jar.header(), origin: ORIGIN },
    });
    expect(stale.statusCode).toBe(403);
    expect(stale.json()).toEqual(body('AUTH_REAUTH_REQUIRED'));
  });

  it('fails closed, not open, when the cookie plugin is missing', async () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const bare = await Test.createTestingModule({
      imports: [AuthModule],
      controllers: [ProbeController],
    })
      .overrideProvider(REST_SETTINGS)
      .useValue(settings)
      .compile();
    const unplugged = await buildApp(bare, { useCookies: false });
    try {
      const response = await unplugged.inject({
        method: 'POST',
        url: '/api/probe/write',
        headers: { cookie: jar.header(), origin: 'https://evil.example.test' },
      });
      expect(response.statusCode).toBe(500);
    } finally {
      await unplugged.close();
    }
  });
});

describe('mountAuth', () => {
  it('answers a failure inside Better Auth with the INTERNAL body and no thrown text', async () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const leaked = `table_${randomBytes(6).toString('hex')}`;
    const fastify = Fastify();
    mountAuth(fastify, {
      handler: () => Promise.reject(new Error(`relation ${leaked} does not exist`)),
    } as unknown as Auth);
    try {
      const response = await fastify.inject({ method: 'GET', url: '/api/auth/get-session' });
      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({ code: 'INTERNAL', message: anyString });
      expect(response.body).not.toContain(leaked);
    } finally {
      await fastify.close();
    }
  });
});

describe('auth.api use', () => {
  it('stays inside SessionService, whose calls pass fixed arguments and never a request body', () => {
    const root = join(__dirname, '..');
    const offenders = readdirSync(root, { recursive: true, encoding: 'utf8' })
      .filter((file) => file.endsWith('.ts') && !/\.(spec|test)\.ts$/.test(file))
      .filter((file) => /\.api\.\w+\(/.test(readFileSync(join(root, file), 'utf8')))
      .map((file) => file.split('\\').join('/'));
    expect(offenders).toEqual(['auth/session.service.ts']);
  });

  it('uses one cookie prefix for the login cookies and for the Origin guard', async () => {
    const jar = new Jar();
    await login(app, jar);
    expect(
      jar
        .names()
        .every((name) => name.replace(/^__Secure-/, '').startsWith(`${AUTH_COOKIE_PREFIX}.`)),
    ).toBe(true);
  });
});
