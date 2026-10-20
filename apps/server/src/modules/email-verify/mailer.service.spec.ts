import { randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MailerService, scrubSmtpError } from './mailer.service.js';
import { SmtpTestLimiter } from './smtp-test-limiter.js';

const transport = { verify: vi.fn(), sendMail: vi.fn(), close: vi.fn() };
const createTransport = vi.fn(() => transport);
vi.mock('nodemailer', () => ({
  createTransport: (...args: unknown[]) => createTransport(...(args as [])),
}));
vi.mock('./smtp-host-guard.js', () => ({
  resolveSafeSmtpAddress: vi.fn((host: string) => Promise.resolve(host)),
}));

const pass = `pw-${randomBytes(9).toString('hex')}`;
const target = {
  host: 'smtp.example.test',
  port: 465,
  secure: true,
  auth: { user: 'mailer', pass },
  fromAddress: 'noreply@example.test',
  fromName: null,
};
const actor = { source: 'HTTP', userId: '300000000000000001' } as const;

function setup(resolved: typeof target | null = target) {
  const smtp = {
    resolve: vi.fn(() => Promise.resolve(resolved)),
    resolveSaved: vi.fn(() => Promise.resolve(resolved)),
    adminGuildId: '300000000000000001',
  };
  const audit = { record: vi.fn(() => Promise.resolve()) };
  return {
    smtp,
    audit,
    mailer: new MailerService(smtp as never, audit as never, new SmtpTestLimiter()),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  createTransport.mockReturnValue(transport);
  transport.verify.mockResolvedValue(true);
  transport.sendMail.mockResolvedValue({});
});

describe('MailerService.sendVerificationCode', () => {
  const mail = { to: 'a@example.test', code: '123456', guildName: 'S', locale: 'en' };

  it('fails closed when no account can be resolved', async () => {
    const { mailer } = setup(null);
    await expect(mailer.sendVerificationCode(mail)).rejects.toMatchObject({
      code: 'SMTP_NOT_CONFIGURED',
    });
    expect(createTransport).not.toHaveBeenCalled();
  });

  it('reuses one transporter for an unchanged account and sets the timeouts', async () => {
    const { mailer } = setup();
    await mailer.sendVerificationCode(mail);
    await mailer.sendVerificationCode(mail);
    expect(createTransport).toHaveBeenCalledTimes(1);
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 20_000,
      }),
    );
    expect(transport.sendMail).toHaveBeenCalledTimes(2);
  });

  it('builds a new transporter and closes the old one when the account changes', async () => {
    const { mailer, smtp } = setup();
    await mailer.sendVerificationCode(mail);
    smtp.resolve.mockResolvedValue({ ...target, auth: { user: 'mailer', pass: `${pass}x` } });
    await mailer.sendVerificationCode(mail);
    expect(createTransport).toHaveBeenCalledTimes(2);
    expect(transport.close).toHaveBeenCalledTimes(1);
  });

  it('turns a transport failure into EMAIL_SEND_FAILED without the server text', async () => {
    const { mailer } = setup();
    transport.sendMail.mockRejectedValue(
      Object.assign(new Error('550 a@example.test rejected'), { code: 'EENVELOPE' }),
    );
    await expect(mailer.sendVerificationCode(mail)).rejects.toMatchObject({
      code: 'EMAIL_SEND_FAILED',
      message: 'EMAIL_SEND_FAILED',
    });
  });
});

describe('MailerService.testStored', () => {
  it('tests the stored account, audits the attempt and returns the typed result', async () => {
    const { mailer, audit } = setup();
    expect(await mailer.testStored(actor)).toEqual({ ok: true });
    expect(transport.close).toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'email_verify.smtp_test', ok: true }),
    );
  });

  it('audits a failure with the credentials scrubbed from the text', async () => {
    const { mailer, audit } = setup();
    transport.verify.mockRejectedValue(
      Object.assign(
        new Error(`Invalid login ${pass} for mailer ${Buffer.from(pass).toString('base64')}`),
        {
          code: 'EAUTH',
        },
      ),
    );
    expect(await mailer.testStored(actor)).toEqual({ ok: false, reason: 'auth' });
    const entry = (
      audit.record.mock.calls as unknown as [{ error: string; ok: boolean }][]
    )[0]?.[0];
    expect(entry?.ok).toBe(false);
    expect(entry?.error).toContain('EAUTH');
    expect(entry?.error).not.toContain(pass);
    expect(entry?.error).not.toContain(Buffer.from(pass).toString('base64'));
    expect(entry?.error.length).toBeLessThanOrEqual(200);
  });

  it('refuses a sixth test in the window, and nothing is audited for the refused one', async () => {
    const { mailer, audit } = setup();
    for (let i = 0; i < 5; i += 1) await mailer.testStored(actor);
    await expect(mailer.testStored(actor)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(audit.record).toHaveBeenCalledTimes(5);
    await expect(mailer.testStored({ ...actor, userId: '300000000000000002' })).resolves.toEqual({
      ok: true,
    });
  });

  it('is SMTP_NOT_CONFIGURED when nothing is stored', async () => {
    const { mailer } = setup(null);
    await expect(mailer.testStored(actor)).rejects.toMatchObject({ code: 'SMTP_NOT_CONFIGURED' });
  });

  it('tests the saved account even while it is switched off', async () => {
    const { mailer, smtp } = setup(null);
    smtp.resolveSaved.mockResolvedValue(target);
    await expect(mailer.testStored(actor)).resolves.toEqual({ ok: true });
    expect(smtp.resolve).not.toHaveBeenCalled();
  });
});

describe('scrubSmtpError', () => {
  it('hides the user and password, in plain text and base64, and truncates', () => {
    const text = scrubSmtpError(new Error(`${'x'.repeat(300)} ${pass}`), {
      auth: { user: 'mailer', pass },
    });
    expect(text.length).toBe(200);
    const short = scrubSmtpError(new Error(`bad ${pass} for mailer`), {
      auth: { user: 'mailer', pass },
    });
    expect(short).toBe('unknown: bad *** for ***');
  });
});
