import 'reflect-metadata';
import { Readable } from 'node:stream';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fastifyOptions } from '../bootstrap/security-config.js';
import { AllExceptionsFilter } from '../common/filters/all-exceptions.filter.js';
import { ApiKeyService } from '../modules/api-key/api-key.service.js';
import { McpController } from './mcp.controller.js';
import type { McpCaller } from './mcp-caller.js';
import {
  FixtureService,
  HARNESS_GUILD,
  HARNESS_KEY,
  HARNESS_USER,
  fixtureRows,
  makeFactory,
} from './mcp.test-harness.js';
import { MCP_BODY_LIMIT_BYTES, installMcpHooks } from './mcp-http-hooks.js';
import { MCP_FAILED_AUTH_LIMIT, MCP_KEY_LIMIT, McpRateLimiter } from './mcp-rate-limit.js';
import { McpServerFactory } from './mcp-server.factory.js';

const BEARER = `sab_${'A'.repeat(43)}`;
const REJECTED = `sab_${'B'.repeat(43)}`;
const principal = { discordUserId: HARNESS_USER, apiKeyId: HARNESS_KEY, mode: 'WRITE' as const };

const headers = (extra: Record<string, string> = {}): Record<string, string> => ({
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
  authorization: `Bearer ${BEARER}`,
  ...extra,
});
const toolsList = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} };

describe('McpController', () => {
  let app: NestFastifyApplication;
  let verify: ReturnType<typeof vi.fn>;
  let create: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    verify = vi.fn((bearer: string) => Promise.resolve(bearer === BEARER ? principal : null));
    const fixture = new FixtureService();
    const { factory } = makeFactory({ services: new Map([[FixtureService, fixture]]) });
    create = vi.fn((caller: McpCaller) => factory.create(caller, fixtureRows()));
    const moduleRef = await Test.createTestingModule({
      controllers: [McpController],
      providers: [
        { provide: ApiKeyService, useValue: { verify } },
        { provide: McpServerFactory, useValue: { create } },
        McpRateLimiter,
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
      ],
    }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(fastifyOptions(['127.0.0.1'])),
    );
    installMcpHooks(app.getHttpAdapter().getInstance());
    // `inject` hands the handler a fake socket without `destroySoon`, which the
    // MCP transport's node adapter calls from a timer when a response ends
    // before the request body was read; on a loaded machine that timer fires
    // during the run and surfaces as an uncaught error. Real sockets have it.
    app
      .getHttpAdapter()
      .getInstance()
      .addHook('onRequest', (request, _reply, done) => {
        const socket = request.raw.socket as { destroySoon?: () => void; destroy?: () => void };
        socket.destroySoon ??= () => socket.destroy?.();
        done();
      });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  afterEach(() => app.close());

  const post = (extra: Record<string, string> = {}, payload: unknown = toolsList, url = '/mcp') =>
    app.inject({ method: 'POST', url, headers: headers(extra), payload: payload as object });

  describe('authentication', () => {
    it('lists the tools for a valid key and builds the caller from the key, not from the request', async () => {
      const response = await post({ 'x-forwarded-for': '203.0.113.9' });
      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      const names = response
        .json<{ result: { tools: { name: string }[] } }>()
        .result.tools.map((tool) => tool.name);
      expect(names).toContain('fixture_remove');
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ ...principal, ip: '203.0.113.9' }),
      );
    });

    it('answers a missing, malformed, unknown or revoked key with the same 401 and a Bearer challenge', async () => {
      const bodies = new Set<string>();
      for (const authorization of [undefined, 'Basic abc', 'Bearer', `Bearer ${REJECTED}`]) {
        const response = await app.inject({
          method: 'POST',
          url: '/mcp',
          headers:
            authorization === undefined
              ? { ...headers(), authorization: '' }
              : headers({ authorization }),
          payload: toolsList,
        });
        expect(response.statusCode).toBe(401);
        expect(response.headers['www-authenticate']).toBe('Bearer');
        bodies.add(response.body);
      }
      expect(bodies.size).toBe(1);
      expect(create).not.toHaveBeenCalled();
    });

    it('does not take a cookie, or a key in the query string, as credentials', async () => {
      const cookie = await app.inject({
        method: 'POST',
        url: '/mcp',
        headers: { ...headers(), authorization: '', cookie: 'sab-auth.session_token=abc' },
        payload: toolsList,
      });
      expect(cookie.statusCode).toBe(401);
      const query = await app.inject({
        method: 'POST',
        url: `/mcp?key=${BEARER}`,
        headers: { ...headers(), authorization: '' },
        payload: toolsList,
      });
      expect(query.statusCode).toBe(401);
      expect(verify).not.toHaveBeenCalled();
    });
  });

  describe('browser origins', () => {
    it('refuses any request with an Origin header before authentication', async () => {
      const response = await post({ origin: 'https://evil.example' });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ code: 'AUTH_ORIGIN_REJECTED' });
      expect(verify).not.toHaveBeenCalled();
    });

    it.each(['/%6dcp', '/mcp?x=1', '/./mcp'])(
      'judges the resolved route, so %s is refused as well',
      async (url) => {
        const response = await post({ origin: 'null' }, toolsList, url);
        expect(response.statusCode).toBe(403);
        expect(verify).not.toHaveBeenCalled();
      },
    );

    it('refuses an Origin on GET and DELETE too', async () => {
      for (const method of ['GET', 'DELETE'] as const) {
        const response = await app.inject({
          method,
          url: '/mcp',
          headers: { origin: 'https://evil.example' },
        });
        expect(response.statusCode).toBe(403);
      }
    });
  });

  describe('methods and size', () => {
    it('answers GET and DELETE with 405 and Allow: POST', async () => {
      for (const method of ['GET', 'DELETE'] as const) {
        const response = await app.inject({
          method,
          url: '/mcp',
          headers: { authorization: `Bearer ${BEARER}` },
        });
        expect(response.statusCode).toBe(405);
        expect(response.headers['allow']).toBe('POST');
      }
    });

    it('refuses a body above 1 MiB, declared or streamed without a length', async () => {
      const big = JSON.stringify({
        ...toolsList,
        params: { pad: 'x'.repeat(MCP_BODY_LIMIT_BYTES) },
      });
      expect((await post({}, big as unknown as object)).statusCode).toBe(413);

      const chunks = Array.from({ length: 5 }, () => Buffer.alloc(MCP_BODY_LIMIT_BYTES / 4, 120));
      const streamed = await app.inject({
        method: 'POST',
        url: '/mcp',
        headers: headers(),
        payload: Readable.from(chunks),
      });
      expect(streamed.statusCode).toBe(413);
      expect(create).not.toHaveBeenCalled();
    });
  });

  describe('after the reply is hijacked', () => {
    it('ends a failure with a JSON-RPC internal error instead of hanging', async () => {
      create.mockImplementationOnce(() => ({
        connect: () => Promise.reject(new Error('relation "ApiKey" does not exist')),
        close: () => Promise.resolve(),
      }));
      const response = await post();
      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32603, message: 'Internal server error' },
      });
      expect(response.body).not.toContain('relation');
    });
  });

  describe('rate limits', () => {
    it('refuses the request after the per-key ceiling, on the hijacked path as well', async () => {
      let status = 200;
      for (let n = 0; n < MCP_KEY_LIMIT.max; n += 1) {
        status = (await post()).statusCode;
        expect(status).toBe(200);
      }
      const over = await post();
      expect(over.statusCode).toBe(429);
      expect(over.headers['retry-after']).toBe('60');
      expect(create).toHaveBeenCalledTimes(MCP_KEY_LIMIT.max);
    });

    it('stops verifying an address after too many failed attempts', async () => {
      for (let n = 0; n < MCP_FAILED_AUTH_LIMIT.max; n += 1) {
        expect((await post({ authorization: `Bearer ${REJECTED}${n}` })).statusCode).toBe(401);
      }
      const blocked = await post({ authorization: `Bearer ${REJECTED}` });
      expect(blocked.statusCode).toBe(429);
      expect(verify).toHaveBeenCalledTimes(MCP_FAILED_AUTH_LIMIT.max);
      // Even a correct key from that address waits out the window.
      expect((await post()).statusCode).toBe(429);
    });
  });

  it('runs a tool end to end through the HTTP transport', async () => {
    const response = await post(
      {},
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'fixture_list', arguments: { guildId: HARNESS_GUILD } },
      },
    );
    expect(response.statusCode).toBe(200);
    const { result } = response.json<{
      result: { isError?: boolean; content: { text: string }[] };
    }>();
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain('bot.example.test [production]');
  });
});
