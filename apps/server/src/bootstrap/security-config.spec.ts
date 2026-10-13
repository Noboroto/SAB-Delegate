import helmet from '@fastify/helmet';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { FASTIFY_OPTIONS, HELMET_OPTIONS } from './security-config.js';

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

describe('FASTIFY_OPTIONS', () => {
  it('closes only idle keep-alive connections on shutdown', () => {
    expect(FASTIFY_OPTIONS.forceCloseConnections).toBe('idle');
  });

  it('does not trust forwarded headers', () => {
    expect(FASTIFY_OPTIONS.trustProxy).toBe(false);
  });
});
