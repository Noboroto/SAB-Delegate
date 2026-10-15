import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { fastifyOptions } from '../../bootstrap/security-config.js';
import {
  GUILD_LIST_RATE_LIMIT,
  READ_RATE_LIMIT_MAX,
  WRITE_RATE_LIMIT_MAX,
  createRefusalLogThrottle,
  rateLimitKey,
  rateLimitOptions,
  type RateLimitedEvent,
} from './rate-limit.util.js';

const ALICE = '200000000000000001';
const BOB = '200000000000000002';

/** Stands in for the session service: the "cookie" is the x-user header, `forged` verifies as nobody. */
const sessions = {
  principalOf: (request: FastifyRequest) => {
    const user = request.headers['x-user'];
    return Promise.resolve(
      typeof user === 'string' && /^\d+$/.test(user)
        ? { discordUserId: user, createdAt: new Date() }
        : null,
    );
  },
};

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function build(
  options: {
    max?: number;
    trustedProxies?: string[];
    onLimited?: (event: RateLimitedEvent) => void;
  } = {},
): Promise<FastifyInstance> {
  app = Fastify(fastifyOptions(options.trustedProxies));
  await app.register(rateLimit, {
    ...rateLimitOptions(sessions, options.onLimited),
    ...(options.max ? { max: options.max } : {}),
  });
  app.get('/api/things', () => ({ ok: true }));
  app.post('/api/things', () => ({ ok: true }));
  app.get('/api/guilds', { config: { rateLimit: GUILD_LIST_RATE_LIMIT } }, () => ({ ok: true }));
  app.get('/api/auth/*', () => ({ ok: true }));
  app.get('/health', () => ({ ok: true }));
  return app;
}

async function status(
  instance: FastifyInstance,
  url: string,
  headers: Record<string, string> = {},
  remoteAddress = '198.51.100.1',
): Promise<number> {
  return (await instance.inject({ method: 'GET', url, headers, remoteAddress })).statusCode;
}

describe('rate limiting', () => {
  it('counts a signed-in person by account, whatever address they use', async () => {
    const instance = await build({ max: 2 });
    expect(await status(instance, '/api/things', { 'x-user': ALICE }, '198.51.100.1')).toBe(200);
    expect(await status(instance, '/api/things', { 'x-user': ALICE }, '198.51.100.2')).toBe(200);
    expect(await status(instance, '/api/things', { 'x-user': ALICE }, '198.51.100.3')).toBe(429);
    expect(await status(instance, '/api/things', { 'x-user': BOB }, '198.51.100.1')).toBe(200);
  });

  it('counts anonymous requests by address, and a forged cookie does not mint a new bucket', async () => {
    const instance = await build({ max: 2 });
    expect(await status(instance, '/api/things')).toBe(200);
    expect(await status(instance, '/api/things', { 'x-user': 'forged' })).toBe(200);
    expect(await status(instance, '/api/things', { 'x-user': 'forged-again' })).toBe(429);
    expect(await status(instance, '/api/things', {}, '198.51.100.9')).toBe(200);
  });

  it('answers the limit with the RATE_LIMITED body and a retry hint', async () => {
    const instance = await build({ max: 1 });
    await status(instance, '/api/things');
    const response = await instance.inject({
      method: 'GET',
      url: '/api/things',
      remoteAddress: '198.51.100.1',
    });
    expect(response.statusCode).toBe(429);
    expect(response.json<{ code: string }>().code).toBe('RATE_LIMITED');
    expect(response.headers['retry-after']).toBeDefined();
  });

  it('takes the client address from a trusted proxy hop and ignores the header from anyone else', async () => {
    const instance = await build({ max: 1, trustedProxies: ['10.0.0.0/8'] });
    const forwarded = (ip: string) => ({ 'x-forwarded-for': ip });
    expect(await status(instance, '/api/things', forwarded('203.0.113.1'), '10.1.1.1')).toBe(200);
    expect(await status(instance, '/api/things', forwarded('203.0.113.2'), '10.1.1.1')).toBe(200);
    expect(await status(instance, '/api/things', forwarded('203.0.113.1'), '10.1.1.1')).toBe(429);
    // A direct client cannot pick its bucket by sending the header.
    expect(await status(instance, '/api/things', forwarded('203.0.113.50'), '192.0.2.7')).toBe(200);
    expect(await status(instance, '/api/things', forwarded('203.0.113.51'), '192.0.2.7')).toBe(429);
  });

  it('gives the server picker its own small bucket per person', async () => {
    const instance = await build();
    const person = { 'x-user': ALICE };
    for (let i = 0; i < GUILD_LIST_RATE_LIMIT.max; i++) {
      expect(await status(instance, '/api/guilds', person)).toBe(200);
    }
    expect(await status(instance, '/api/guilds', person)).toBe(429);
    expect(await status(instance, '/api/things', person)).toBe(200);
    expect(await status(instance, '/api/guilds', { 'x-user': BOB })).toBe(200);
  });

  it('lets one dashboard view fan out into dozens of reads without a refusal', async () => {
    const instance = await build();
    const person = { 'x-user': ALICE };
    for (let i = 0; i < 40; i++) expect(await status(instance, '/api/guilds', person)).toBe(200);
  });

  it('gives reads a larger budget than writes', async () => {
    expect(READ_RATE_LIMIT_MAX).toBeGreaterThan(WRITE_RATE_LIMIT_MAX);
    const instance = await build();
    const person = { 'x-user': ALICE };
    const post = async () =>
      (await instance.inject({ method: 'POST', url: '/api/things', headers: person })).statusCode;
    for (let i = 0; i < WRITE_RATE_LIMIT_MAX; i++) expect(await post()).toBe(200);
    expect(await post()).toBe(429);
    // Reads of the same person are still served.
    expect(await status(instance, '/api/things', person)).toBe(200);
  });

  it('reports a refused request with the account, the route pattern and no query string', async () => {
    const events: RateLimitedEvent[] = [];
    const instance = await build({ max: 1, onLimited: (event) => events.push(event) });
    const person = { 'x-user': ALICE };
    await status(instance, '/api/things?code=secret-value', person);
    expect(await status(instance, '/api/things?code=secret-value', person)).toBe(429);
    expect(events).toEqual([{ method: 'GET', route: '/api/things', key: `user:${ALICE}` }]);
    expect(JSON.stringify(events)).not.toContain('secret-value');
  });

  it('logs only the first refusal of a key per window', async () => {
    const events: RateLimitedEvent[] = [];
    const instance = await build({ max: 1, onLimited: (event) => events.push(event) });
    const person = { 'x-user': ALICE };
    await status(instance, '/api/things', person);
    for (let i = 0; i < 5; i++) expect(await status(instance, '/api/things', person)).toBe(429);
    expect(events).toHaveLength(1);
    await status(instance, '/api/things', { 'x-user': BOB });
    expect(await status(instance, '/api/things', { 'x-user': BOB })).toBe(429);
    expect(events).toHaveLength(2);
  });

  it('keeps the write budget on sign-in routes even for GET', async () => {
    const instance = await build();
    const person = { 'x-user': ALICE };
    for (let i = 0; i < WRITE_RATE_LIMIT_MAX; i++) {
      expect(await status(instance, '/api/auth/callback/discord?code=x', person)).toBe(200);
    }
    expect(await status(instance, '/api/auth/callback/discord?code=x', person)).toBe(429);
  });

  it('never throttles the health probes', async () => {
    const instance = await build({ max: 1 });
    for (let i = 0; i < 5; i++) expect(await status(instance, '/health')).toBe(200);
  });
});

describe('createRefusalLogThrottle', () => {
  it('lets a key through again once its window has passed', () => {
    let clock = 0;
    const allow = createRefusalLogThrottle(() => clock, 1000, 10);
    expect(allow('a')).toBe(true);
    expect(allow('a')).toBe(false);
    clock = 999;
    expect(allow('a')).toBe(false);
    clock = 1000;
    expect(allow('a')).toBe(true);
  });

  it('stays bounded by dropping the oldest key when full', () => {
    let clock = 0;
    const allow = createRefusalLogThrottle(() => clock, 1000, 2);
    expect(allow('a')).toBe(true);
    clock = 1;
    expect(allow('b')).toBe(true);
    clock = 2;
    expect(allow('c')).toBe(true);
    // "a" was evicted to make room, so it is logged again; "c" is still remembered.
    expect(allow('a')).toBe(true);
    expect(allow('c')).toBe(false);
  });
});

describe('rateLimitKey', () => {
  it('keys by account when there is one and by normalised address otherwise', async () => {
    const key = rateLimitKey(sessions);
    const request = (headers: Record<string, string>, ip: string) =>
      ({ headers, ip }) as unknown as FastifyRequest;
    expect(await key(request({ 'x-user': ALICE }, '198.51.100.1'))).toBe(`user:${ALICE}`);
    expect(await key(request({}, '198.51.100.1'))).toBe('ip:198.51.100.1');
    // One /64 is one household: its addresses share a bucket.
    expect(await key(request({}, '2001:db8::1'))).toBe(await key(request({}, '2001:db8::2')));
  });
});
