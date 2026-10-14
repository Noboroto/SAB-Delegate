import helmet from '@fastify/helmet';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { BIRTHDAY_CSV_MAX_BYTES } from '../modules/birthday/birthday.csv.js';
import { fastifyOptions, HELMET_OPTIONS, REST_BODY_LIMIT_BYTES } from './security-config.js';

async function responseHeaders(): Promise<Record<string, unknown>> {
  const app = Fastify();
  await app.register(helmet, HELMET_OPTIONS);
  app.get('/', () => ({ ok: true }));
  try {
    return (await app.inject({ method: 'GET', url: '/' })).headers;
  } finally {
    await app.close();
  }
}

describe('HELMET_OPTIONS', () => {
  it('sends exactly the closed policy, with none of helmet default allowances', async () => {
    const policy = String((await responseHeaders())['content-security-policy']);
    expect(policy.split(';').sort()).toEqual([
      "base-uri 'none'",
      "default-src 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
    ]);
  });

  it('does not allow any source for scripts, images, fonts or styles', async () => {
    const policy = String((await responseHeaders())['content-security-policy']);
    for (const directive of ['script-src', 'img-src', 'font-src', 'style-src', 'object-src']) {
      expect(policy).not.toContain(directive);
    }
    expect(policy).not.toContain("'self'");
  });
});

describe('fastifyOptions', () => {
  it('takes a JSON body that wraps a CSV at the import limit, and still refuses a huge one', async () => {
    const app = Fastify(fastifyOptions());
    app.post('/', (request) => ({ bytes: JSON.stringify(request.body).length }));
    try {
      // Every line break becomes two characters in the JSON text.
      const csv = 'a\n'.repeat(BIRTHDAY_CSV_MAX_BYTES / 2);
      const post = (payload: object) => app.inject({ method: 'POST', url: '/', payload });
      expect((await post({ csv })).statusCode).toBe(200);
      const huge = await post({ csv: 'x'.repeat(REST_BODY_LIMIT_BYTES) });
      expect(huge.statusCode).toBe(413);
    } finally {
      await app.close();
    }
  });

  it('closes only idle keep-alive connections on shutdown', () => {
    expect(fastifyOptions().forceCloseConnections).toBe('idle');
  });

  it('does not trust forwarded headers without a hop list', () => {
    expect(fastifyOptions().trustProxy).toBe(false);
    expect(fastifyOptions([]).trustProxy).toBe(false);
  });

  it('takes the client address from a trusted hop only', async () => {
    const app = Fastify(fastifyOptions(['10.0.0.0/8']));
    app.get('/', (request) => ({ ip: request.ip }));
    try {
      const forwarded = { 'x-forwarded-for': '203.0.113.7' };
      const viaProxy = await app.inject({
        method: 'GET',
        url: '/',
        remoteAddress: '10.1.2.3',
        headers: forwarded,
      });
      expect(viaProxy.json()).toEqual({ ip: '203.0.113.7' });
      const direct = await app.inject({
        method: 'GET',
        url: '/',
        remoteAddress: '198.51.100.9',
        headers: forwarded,
      });
      expect(direct.json()).toEqual({ ip: '198.51.100.9' });
    } finally {
      await app.close();
    }
  });
});
