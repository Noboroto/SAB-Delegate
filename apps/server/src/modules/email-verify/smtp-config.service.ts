import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  AUDIT_ACTIONS,
  ErrorCode,
  SmtpSettingsInputSchema,
  type ActorContext,
  type SmtpSettings,
} from '@sab/shared';
import { AuditService } from '../../common/audit/audit.service.js';
import { ServiceError } from '../../common/errors/service-error.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { EMAIL_VERIFY_ENV, EmailCryptoService } from './email-crypto.js';
import type { EmailVerifyEnv } from './email-verify.env.js';
import { resolveSafeSmtpAddress } from './smtp-host-guard.js';

/** A mail account ready to connect to, the password decrypted. Never log or return it. */
type SmtpTarget = {
  host: string;
  port: number;
  secure: boolean;
  auth: { user: string; pass: string };
  fromAddress: string;
  fromName: string | null;
};

/** How long a resolved account is reused; a save in this process clears it at once. */
export const SMTP_CACHE_TTL_MS = 5_000;

const SELECT = {
  host: true,
  port: true,
  secure: true,
  username: true,
  passwordEnc: true,
  fromAddress: true,
  fromName: true,
  enabled: true,
} as const;

/**
 * The one SMTP account the bot sends verification mail through, stored in the
 * database like the LLM settings (there is no environment fallback). The
 * password is encrypted with `LLM_KEY_SECRET` and is never read back out of
 * this service except, decrypted, by `resolve` for the mailer.
 */
@Injectable()
export class SmtpConfigService {
  private readonly logger = new Logger(SmtpConfigService.name);
  private cache: { at: number; target: SmtpTarget | null } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly crypto: EmailCryptoService,
    @Inject(EMAIL_VERIFY_ENV) private readonly env: EmailVerifyEnv,
  ) {}

  /** The admin guild's id: the only server whose managers configure SMTP. */
  get adminGuildId(): string {
    return this.env.adminGuildId;
  }

  private row() {
    return this.prisma.smtpConfig.findUnique({ where: { singleton: true }, select: SELECT });
  }

  /** The saved account as the given server's managers may see it; never the password. */
  async view(guildId: string): Promise<SmtpSettings> {
    const adminServer = guildId === this.env.adminGuildId;
    const row = adminServer ? await this.row() : null;
    return {
      adminServer,
      available: this.crypto.available,
      host: row?.host ?? '',
      port: row?.port ?? 465,
      secure: row?.secure ?? true,
      username: row?.username ?? '',
      fromAddress: row?.fromAddress ?? '',
      fromName: row?.fromName ?? null,
      enabled: row?.enabled ?? false,
      // A password the current secret cannot read is no password: the form asks again.
      passwordSet: row !== null && this.crypto.decrypt(row.passwordEnc) !== null,
    };
  }

  /**
   * The account mail goes out through, `null` when none can be used: nothing
   * saved, switched off, no key secret, or a password the secret cannot read
   * (logged as a warning naming the reason, no values).
   */
  async resolve(now: number = Date.now()): Promise<SmtpTarget | null> {
    if (this.cache !== null && now - this.cache.at < SMTP_CACHE_TTL_MS) return this.cache.target;
    const target = await this.load({ requireEnabled: true });
    this.cache = { at: now, target };
    return target;
  }

  /**
   * The saved account whether or not it is switched on, `null` when none is
   * saved or it cannot be read. For a connection test: an admin checks the
   * account before turning it on, so the switch must not hide it.
   */
  resolveSaved(): Promise<SmtpTarget | null> {
    return this.load({ requireEnabled: false });
  }

  /** Whether mail can be sent at all. */
  async ready(): Promise<boolean> {
    return (await this.resolve()) !== null;
  }

  /**
   * Saves the account. An absent (or empty) password keeps the stored one, but
   * only for the same host: a stored password is never sent somewhere it was
   * not entered for. The first save needs a password.
   */
  async save(input: unknown, actor: ActorContext): Promise<SmtpSettings> {
    this.crypto.requireSecret();
    const parsed = SmtpSettingsInputSchema.safeParse(input);
    if (!parsed.success) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
    const { password, ...data } = parsed.data;
    await resolveSafeSmtpAddress(data.host);

    // The database, not the cache: a kept password must be the one stored now.
    const current = await this.row();
    const changed = password !== undefined && password !== '';
    let passwordEnc: string;
    if (changed) {
      passwordEnc = this.crypto.encrypt(password);
    } else if (
      current !== null &&
      current.host === data.host &&
      this.crypto.decrypt(current.passwordEnc) !== null
    ) {
      passwordEnc = current.passwordEnc;
    } else {
      throw new ServiceError(ErrorCode.VALIDATION_FAILED);
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.smtpConfig.upsert({
          where: { singleton: true },
          create: { ...data, passwordEnc },
          update: { ...data, passwordEnc },
        });
        await this.audit.record(
          {
            guildId: this.env.adminGuildId,
            actor,
            action: AUDIT_ACTIONS.emailVerifySmtpSet,
            params: {
              host: data.host,
              port: data.port,
              secure: data.secure,
              enabled: data.enabled,
              passwordChanged: changed,
            },
          },
          tx,
        );
      });
    } finally {
      this.cache = null;
    }
    return this.view(this.env.adminGuildId);
  }

  private async load(options: { requireEnabled: boolean }): Promise<SmtpTarget | null> {
    const row = await this.row();
    if (row === null) {
      this.logger.debug('No SMTP account is saved');
      return null;
    }
    if (options.requireEnabled && !row.enabled) {
      this.logger.debug('The saved SMTP account is switched off');
      return null;
    }
    if (!this.crypto.available) {
      this.logger.warn('An SMTP account is saved but LLM_KEY_SECRET is not set');
      return null;
    }
    const pass = this.crypto.decrypt(row.passwordEnc);
    if (pass === null) {
      this.logger.warn(
        'The saved SMTP password cannot be decrypted with LLM_KEY_SECRET; enter it again',
      );
      return null;
    }
    return {
      host: row.host,
      port: row.port,
      secure: row.secure,
      auth: { user: row.username, pass },
      fromAddress: row.fromAddress,
      fromName: row.fromName,
    };
  }
}
