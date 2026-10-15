import { ErrorCode } from '@sab/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditService } from '../../common/audit/audit.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { LlmService } from './llm.service.js';
import type * as SafePost from './safe-post.js';
import { SafePostError } from './safe-post.js';
import { decryptSecret, encryptSecret } from './secret-box.js';

const post = vi.hoisted(() => vi.fn());
vi.mock('./safe-post.js', async (original) => ({
  ...(await original<typeof SafePost>()),
  safePostJson: post,
}));

const SECRET = 's'.repeat(40);
const ADMIN = '713025650176294945';
const ACTOR = { source: 'HTTP', userId: '300000000000000001' } as const;
const BASE = 'https://api.example.com/v1';

type Row = {
  baseUrl: string;
  model: string;
  apiKeyEnc: string;
  keyLast4: string;
  enabled: boolean;
};

function build(options: { secret?: string | null; row?: Row | null } = {}) {
  let row: Row | null = options.row ?? null;
  const llmConfig = {
    findUnique: vi.fn(() => Promise.resolve(row === null ? null : { ...row })),
    upsert: vi.fn(({ create }: { create: Row }) => {
      row = { ...create };
      return Promise.resolve(row);
    }),
  };
  const prisma = {
    llmConfig,
    $transaction: vi.fn((run: (tx: unknown) => Promise<unknown>) => run({ llmConfig })),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const secret = options.secret === null ? undefined : (options.secret ?? SECRET);
  const service = new LlmService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    { secret, adminGuildId: ADMIN },
  );
  return { service, llmConfig, audit, stored: () => row };
}

const saved = (overrides: Partial<Row> = {}): Row => ({
  baseUrl: BASE,
  model: 'gpt-x',
  apiKeyEnc: encryptSecret('sk-live-9999', SECRET),
  keyLast4: '9999',
  enabled: true,
  ...overrides,
});

const answer = (content: string) => ({
  status: 200,
  body: { choices: [{ message: { content } }] },
});

beforeEach(() => {
  post.mockReset();
});

describe('LlmService.save', () => {
  it('refuses to save without LLM_KEY_SECRET', async () => {
    const { service } = build({ secret: null });
    await expect(
      service.save({ baseUrl: BASE, model: 'm', enabled: true, apiKey: 'sk-test-key-0001' }, ACTOR),
    ).rejects.toMatchObject({ code: ErrorCode.LLM_NOT_AVAILABLE });
  });

  it('stores the key encrypted, shows only its last four characters, and audits no key', async () => {
    const { service, stored, audit } = build();
    const settings = await service.save(
      { baseUrl: BASE, model: 'gpt-x', enabled: true, apiKey: 'sk-new-key-1234' },
      ACTOR,
    );
    expect(settings).toEqual({
      adminServer: true,
      available: true,
      enabled: true,
      baseUrl: BASE,
      model: 'gpt-x',
      keyLast4: '1234',
    });
    expect(stored()?.apiKeyEnc).not.toContain('sk-new-key-1234');
    expect(decryptSecret(stored()?.apiKeyEnc ?? '', SECRET)).toBe('sk-new-key-1234');
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain('sk-new-key');
  });

  it('keeps the stored key when none is sent and the address is the same', async () => {
    const { service, stored } = build({ row: saved() });
    await service.save({ baseUrl: BASE, model: 'other', enabled: false }, ACTOR);
    expect(decryptSecret(stored()?.apiKeyEnc ?? '', SECRET)).toBe('sk-live-9999');
    expect(stored()?.model).toBe('other');
  });

  it('requires a key on the first save and when the address changes', async () => {
    await expect(
      build().service.save({ baseUrl: BASE, model: 'm', enabled: true }, ACTOR),
    ).rejects.toMatchObject({ code: ErrorCode.LLM_KEY_REQUIRED });
    await expect(
      build({ row: saved() }).service.save(
        { baseUrl: 'https://evil.example/v1', model: 'm', enabled: true },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: ErrorCode.LLM_KEY_REQUIRED });
  });

  it('refuses a plain-http address', async () => {
    await expect(
      build().service.save(
        {
          baseUrl: 'http://api.example.com/v1',
          model: 'm',
          enabled: true,
          apiKey: 'sk-test-key-0001',
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
  });
});

describe('LlmService.settings', () => {
  it('shows another server nothing but that it is not the admin server', async () => {
    await expect(build({ row: saved() }).service.settings('300000000000000009')).resolves.toEqual({
      adminServer: false,
      available: false,
      enabled: false,
      baseUrl: null,
      model: null,
      keyLast4: null,
    });
  });
});

describe('LlmService.test', () => {
  it('sends the stored key only to the address it was saved for', async () => {
    const { service } = build({ row: saved() });
    post.mockResolvedValue(answer('OK'));
    await expect(service.test({ baseUrl: BASE, model: 'gpt-x', enabled: true })).resolves.toEqual({
      ok: true,
    });
    expect(post).toHaveBeenCalledWith(
      `${BASE}/chat/completions`,
      { authorization: 'Bearer sk-live-9999' },
      expect.objectContaining({ model: 'gpt-x' }),
      expect.any(Number),
    );
    await expect(
      service.test({ baseUrl: 'https://evil.example/v1', model: 'gpt-x', enabled: true }),
    ).rejects.toMatchObject({ code: ErrorCode.LLM_KEY_REQUIRED });
  });

  it('reports why a test failed without the provider text', async () => {
    const { service } = build();
    post.mockResolvedValueOnce({ status: 401, body: { error: 'secret detail' } });
    await expect(
      service.test({ baseUrl: BASE, model: 'm', enabled: true, apiKey: 'sk-test-key-0001' }),
    ).resolves.toEqual({ ok: false, reason: 'unauthorized' });
    post.mockRejectedValueOnce(new SafePostError('blocked'));
    await expect(
      service.test({ baseUrl: BASE, model: 'm', enabled: true, apiKey: 'sk-test-key-0001' }),
    ).resolves.toEqual({ ok: false, reason: 'blocked' });
    post.mockResolvedValueOnce({ status: 200, body: { nope: true } });
    await expect(
      service.test({ baseUrl: BASE, model: 'm', enabled: true, apiKey: 'sk-test-key-0001' }),
    ).resolves.toEqual({ ok: false, reason: 'bad_response' });
  });
});

describe('LlmService.explainVietnamese', () => {
  it('asks nothing when no LLM is set up, switched off, or the key cannot be read', async () => {
    for (const options of [
      { row: null },
      { row: saved({ enabled: false }) },
      { secret: null, row: saved() },
      { row: saved({ apiKeyEnc: encryptSecret('k', 'x'.repeat(40)) }) },
    ]) {
      await expect(build(options).service.explainVietnamese('hối tâm')).resolves.toBeUndefined();
    }
    expect(post).not.toHaveBeenCalled();
  });

  it('returns the meaning, trimmed and on one line', async () => {
    post.mockResolvedValue(answer('  Lòng hối hận,\n  ăn năn.  '));
    await expect(build({ row: saved() }).service.explainVietnamese('hối tâm')).resolves.toBe(
      'Lòng hối hận, ăn năn.',
    );
  });

  it('returns null when the model does not know the word', async () => {
    post.mockResolvedValue(answer('NONE'));
    await expect(build({ row: saved() }).service.explainVietnamese('xyz abc')).resolves.toBeNull();
  });

  it('returns undefined when the call fails, and pauses before asking again', async () => {
    const { service } = build({ row: saved() });
    post.mockRejectedValue(new SafePostError('unreachable'));
    await expect(service.explainVietnamese('hối tâm')).resolves.toBeUndefined();
    await expect(service.explainVietnamese('tinh nghĩa')).resolves.toBeUndefined();
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('keeps nothing for an empty, cut-off or linked answer', async () => {
    const { service } = build({ row: saved() });
    post.mockResolvedValueOnce(answer('   '));
    await expect(service.explainVietnamese('a b')).resolves.toBeUndefined();
    post.mockResolvedValueOnce({
      status: 200,
      body: { choices: [{ message: { content: 'Nửa câu' }, finish_reason: 'length' }] },
    });
    await expect(service.explainVietnamese('a b')).resolves.toBeUndefined();
    post.mockResolvedValueOnce(answer('Xem https://example.com'));
    await expect(service.explainVietnamese('a b')).resolves.toBeUndefined();
  });

  it('asks again with max_completion_tokens when the model refuses max_tokens', async () => {
    const { service } = build({ row: saved() });
    post.mockResolvedValueOnce({ status: 400, body: {} }).mockResolvedValueOnce(answer('Nghĩa.'));
    await expect(service.explainVietnamese('a b')).resolves.toBe('Nghĩa.');
    expect(post.mock.calls[1]?.[2]).toHaveProperty('max_completion_tokens');
    expect(post.mock.calls[1]?.[2]).not.toHaveProperty('temperature');
  });
});
