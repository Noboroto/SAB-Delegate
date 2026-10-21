import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { SESSION_EXPIRES_SECONDS } from '@sab/shared';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { requireDatabaseUrl } from '../../../../vitest-test-database.mjs';
import type { RestSettings } from '../config/env.js';
import type { PgBossService } from '../jobs/pg-boss.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.js';
import { mountAuth } from './auth.handler.js';
import { AuthSessionCleanupCron } from './auth-session-cleanup.cron.js';
import { createAuth } from './better-auth.js';
import { SessionService } from './session.service.js';

const DISCORD_USER = '7'.repeat(18);
const ACCESS_TOKEN = `at-${randomBytes(12).toString('hex')}`;
const REFRESH_TOKEN = `rt-${randomBytes(12).toString('hex')}`;
const ORIGIN = 'https://bot.example.test';
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const settings: RestSettings = {
  appUrl: ORIGIN,
  discordClientId: '1'.repeat(18),
  discordClientSecret: `cs-${randomBytes(12).toString('hex')}`,
  authSecret: randomBytes(32).toString('base64'),
  trustedProxies: [],
};

function stubDiscord(): void {
  const json = (body: unknown): Response =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  vi.stubGlobal('fetch', (input: string | URL | Request): Promise<Response> => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = decodeURIComponent(raw);
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
          avatar: null,
          verified: true,
          email: null,
        }),
      );
    }
    return Promise.reject(new Error(`unexpected fetch ${url}`));
  });
}

function cookiesOf(response: { headers: Record<string, unknown> }): string {
  const raw = response.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw.map(String) : typeof raw === 'string' ? [raw] : [];
  return list.map((entry) => entry.split(';')[0]).join('; ');
}

describe('login sessions against Postgres', () => {
  let database: TestDatabase;
  let prisma: PrismaService;
  let fastify: FastifyInstance;
  let sessions: SessionService;

  beforeAll(async () => {
    stubDiscord();
    database = await createTestDatabase(requireDatabaseUrl());
    prisma = database.prisma as unknown as PrismaService;
    const auth = createAuth(settings, prismaAdapter(prisma, { provider: 'postgresql' }));
    sessions = new SessionService(auth);
    fastify = Fastify();
    mountAuth(fastify, auth);
    await fastify.ready();
  });

  afterAll(async () => {
    await fastify.close();
    vi.unstubAllGlobals();
    await database.dispose();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function login(): Promise<string> {
    const signIn = await fastify.inject({
      method: 'POST',
      url: '/api/auth/sign-in/social',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      payload: { provider: 'discord', callbackURL: '/servers' },
    });
    expect(signIn.statusCode).toBe(200);
    const state = new URL(signIn.json<{ url: string }>().url).searchParams.get('state') ?? '';
    const callback = await fastify.inject({
      method: 'GET',
      url: `/api/auth/callback/discord?code=fixture&state=${encodeURIComponent(state)}`,
      headers: { cookie: cookiesOf(signIn) },
    });
    expect(callback.statusCode).toBe(302);
    return `${cookiesOf(signIn)}; ${cookiesOf(callback)}`;
  }

  it('lets the database generate every id and keeps the Discord tokens encrypted', async () => {
    const cookie = await login();
    const user = await prisma.user.findUniqueOrThrow({ where: { discordId: DISCORD_USER } });
    expect(user.id).toMatch(UUID_V7);
    expect(user.name).toBe('');
    const [session, account] = await Promise.all([
      prisma.session.findFirstOrThrow({ where: { userId: user.id } }),
      prisma.account.findFirstOrThrow({ where: { userId: user.id } }),
    ]);
    expect(session.id).toMatch(UUID_V7);
    expect(account.id).toMatch(UUID_V7);
    expect(account).toMatchObject({ providerId: 'discord', accountId: DISCORD_USER });
    expect(account.accessToken).not.toBe(ACCESS_TOKEN);
    expect(account.accessToken).not.toBeNull();
    expect(account.refreshToken).not.toBe(REFRESH_TOKEN);
    expect((await sessions.getPrincipal({ cookie }))?.discordUserId).toBe(DISCORD_USER);
    expect(await sessions.discordAccessToken({ cookie })).toBe(ACCESS_TOKEN);
  });

  it('signs the same Discord account in again as the same user', async () => {
    await login();
    await login();
    expect(await prisma.user.count({ where: { discordId: DISCORD_USER } })).toBe(1);
    expect(await prisma.account.count({ where: { accountId: DISCORD_USER } })).toBe(1);
  });

  it('slides the stored expiry forward once a day has passed', async () => {
    const cookie = await login();
    const user = await prisma.user.findUniqueOrThrow({ where: { discordId: DISCORD_USER } });
    const before = await prisma.session.findFirstOrThrow({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 2 * 24 * 60 * 60 * 1000);
    expect(await sessions.getPrincipal({ cookie })).not.toBeNull();
    const after = await prisma.session.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.expiresAt.getTime() - before.expiresAt.getTime()).toBeGreaterThan(24 * 3600_000);
  });

  it('rejects the cookie of a deleted session once the cache window has passed', async () => {
    const cookie = await login();
    const user = await prisma.user.findUniqueOrThrow({ where: { discordId: DISCORD_USER } });
    await prisma.session.deleteMany({ where: { userId: user.id } });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 2 * 60_000);
    expect(await sessions.getPrincipal({ cookie })).toBeNull();
  });

  it('refuses a user whose Discord id is not a snowflake', async () => {
    await expect(
      prisma.user.create({
        data: { name: '', email: 'x@discord.invalid', discordId: 'not-a-snowflake' },
      }),
    ).rejects.toThrow();
  });

  it('refuses a second account for the same Discord identity and cascades with the user', async () => {
    const user = await prisma.user.create({
      data: { name: '', email: 'dup@discord.invalid', discordId: '6'.repeat(18) },
    });
    const data = { providerId: 'discord', accountId: '6'.repeat(18), userId: user.id };
    await prisma.account.create({ data });
    await expect(prisma.account.create({ data })).rejects.toThrow();
    await prisma.session.create({
      data: { token: randomBytes(8).toString('hex'), userId: user.id, expiresAt: new Date() },
    });
    await prisma.user.delete({ where: { id: user.id } });
    expect(await prisma.account.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
  });

  it('deletes only the expired sessions in the daily cleanup', async () => {
    const user = await prisma.user.create({
      data: { name: '', email: 'sweep@discord.invalid', discordId: '5'.repeat(18) },
    });
    const now = new Date();
    const make = (offsetMs: number) =>
      prisma.session.create({
        data: {
          token: randomBytes(8).toString('hex'),
          userId: user.id,
          expiresAt: new Date(now.getTime() + offsetMs),
        },
      });
    const expired = await make(-1000);
    const live = await make(SESSION_EXPIRES_SECONDS * 1000);
    const cron = new AuthSessionCleanupCron({} as PgBossService, {} as never, prisma);
    const staleVerification = await prisma.verification.create({
      data: { identifier: 'x', value: 'y', expiresAt: new Date(now.getTime() - 1000) },
    });
    const liveVerification = await prisma.verification.create({
      data: { identifier: 'x', value: 'y', expiresAt: new Date(now.getTime() + 60_000) },
    });
    const removed = await cron.purgeExpired(now);
    expect(removed.sessions).toBeGreaterThanOrEqual(1);
    expect(removed.verifications).toBeGreaterThanOrEqual(1);
    expect(
      await prisma.verification.findUnique({ where: { id: staleVerification.id } }),
    ).toBeNull();
    expect(
      await prisma.verification.findUnique({ where: { id: liveVerification.id } }),
    ).not.toBeNull();
    expect(await prisma.session.findUnique({ where: { id: expired.id } })).toBeNull();
    expect(await prisma.session.findUnique({ where: { id: live.id } })).not.toBeNull();
  });
});
