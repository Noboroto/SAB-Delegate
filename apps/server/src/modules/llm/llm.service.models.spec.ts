import { randomBytes } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { ErrorCode } from '@sab/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditService } from '../../common/audit/audit.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { ChatbotPauseService } from './chatbot-pause.service.js';
import { LlmService } from './llm.service.js';
import type * as SafeRequest from './safe-request.js';
import { SafePostError } from './safe-request.js';
import { encryptSecret } from './secret-box.js';

type StoredLlmKey = NonNullable<Awaited<ReturnType<Parameters<LlmService['listModels']>[1]>>>;

const request = vi.hoisted(() => vi.fn());
vi.mock('./safe-request.js', async (original) => ({
  ...(await original<typeof SafeRequest>()),
  safeRequest: request,
}));

const ADMIN = '713025650176294945';
const BASE = 'https://api.example.com/v1';
const OTHER_BASE = 'https://evil.example.net/v1';
/** Built at run time: a literal next to a key trips the secret scanners. */
const fresh = () => `fx-${randomBytes(12).toString('hex')}`;
const SECRET = randomBytes(24).toString('hex');

function build(options: { secret?: string | null; row?: StoredLlmKey | null } = {}) {
  const row = options.row ?? null;
  const prisma = { llmConfig: { findUnique: vi.fn(() => Promise.resolve(row)) } };
  const secret = options.secret === null ? undefined : (options.secret ?? SECRET);
  const service = new LlmService(
    prisma as unknown as PrismaService,
    { record: vi.fn() } as unknown as AuditService,
    { secret, adminGuildId: ADMIN },
    new ChatbotPauseService(),
  );
  return { service, prisma };
}

const listOf = (...ids: unknown[]) => ({
  status: 200,
  body: Buffer.from(JSON.stringify({ data: ids.map((id) => ({ id, object: 'model' })) })),
});
const raw = (status: number, text: string) => ({ status, body: Buffer.from(text) });
const none = () => Promise.resolve(null);

beforeEach(() => {
  request.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('LlmService.listModels: the call', () => {
  it('asks GET {baseUrl}/models with the given key, bounded in time and size', async () => {
    const key = fresh();
    request.mockResolvedValue(listOf('b-model'));
    const { service } = build();
    await expect(service.listModels({ baseUrl: `${BASE}/`, apiKey: key }, none)).resolves.toEqual({
      ok: true,
      models: ['b-model'],
    });
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        url: `${BASE}/models`,
        method: 'GET',
        headers: expect.objectContaining({ authorization: `Bearer ${key}` }) as unknown,
        timeoutMs: 15_000,
        maxBytes: 2 * 1024 * 1024,
      }),
    );
  });

  it('refuses a plain-http address and a key too short to be one', async () => {
    const { service } = build();
    await expect(
      service.listModels({ baseUrl: 'http://api.example.com/v1', apiKey: fresh() }, none),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
    await expect(
      service.listModels({ baseUrl: BASE, apiKey: 'short' }, none),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
    expect(request).not.toHaveBeenCalled();
  });
});

describe('LlmService.listModels: which key is used', () => {
  const stored = (key: string): StoredLlmKey => ({
    baseUrl: BASE,
    apiKeyEnc: encryptSecret(key, SECRET),
  });

  it('uses the stored key for the address it was saved for', async () => {
    const key = fresh();
    request.mockResolvedValue(listOf('m'));
    const { service } = build();
    await service.listModels({ baseUrl: BASE }, () => Promise.resolve(stored(key)));
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: `Bearer ${key}` }) as unknown,
      }),
    );
  });

  it('never sends the stored key to another host', async () => {
    const { service } = build();
    await expect(
      service.listModels({ baseUrl: OTHER_BASE }, () => Promise.resolve(stored(fresh()))),
    ).rejects.toMatchObject({ code: ErrorCode.LLM_KEY_REQUIRED });
    expect(request).not.toHaveBeenCalled();
  });

  it('asks for a key when nothing is stored, the key is gone, or it cannot be read', async () => {
    const { service } = build();
    const code = { code: ErrorCode.LLM_KEY_REQUIRED };
    await expect(service.listModels({ baseUrl: BASE }, none)).rejects.toMatchObject(code);
    await expect(
      service.listModels({ baseUrl: BASE }, () =>
        Promise.resolve({ baseUrl: BASE, apiKeyEnc: null }),
      ),
    ).rejects.toMatchObject(code);
    const sealedElsewhere = encryptSecret(fresh(), randomBytes(24).toString('hex'));
    await expect(
      service.listModels({ baseUrl: BASE }, () =>
        Promise.resolve({ baseUrl: BASE, apiKeyEnc: sealedElsewhere }),
      ),
    ).rejects.toMatchObject(code);
    expect(request).not.toHaveBeenCalled();
  });

  it('says the feature is unavailable when the server has no secret and no key was given', async () => {
    const { service } = build({ secret: null });
    await expect(service.listModels({ baseUrl: BASE }, none)).rejects.toMatchObject({
      code: ErrorCode.LLM_NOT_AVAILABLE,
    });
  });

  it('reads the shared stored key for the global list', async () => {
    const key = fresh();
    request.mockResolvedValue(listOf('m'));
    const { service, prisma } = build({ row: stored(key) });
    await service.listGlobalModels({ baseUrl: BASE });
    expect(prisma.llmConfig.findUnique).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: `Bearer ${key}` }) as unknown,
      }),
    );
    await expect(service.listGlobalModels({ baseUrl: OTHER_BASE })).rejects.toMatchObject({
      code: ErrorCode.LLM_KEY_REQUIRED,
    });
  });

  it('does not read the stored key when one is given', async () => {
    request.mockResolvedValue(listOf('m'));
    const { service, prisma } = build();
    await service.listGlobalModels({ baseUrl: BASE, apiKey: fresh() });
    expect(prisma.llmConfig.findUnique).not.toHaveBeenCalled();
  });
});

describe('LlmService.listModels: the answer', () => {
  const ask = (reply: { status: number; body: Buffer }) => {
    request.mockResolvedValue(reply);
    return build().service.listModels({ baseUrl: BASE, apiKey: fresh() }, none);
  };

  it('dedupes, sorts, trims and keeps only the ids', async () => {
    await expect(ask(listOf('zeta', 'alpha', ' alpha ', 'beta', 'zeta', ''))).resolves.toEqual({
      ok: true,
      models: ['alpha', 'beta', 'zeta'],
    });
  });

  it('drops an id longer than 200 characters and keeps one of exactly 200', async () => {
    const edge = 'a'.repeat(200);
    await expect(ask(listOf('b'.repeat(201), edge))).resolves.toEqual({
      ok: true,
      models: [edge],
    });
  });

  it('keeps at most 1000 ids', async () => {
    const ids = Array.from({ length: 1500 }, (_, i) => `m-${String(i).padStart(4, '0')}`);
    const result = await ask(listOf(...ids));
    expect(result.ok && result.models).toHaveLength(1000);
    expect(result.ok && result.models[0]).toBe('m-0000');
  });

  it('answers an empty list as a list', async () => {
    await expect(ask(listOf())).resolves.toEqual({ ok: true, models: [] });
  });

  it.each([
    [401, 'unauthorized'],
    [403, 'unauthorized'],
    [402, 'provider_quota'],
    [404, 'bad_response'],
    [405, 'bad_response'],
    [400, 'bad_response'],
    [429, 'unreachable'],
    [503, 'unreachable'],
  ] as const)('maps status %i to %s', async (status, reason) => {
    await expect(ask(raw(status, '{}'))).resolves.toEqual({ ok: false, reason });
  });

  it('reads an empty account in a 429 body as provider_quota but a rate limit as unreachable', async () => {
    await expect(ask(raw(429, '{"error":{"code":"insufficient_quota"}}'))).resolves.toEqual({
      ok: false,
      reason: 'provider_quota',
    });
    await expect(ask(raw(429, '{"error":"rate limit per minute"}'))).resolves.toEqual({
      ok: false,
      reason: 'unreachable',
    });
  });

  it.each([
    ['not json', '<html>nope</html>'],
    ['another shape', '{"models":["a"]}'],
    ['an id that is not a string', '{"data":[{"id":7}]}'],
    ['no body', ''],
  ])('maps %s to bad_response', async (_label, text) => {
    await expect(ask(raw(200, text))).resolves.toEqual({ ok: false, reason: 'bad_response' });
  });

  it('maps a failed or refused call to its reason, and any other fault to unreachable', async () => {
    const { service } = build();
    const input = { baseUrl: BASE, apiKey: fresh() };
    const cases: [unknown, string][] = [
      [new SafePostError('blocked'), 'blocked'],
      [new SafePostError('unreachable'), 'unreachable'],
      [new SafePostError('too_large'), 'bad_response'],
      [new Error('socket hang up'), 'unreachable'],
    ];
    for (const [error, reason] of cases) {
      request.mockRejectedValueOnce(error);
      await expect(service.listModels(input, none)).resolves.toEqual({ ok: false, reason });
    }
  });
});

describe('LlmService.listModels: secrets stay out', () => {
  it('neither logs nor returns the key or the provider text, on success or failure', async () => {
    const key = fresh();
    const providerText = `provider-says-${randomBytes(6).toString('hex')}`;
    const sinks = [
      vi.spyOn(Logger.prototype, 'log'),
      vi.spyOn(Logger.prototype, 'warn'),
      vi.spyOn(Logger.prototype, 'error'),
      vi.spyOn(console, 'log'),
      vi.spyOn(console, 'error'),
    ];
    const { service } = build();
    const results = [];
    request.mockResolvedValueOnce(raw(401, `{"error":"${providerText} ${key}"}`));
    results.push(await service.listModels({ baseUrl: BASE, apiKey: key }, none));
    request.mockResolvedValueOnce(raw(200, `{"data":"${providerText} ${key}"}`));
    results.push(await service.listModels({ baseUrl: BASE, apiKey: key }, none));
    request.mockRejectedValueOnce(new Error(`${providerText} ${key}`));
    results.push(await service.listModels({ baseUrl: BASE, apiKey: key }, none));

    const seen = JSON.stringify([results, ...sinks.map((sink) => sink.mock.calls)]);
    expect(seen).not.toContain(key);
    expect(seen).not.toContain(providerText);
    expect(results.map((result) => result.ok)).toEqual([false, false, false]);
  });
});
