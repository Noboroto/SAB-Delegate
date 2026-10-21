import { randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmailCryptoService } from './email-crypto.js';
import { SMTP_CACHE_TTL_MS, SmtpConfigService } from './smtp-config.service.js';

const ADMIN = '300000000000000001';
const secret = randomBytes(24).toString('hex');
const password = `pw-${randomBytes(9).toString('hex')}`;
const newPassword = `pw-${randomBytes(9).toString('hex')}`;

type Row = {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  passwordEnc: string;
  fromAddress: string;
  fromName: string | null;
  enabled: boolean;
};

const input = {
  host: 'smtp.example.test',
  port: 465,
  secure: true,
  username: 'mailer',
  fromAddress: 'noreply@example.test',
  fromName: null,
  enabled: true,
};

function setup(options: { secret?: string | null } = {}) {
  const secretValue = options.secret === null ? undefined : (options.secret ?? secret);
  const env = { secret: secretValue, adminGuildId: ADMIN };
  const crypto = new EmailCryptoService(env);
  let row: Row | null = null;
  const smtpConfig = {
    findFirst: vi.fn(() => Promise.resolve(row)),
    upsert: vi.fn((args: { create: Omit<Row, never> }) => {
      row = { ...args.create };
      return Promise.resolve(row);
    }),
  };
  const prisma = {
    smtpConfig,
    $transaction: (fn: (tx: unknown) => Promise<unknown>) => fn({ smtpConfig }),
  };
  const audit = { record: vi.fn(() => Promise.resolve()) };
  const service = new SmtpConfigService(prisma as never, audit as never, crypto, env);
  return {
    service,
    crypto,
    audit,
    smtpConfig,
    setRow: (value: Row | null) => {
      row = value;
    },
    getRow: () => row,
  };
}

const actor = { source: 'HTTP', userId: ADMIN } as const;

describe('SmtpConfigService.save', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  it('refuses the first save without a password', async () => {
    await expect(ctx.service.save(input, actor)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    expect(ctx.smtpConfig.upsert).not.toHaveBeenCalled();
  });

  it('keeps the stored password when none is given, and replaces it when one is', async () => {
    await ctx.service.save({ ...input, password }, actor);
    const first = ctx.getRow()?.passwordEnc;
    expect(ctx.crypto.decrypt(first ?? '')).toBe(password);

    await ctx.service.save({ ...input, fromName: 'Bot' }, actor);
    expect(ctx.getRow()?.passwordEnc).toBe(first);
    expect(ctx.getRow()?.fromName).toBe('Bot');

    await ctx.service.save({ ...input, password: newPassword }, actor);
    expect(ctx.crypto.decrypt(ctx.getRow()?.passwordEnc ?? '')).toBe(newPassword);
  });

  it('does not carry a stored password over to another host', async () => {
    await ctx.service.save({ ...input, password }, actor);
    await expect(
      ctx.service.save({ ...input, host: 'other.example.test' }, actor),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('is refused without LLM_KEY_SECRET', async () => {
    const bare = setup({ secret: null });
    await expect(bare.service.save({ ...input, password }, actor)).rejects.toMatchObject({
      code: 'EMAIL_VERIFY_UNAVAILABLE',
    });
  });

  it('puts neither the password nor its ciphertext in the audit row or the response', async () => {
    const view = await ctx.service.save({ ...input, password }, actor);
    const entries = ctx.audit.record.mock.calls as unknown as [Record<string, unknown>][];
    const [entry] = entries[0] ?? [];
    expect(entry).toMatchObject({
      action: 'email_verify.smtp_set',
      params: { host: input.host, port: 465, secure: true, passwordChanged: true },
    });
    const text = JSON.stringify([entry, view]);
    expect(text).not.toContain(password);
    expect(text).not.toContain(ctx.getRow()?.passwordEnc ?? 'x');
    expect(view.passwordSet).toBe(true);
    expect(view).not.toHaveProperty('password');
    expect(view).not.toHaveProperty('passwordEnc');
  });

  it('reports a password change only when one was given', async () => {
    await ctx.service.save({ ...input, password }, actor);
    await ctx.service.save(input, actor);
    const calls = ctx.audit.record.mock.calls as unknown as [
      { params: { passwordChanged: boolean } },
    ][];
    expect(calls.map(([entry]) => entry.params.passwordChanged)).toEqual([true, false]);
  });
});

describe('SmtpConfigService.view and resolve', () => {
  it('has passwordSet false and resolves to null when the password cannot be decrypted', async () => {
    const ctx = setup();
    const foreign = new EmailCryptoService({
      secret: randomBytes(24).toString('hex'),
      adminGuildId: ADMIN,
    });
    ctx.setRow({
      host: input.host,
      port: 465,
      secure: true,
      username: 'mailer',
      passwordEnc: foreign.encrypt(password),
      fromAddress: input.fromAddress,
      fromName: null,
      enabled: true,
    });
    expect((await ctx.service.view(ADMIN)).passwordSet).toBe(false);
    expect(await ctx.service.resolve()).toBeNull();
    expect(await ctx.service.ready()).toBe(false);
  });

  it('resolves the decrypted account when saved and on, and null when off or absent', async () => {
    const ctx = setup();
    expect(await ctx.service.resolve(0)).toBeNull();
    await ctx.service.save({ ...input, password }, actor);
    expect(await ctx.service.resolve(1)).toMatchObject({
      host: input.host,
      auth: { user: 'mailer', pass: password },
    });
    await ctx.service.save({ ...input, enabled: false }, actor);
    expect(await ctx.service.resolve(2)).toBeNull();
  });

  it('caches for a few seconds and forgets on save', async () => {
    const ctx = setup();
    await ctx.service.save({ ...input, password }, actor);
    await ctx.service.resolve(10);
    const reads = ctx.smtpConfig.findFirst.mock.calls.length;
    await ctx.service.resolve(10 + SMTP_CACHE_TTL_MS - 1);
    expect(ctx.smtpConfig.findFirst.mock.calls.length).toBe(reads);
    await ctx.service.resolve(10 + SMTP_CACHE_TTL_MS + 1);
    expect(ctx.smtpConfig.findFirst.mock.calls.length).toBe(reads + 1);
  });

  it('shows another server nothing but that it is not the admin server', async () => {
    const ctx = setup();
    await ctx.service.save({ ...input, password }, actor);
    const view = await ctx.service.view('300000000000000002');
    expect(view).toMatchObject({ adminServer: false, host: '', passwordSet: false });
  });
});
