import { createHash } from 'node:crypto';
import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { AUDIT_ACTIONS, ErrorCode, type ActorContext, type SmtpTestResult } from '@sab/shared';
import { createTransport } from 'nodemailer';
import { AuditService } from '../../common/audit/audit.service.js';
import { ServiceError } from '../../common/errors/service-error.js';
import { buildCodeMail, buildTestMail } from './mail-template.js';
import { SmtpConfigService } from './smtp-config.service.js';
import { SmtpTestLimiter } from './smtp-test-limiter.js';

type Transporter = ReturnType<typeof createTransport>;
type BuiltMail = ReturnType<typeof buildCodeMail>;
type SmtpTarget = NonNullable<Awaited<ReturnType<SmtpConfigService['resolve']>>>;

const CONNECTION_TIMEOUT_MS = 10_000;
const GREETING_TIMEOUT_MS = 10_000;
const SOCKET_TIMEOUT_MS = 20_000;
const DNS_TIMEOUT_MS = 15_000;
const ERROR_MAX = 200;

/** What of a failed send is safe to log: codes only, since the text can quote the address. */
function failureLabel(error: unknown): string {
  if (typeof error !== 'object' || error === null) return 'unknown';
  const { code, responseCode } = error as { code?: unknown; responseCode?: unknown };
  return [typeof code === 'string' ? code : 'unknown', responseCode].filter(Boolean).join(' ');
}

function testFailureReason(error: unknown): Exclude<SmtpTestResult['reason'], undefined> {
  const { code, responseCode } = (typeof error === 'object' && error !== null ? error : {}) as {
    code?: unknown;
    responseCode?: unknown;
  };
  // A name that does not resolve is told apart from a server that does not answer.
  if (code === 'EDNS' || code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'unresolved';
  if (code === 'EAUTH') return 'auth';
  if (code === 'EENVELOPE' || (typeof responseCode === 'number' && responseCode >= 500)) {
    return 'rejected';
  }
  return 'unreachable';
}

/**
 * The server's own error text with the account's user name and password
 * blanked out (and the same in base64, how a login travels), cut to what an
 * audit row keeps. Only used for the audit row of a connection test.
 */
export function scrubSmtpError(error: unknown, target: Pick<SmtpTarget, 'auth'> | null): string {
  let text = error instanceof Error ? `${failureLabel(error)}: ${error.message}` : 'unknown error';
  if (target !== null) {
    for (const secret of [target.auth.user, target.auth.pass]) {
      if (secret === '') continue;
      for (const form of [secret, Buffer.from(secret).toString('base64')]) {
        text = text.split(form).join('***');
      }
    }
  }
  return text.replace(/\s+/g, ' ').slice(0, ERROR_MAX);
}

/**
 * Sends the mails of email verification through the saved SMTP account. One
 * connection setup per mail is fine at the volume the per-server daily cap
 * allows, so there is no pool. The transporter is cached under a hash of the
 * account (host, port, secure, user, password), so a saved change takes
 * effect on the next mail and the old transporter is closed.
 */
@Injectable()
export class MailerService implements OnModuleDestroy {
  private readonly logger = new Logger(MailerService.name);
  private cached: { key: string; transport: Transporter } | null = null;

  constructor(
    private readonly smtp: SmtpConfigService,
    private readonly audit: AuditService,
    private readonly limiter: SmtpTestLimiter,
  ) {}

  /** Mails `code` to `to`. Fails as `SMTP_NOT_CONFIGURED` or `EMAIL_SEND_FAILED`. */
  sendVerificationCode(input: {
    to: string;
    code: string;
    guildName: string;
    locale: string;
  }): Promise<void> {
    return this.send(input.to, buildCodeMail(input));
  }

  /** Mails a short note that proves the setup works. */
  sendTestMail(input: { to: string; guildName: string; locale: string }): Promise<void> {
    return this.send(input.to, buildTestMail(input));
  }

  /**
   * Connects and logs in with the STORED account (never with values from the
   * caller), switched on or not, without sending anything. Limited per person; every attempt is
   * audited, with the failure text scrubbed of the credentials. Throws
   * `RATE_LIMITED` or `SMTP_NOT_CONFIGURED`; any other outcome is the result.
   */
  async testStored(actor: ActorContext): Promise<SmtpTestResult> {
    this.limiter.consume(actor.userId ?? 'system');
    const target = await this.smtp.resolveSaved();
    if (target === null) throw new ServiceError(ErrorCode.SMTP_NOT_CONFIGURED);
    let transport: Transporter | undefined;
    let result: SmtpTestResult;
    let detail: string | undefined;
    try {
      transport = createTransport(this.optionsFor(target));
      await transport.verify();
      result = { ok: true };
    } catch (error) {
      this.logger.warn(`SMTP connection test failed (${failureLabel(error)})`);
      result = { ok: false, reason: testFailureReason(error) };
      detail = scrubSmtpError(error, target);
    } finally {
      transport?.close();
    }
    await this.audit.record({
      guildId: this.smtp.adminGuildId,
      actor,
      action: AUDIT_ACTIONS.emailVerifySmtpTest,
      params: { host: target.host, port: target.port, secure: target.secure },
      ok: result.ok,
      ...(detail === undefined ? {} : { error: detail }),
    });
    return result;
  }

  onModuleDestroy(): void {
    this.cached?.transport.close();
    this.cached = null;
  }

  private async send(to: string, mail: BuiltMail): Promise<void> {
    const target = await this.smtp.resolve();
    if (target === null) throw new ServiceError(ErrorCode.SMTP_NOT_CONFIGURED);
    try {
      const transport = this.transportFor(keyOf(target), this.optionsFor(target));
      await transport.sendMail({
        from: { name: target.fromName ?? '', address: target.fromAddress },
        to,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
      });
    } catch (error) {
      // Never the address or the server's own text: both can quote the recipient.
      this.logger.warn(`Sending a verification mail failed (${failureLabel(error)})`);
      throw new ServiceError(ErrorCode.EMAIL_SEND_FAILED);
    }
  }

  private transportFor(key: string, options: Parameters<typeof createTransport>[0]): Transporter {
    if (this.cached?.key === key) return this.cached.transport;
    this.cached?.transport.close();
    const transport = createTransport(options);
    this.cached = { key, transport };
    return transport;
  }

  /**
   * Connects to the saved host by name, with no address pre-check: only
   * managers of the admin server can save the account. Nodemailer resolves the
   * name itself, IPv4 before IPv6.
   */
  private optionsFor(target: SmtpTarget) {
    return {
      host: target.host,
      port: target.port,
      secure: target.secure,
      // The login is never sent over a connection that was not upgraded to TLS.
      requireTLS: !target.secure,
      auth: target.auth,
      connectionTimeout: CONNECTION_TIMEOUT_MS,
      greetingTimeout: GREETING_TIMEOUT_MS,
      socketTimeout: SOCKET_TIMEOUT_MS,
      dnsTimeout: DNS_TIMEOUT_MS,
    };
  }
}

/** The cache key of a transporter: a hash, so the password is not kept as a map key. */
function keyOf(target: SmtpTarget): string {
  return createHash('sha256')
    .update([target.host, target.port, target.secure, target.auth.user, target.auth.pass].join('|'))
    .digest('hex');
}
