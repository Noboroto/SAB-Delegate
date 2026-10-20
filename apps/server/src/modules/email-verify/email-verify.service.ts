import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  AUDIT_ACTIONS,
  EMAIL_CODE_LENGTH,
  EMAIL_CODE_MAX_ATTEMPTS,
  EMAIL_CODE_TTL_MINUTES,
  EMAIL_GUILD_DAILY_MAIL_CAP,
  EMAIL_MAX_SENDS_PER_PENDING,
  EmailTestMailInputSchema,
  ErrorCode,
  SnowflakeSchema,
  emailDomain,
  evaluateJoin,
  normalizeEmail,
  normalizeTermValue,
  type ActorContext,
  type EmailAccessStatus,
  type EmailVerifyStatus,
} from '@sab/shared';
import { AuditService } from '../../common/audit/audit.service.js';
import { ServiceError } from '../../common/errors/service-error.js';
import { failureLabel } from '../../discord/helpers/discord-failure.js';
import { translatorFor } from '../../i18n/translator.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { GuildConfigService } from '../guild-config/guild-config.service.js';
import { EmailActionLimiter } from './email-action-limiter.js';
import { EmailCryptoService, newCode, sameHash } from './email-crypto.js';
import { EmailVerifyDiscordService, type GrantResult } from './email-verify-discord.service.js';
import {
  businessDay,
  findGuildRowId,
  isUniqueViolation,
  judgeEmail,
  liftSendCooldown,
  lockMember,
  parseGuildId,
  readRules,
  releaseDailySend,
  reserveDailySend,
  reserveUserSend,
} from './email-verify-data.js';
import { maskEmail } from './email-mask.js';
import { roleMentions } from './email-verify.command-support.js';
import { MailerService } from './mailer.service.js';
import { SmtpConfigService } from './smtp-config.service.js';

/** A code was mailed. `maskedEmail` is safe to show in the reply. */
type CodeSent = {
  status: 'SENT';
  maskedEmail: string;
  expiresAt: Date;
  pendingId: string;
};

/**
 * The member is verified already. `verified` is what their verification gives
 * today, to hand to {@link EmailVerifyService.applyVerified} so a role they
 * lost is given back; `null` when it cannot be worked out (the stored address
 * cannot be read).
 */
type AlreadyVerified = { status: 'ALREADY_VERIFIED'; verified: Verified | null };

export type RequestCodeResult = CodeSent | AlreadyVerified;

export type ResendCodeResult = CodeSent | { status: 'NO_PENDING' };

/** The member is verified; hand this to {@link EmailVerifyService.applyVerified}. */
type Verified = {
  status: 'VERIFIED';
  domain: string;
  /** Roles to give: the default roles and those of every rule that holds. */
  addRoleIds: string[];
  /** The unverified role to take away, if the server has one. */
  removeRoleId: string | null;
};

export type ConfirmCodeResult = Verified | { status: 'NO_PENDING' } | AlreadyVerified;

type PendingRow = Prisma.EmailVerifyPendingGetPayload<object>;

const TTL_MS = EMAIL_CODE_TTL_MINUTES * 60_000;
const CODE_PATTERN = new RegExp(`^\\d{${EMAIL_CODE_LENGTH}}$`);
const SEND_DAYS_KEPT = 7;
const DAY_MS = 86_400_000;
const TX = { timeout: 10_000, maxWait: 5_000 } as const;

function parseUser(userId: string): string {
  const parsed = SnowflakeSchema.safeParse(userId);
  if (!parsed.success) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
  return parsed.data;
}

function refusal(status: EmailAccessStatus): ServiceError | null {
  switch (status) {
    case 'ACCEPTED':
      return null;
    case 'INVALID':
      return new ServiceError(ErrorCode.EMAIL_INVALID);
    case 'BLOCKED':
      return new ServiceError(ErrorCode.EMAIL_BLOCKED);
    case 'NOT_ACCEPTED':
      return new ServiceError(ErrorCode.EMAIL_NOT_ACCEPTED);
  }
}

/**
 * The flow a member goes through to verify an email address, and what the
 * Discord layer needs around it. Typical use, in this order:
 *
 * 1. `requestCode` with the address typed in the form: judges it against the
 *    blocklist and rules, mails a code, answers where it went.
 * 2. `resendCode` when the member asks for another one.
 * 3. `confirmCode` with the code typed in the second form: on success the
 *    verification is stored and the roles to change are returned.
 * 4. `applyVerified` with that result: gives the roles and writes the log line.
 *
 * Around it: `recordJoinInvite` and `rolesForJoin` for the join listener,
 * `status` and `testMail` for managers and `purgeExpired` for the daily job.
 *
 * Errors are `ServiceError` with an `EMAIL_*` or `SMTP_*` code, which the
 * transport turns into the member's language. Discord and SMTP are only called
 * after the database change has committed.
 */
@Injectable()
export class EmailVerifyService {
  private readonly logger = new Logger(EmailVerifyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly guilds: GuildConfigService,
    private readonly crypto: EmailCryptoService,
    private readonly smtp: SmtpConfigService,
    private readonly mailer: MailerService,
    private readonly discord: EmailVerifyDiscordService,
    private readonly limiter: EmailActionLimiter,
  ) {}

  /**
   * Starts (or restarts) a verification: judges `rawEmail`, stores a pending
   * verification and mails a code to it. A member who is already verified gets
   * `ALREADY_VERIFIED` (with the roles to give back). Fails with
   * `EMAIL_VERIFY_DISABLED`, `EMAIL_INVALID`, `EMAIL_BLOCKED`,
   * `EMAIL_NOT_ACCEPTED`, `EMAIL_ALREADY_USED` (another member has this
   * address), `RATE_LIMITED` (too many addresses tried), `EMAIL_RESEND_COOLDOWN`,
   * `EMAIL_USER_DAILY_CAP`, `EMAIL_DAILY_CAP`, `SMTP_NOT_CONFIGURED` or
   * `EMAIL_SEND_FAILED`.
   */
  async requestCode(
    guildId: string,
    userId: string,
    rawEmail: string,
    locale: string,
  ): Promise<RequestCodeResult> {
    const id = parseGuildId(guildId);
    const user = parseUser(userId);
    this.crypto.requireSecret();
    const config = await this.prisma.emailVerifyConfig.findFirst({
      where: { guild: { discordId: id } },
      select: { guildId: true, enabled: true },
    });
    if (config === null || !config.enabled) throw new ServiceError(ErrorCode.EMAIL_VERIFY_DISABLED);
    const guildRowId = config.guildId;
    const already = await this.alreadyVerified(guildRowId, user);
    if (already !== null) return already;

    const email = normalizeEmail(rawEmail);
    if (email === null) throw new ServiceError(ErrorCode.EMAIL_INVALID);
    if (!(await this.smtp.ready())) throw new ServiceError(ErrorCode.SMTP_NOT_CONFIGURED);

    const emailHash = this.crypto.hashEmail(email);
    this.limiter.consumeAddressCheck(id, user);
    const judged = await judgeEmail(this.prisma, { guildRowId, userId: user, email, emailHash });
    const refused = refusal(judged.status);
    if (refused !== null) throw refused;
    const holder = await this.prisma.emailVerification.findUnique({
      where: { guildId_emailHash: { guildId: guildRowId, emailHash } },
      select: { userId: true },
    });
    if (holder !== null && holder.userId !== user) {
      throw new ServiceError(ErrorCode.EMAIL_ALREADY_USED);
    }

    const issued = await this.issue(guildRowId, user, email, emailHash);
    return this.deliver(id, guildRowId, user, email, issued, locale);
  }

  /**
   * Mails a new code to the address of the member's pending verification.
   * `NO_PENDING` when there is none (or it expired). The address is judged
   * again, so a rule changed since the first code applies. Fails like
   * `requestCode`, also with `EMAIL_RESEND_COOLDOWN` once the mails of one
   * pending verification are used up or its codes were guessed wrong too often
   * (the wait is until it expires).
   */
  async resendCode(guildId: string, userId: string, locale: string): Promise<ResendCodeResult> {
    const id = parseGuildId(guildId);
    const user = parseUser(userId);
    this.crypto.requireSecret();
    const guildRowId = await findGuildRowId(this.prisma, id);
    if (guildRowId === null) return { status: 'NO_PENDING' };
    await this.requireEnabled(guildRowId);
    const pending = await this.prisma.emailVerifyPending.findUnique({
      where: { guildId_userId: { guildId: guildRowId, userId: user } },
    });
    if (pending === null || pending.expiresAt <= new Date()) return { status: 'NO_PENDING' };
    const email = this.crypto.decrypt(pending.emailEnc);
    if (email === null) {
      await this.close(pending);
      return { status: 'NO_PENDING' };
    }
    if (!(await this.smtp.ready())) throw new ServiceError(ErrorCode.SMTP_NOT_CONFIGURED);

    this.limiter.consumeAddressCheck(id, user);
    const judged = await judgeEmail(this.prisma, {
      guildRowId,
      userId: user,
      email,
      emailHash: pending.emailHash,
    });
    const refused = refusal(judged.status);
    if (refused !== null) {
      await this.close(pending);
      throw refused;
    }
    const issued = await this.issue(guildRowId, user, email, pending.emailHash);
    return this.deliver(id, guildRowId, user, email, issued, locale);
  }

  /**
   * Checks the code. Each wrong code counts; at `EMAIL_CODE_MAX_ATTEMPTS` the
   * pending verification stays, spent, until it expires: closing it would hand
   * out a fresh set of guesses at once. On success the verification is stored,
   * the pending one removed, and the roles to change are returned (see
   * {@link EmailVerifyService.applyVerified}); the rules are judged again here,
   * so a rule changed after the code was mailed applies. Fails with
   * `EMAIL_VERIFY_DISABLED`, `EMAIL_CODE_INVALID`, `EMAIL_CODE_EXPIRED`,
   * `EMAIL_TOO_MANY_ATTEMPTS`, `EMAIL_ALREADY_USED` or the refusals of
   * `requestCode` if the rules now refuse the address.
   */
  async confirmCode(guildId: string, userId: string, rawCode: string): Promise<ConfirmCodeResult> {
    const id = parseGuildId(guildId);
    const user = parseUser(userId);
    this.crypto.requireSecret();
    const guildRowId = await findGuildRowId(this.prisma, id);
    if (guildRowId === null) return { status: 'NO_PENDING' };
    await this.requireEnabled(guildRowId);
    const pending = await this.prisma.emailVerifyPending.findUnique({
      where: { guildId_userId: { guildId: guildRowId, userId: user } },
    });
    if (pending === null)
      return (await this.alreadyVerified(guildRowId, user)) ?? { status: 'NO_PENDING' };
    if (pending.expiresAt <= new Date()) {
      await this.close(pending);
      throw new ServiceError(ErrorCode.EMAIL_CODE_EXPIRED);
    }
    const code = rawCode.trim();
    if (!CODE_PATTERN.test(code)) throw new ServiceError(ErrorCode.EMAIL_CODE_INVALID);

    // The attempt is counted before the code is compared, in one conditional
    // update: guesses made at the same moment cannot share an attempt.
    const counted = await this.prisma.emailVerifyPending.updateMany({
      where: { id: pending.id, attempts: { lt: EMAIL_CODE_MAX_ATTEMPTS } },
      data: { attempts: { increment: 1 } },
    });
    if (counted.count === 0) throw new ServiceError(ErrorCode.EMAIL_TOO_MANY_ATTEMPTS);
    if (!sameHash(pending.codeHash, this.crypto.hashCode(pending.id, code))) {
      if (pending.attempts + 1 >= EMAIL_CODE_MAX_ATTEMPTS) {
        throw new ServiceError(ErrorCode.EMAIL_TOO_MANY_ATTEMPTS);
      }
      throw new ServiceError(ErrorCode.EMAIL_CODE_INVALID);
    }

    const email = this.crypto.decrypt(pending.emailEnc);
    if (email === null) {
      await this.close(pending);
      throw new ServiceError(ErrorCode.EMAIL_CODE_EXPIRED);
    }
    const judged = await judgeEmail(this.prisma, {
      guildRowId,
      userId: user,
      email,
      emailHash: pending.emailHash,
    });
    const refused = refusal(judged.status);
    if (refused !== null) {
      await this.close(pending);
      throw refused;
    }

    const domain = emailDomain(email);
    try {
      const stored = await this.prisma.$transaction(async (tx) => {
        await lockMember(tx, guildRowId, user);
        const gone = await tx.emailVerifyPending.deleteMany({ where: { id: pending.id } });
        // Someone else confirmed the same pending verification a moment ago.
        if (gone.count === 0) return false;
        await tx.emailVerification.create({
          data: {
            guildId: guildRowId,
            userId: user,
            emailEnc: pending.emailEnc,
            emailHash: pending.emailHash,
            domain,
            method: 'CODE',
          },
        });
        await this.audit.record(
          {
            guildId: id,
            actor: { source: 'DISCORD', userId: user },
            action: AUDIT_ACTIONS.emailVerifyMemberVerified,
            params: { emailDomain: domain, method: 'CODE', userId: user },
          },
          tx,
        );
        return true;
      }, TX);
      if (!stored) {
        return (await this.alreadyVerified(guildRowId, user)) ?? { status: 'NO_PENDING' };
      }
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const already = await this.alreadyVerified(guildRowId, user);
      if (already !== null) return already;
      throw new ServiceError(ErrorCode.EMAIL_ALREADY_USED);
    }
    return {
      status: 'VERIFIED',
      domain,
      addRoleIds: judged.roleIds,
      removeRoleId: judged.unverifiedRoleId,
    };
  }

  /**
   * Gives the member the roles of a verification, takes the unverified role,
   * and writes a line in the server's log channel (also when Discord refused
   * a role). Returns what Discord did; a refusal is in `failure`, not thrown.
   * With `rerun` (the roles of an earlier verification given again) nothing
   * is written when nothing needed changing.
   */
  async applyVerified(
    guildId: string,
    userId: string,
    verified: Verified,
    options: { rerun?: boolean } = {},
  ): Promise<GrantResult> {
    const granted = await this.discord.grantRoles(guildId, userId, {
      add: verified.addRoleIds,
      remove: verified.removeRoleId === null ? [] : [verified.removeRoleId],
    });
    const changed = granted.added.length > 0 || granted.removed.length > 0;
    if (options.rerun === true && granted.failure === null && !changed) return granted;

    const t = translatorFor(await this.discord.locale(guildId));
    const user = `<@${userId}>`;
    const given = granted.memberGone
      ? []
      : verified.addRoleIds.filter((roleId) => !granted.refused.includes(roleId));
    const roles = roleMentions(given, t('email-verify.status.none'));
    const lines = [
      t(options.rerun === true ? 'email-verify.log.regranted' : 'email-verify.log.verified', {
        user,
        domain: verified.domain,
        roles,
      }),
    ];
    if (granted.failure !== null) {
      const refused = roleMentions(granted.refused, '');
      lines.push(
        t('email-verify.log.roleFailed', {
          user,
          reason: refused === '' ? granted.failure : `${granted.failure} (${refused})`,
        }),
      );
    }
    await this.discord.postLog(guildId, lines.join('\n'));
    return granted;
  }

  /**
   * What a member who is already verified gets today (their stored address
   * judged against the current rules and their join invite), for a server they
   * rejoined. `null` when they are not verified or their address cannot be read.
   */
  async verifiedGrant(guildId: string, userId: string): Promise<Verified | null> {
    const id = parseGuildId(guildId);
    const user = parseUser(userId);
    const guildRowId = await findGuildRowId(this.prisma, id);
    if (guildRowId === null) return null;
    return (await this.alreadyVerified(guildRowId, user))?.verified ?? null;
  }

  /**
   * Remembers the invite a member joined with; the latest join wins. A server
   * with no access rules has no use for it (rules are the only thing that read
   * it back), so nothing is stored for it.
   */
  async recordJoinInvite(guildId: string, userId: string, inviteCode: string): Promise<void> {
    const id = parseGuildId(guildId);
    const user = parseUser(userId);
    const code = normalizeTermValue('invite', inviteCode);
    if (code === null) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
    const guildRowId = await findGuildRowId(this.prisma, id);
    if (guildRowId === null) return;
    if ((await this.prisma.accessRule.count({ where: { guildId: guildRowId } })) === 0) return;
    const write = () =>
      this.prisma.memberJoinInvite.upsert({
        where: { guildId_userId: { guildId: guildRowId, userId: user } },
        create: { guildId: guildRowId, userId: user, inviteCode: code },
        update: { inviteCode: code, joinedAt: new Date() },
      });
    try {
      await write();
    } catch (error) {
      // Two joins of one member at once: the second finds the row the first made.
      if (!isUniqueViolation(error)) throw error;
      await write();
    }
  }

  /** Roles a member gets on joining with `inviteCode`, before any address is known. */
  async rolesForJoin(guildId: string, inviteCode: string | null): Promise<string[]> {
    const id = parseGuildId(guildId);
    const guildRowId = await findGuildRowId(this.prisma, id);
    if (guildRowId === null) return [];
    const rules = await readRules(this.prisma, guildRowId);
    return evaluateJoin({ inviteCode, rules }).roleIds;
  }

  /** Where the server's verification stands. Writes nothing. */
  async status(guildId: string, now: Date = new Date()): Promise<EmailVerifyStatus> {
    const id = parseGuildId(guildId);
    const smtpReady = await this.smtp.ready();
    const guildRowId = await findGuildRowId(this.prisma, id);
    const empty = {
      verified: 0,
      pending: 0,
      lists: 0,
      rules: 0,
      sentToday: 0,
      dailyCap: EMAIL_GUILD_DAILY_MAIL_CAP,
    };
    if (guildRowId === null) return { enabled: false, smtpReady, ...empty };
    const where = { guildId: guildRowId };
    const [config, verified, pending, lists, rules, today] = await Promise.all([
      this.prisma.emailVerifyConfig.findUnique({ where, select: { enabled: true } }),
      this.prisma.emailVerification.count({ where }),
      this.prisma.emailVerifyPending.count({ where: { ...where, expiresAt: { gt: now } } }),
      this.prisma.emailList.count({ where }),
      this.prisma.accessRule.count({ where }),
      this.prisma.emailSendDay.findUnique({
        where: { guildId_day: { guildId: guildRowId, day: businessDay(now) } },
        select: { count: true },
      }),
    ]);
    return {
      enabled: config?.enabled ?? false,
      smtpReady,
      verified,
      pending,
      lists,
      rules,
      sentToday: today?.count ?? 0,
      dailyCap: EMAIL_GUILD_DAILY_MAIL_CAP,
    };
  }

  /**
   * Mails a short note to `input.email` to prove the setup works. It counts
   * against the server's daily mails like a code, and each person may send a
   * few per window, so it cannot be used to flood an address. The mail is
   * audited with the address's domain only; when it cannot be sent, its place
   * in the day's count is given back.
   */
  async testMail(
    guildId: string,
    input: unknown,
    actor: ActorContext,
    locale?: string,
  ): Promise<void> {
    const id = parseGuildId(guildId);
    const parsed = EmailTestMailInputSchema.safeParse(input);
    if (!parsed.success) throw new ServiceError(ErrorCode.EMAIL_INVALID);
    const email = normalizeEmail(parsed.data.email);
    if (email === null) throw new ServiceError(ErrorCode.EMAIL_INVALID);
    this.crypto.requireSecret();
    if (!(await this.smtp.ready())) throw new ServiceError(ErrorCode.SMTP_NOT_CONFIGURED);
    this.limiter.consumeTestMail(actor.userId ?? 'system');

    const now = new Date();
    const guildRowId = await this.prisma.$transaction(async (tx) => {
      const guild = await this.guilds.ensureGuild(id, undefined, tx);
      await reserveDailySend(tx, guild.id, now);
      return guild.id;
    }, TX);
    let ok = false;
    try {
      await this.mailer.sendTestMail({
        to: email,
        guildName: await this.discord.guildName(id),
        locale: locale ?? (await this.discord.locale(id)),
      });
      ok = true;
    } catch (error) {
      await releaseDailySend(this.prisma, guildRowId, now).catch(() => {
        this.logger.warn('Could not give back the daily mail count after a failed test mail');
      });
      throw error;
    } finally {
      await this.audit
        .record({
          guildId: id,
          actor,
          action: AUDIT_ACTIONS.emailVerifyTestMail,
          params: { emailDomain: emailDomain(email) },
          ok,
        })
        .catch((error: unknown) => {
          this.logger.warn(`Could not audit a test mail (${failureLabel(error)})`);
        });
    }
  }

  /**
   * Deletes pending verifications past their expiry and the mail counts of
   * days nobody can still be limited by. For the daily job.
   */
  async purgeExpired(
    now: Date = new Date(),
  ): Promise<{ pending: number; sendDays: number; throttles: number }> {
    const pending = await this.prisma.emailVerifyPending.deleteMany({
      where: { expiresAt: { lt: now } },
    });
    const today = businessDay(now).getTime();
    const sendDays = await this.prisma.emailSendDay.deleteMany({
      where: { day: { lt: new Date(today - SEND_DAYS_KEPT * DAY_MS) } },
    });
    // A member's row only limits them on the day it was written (and a minute
    // past midnight); yesterday's is the oldest that can still matter.
    const throttles = await this.prisma.emailSendThrottle.deleteMany({
      where: { day: { lt: new Date(today - DAY_MS) } },
    });
    return { pending: pending.count, sendDays: sendDays.count, throttles: throttles.count };
  }

  /** The verification of a member and what it gives today, or `null` when they have none. */
  private async alreadyVerified(
    guildRowId: string,
    userId: string,
  ): Promise<AlreadyVerified | null> {
    const row = await this.prisma.emailVerification.findUnique({
      where: { guildId_userId: { guildId: guildRowId, userId } },
      select: { emailEnc: true, emailHash: true, domain: true },
    });
    if (row === null) return null;
    const email = this.crypto.decrypt(row.emailEnc);
    if (email === null) return { status: 'ALREADY_VERIFIED', verified: null };
    const judged = await judgeEmail(this.prisma, {
      guildRowId,
      userId,
      email,
      emailHash: row.emailHash,
    });
    return {
      status: 'ALREADY_VERIFIED',
      verified: {
        status: 'VERIFIED',
        domain: row.domain,
        // An address the rules no longer accept stays verified, with the default roles only.
        addRoleIds: judged.status === 'ACCEPTED' ? judged.roleIds : judged.defaultRoleIds,
        removeRoleId: judged.unverifiedRoleId,
      },
    };
  }

  private async requireEnabled(guildRowId: string): Promise<void> {
    const config = await this.prisma.emailVerifyConfig.findUnique({
      where: { guildId: guildRowId },
      select: { enabled: true },
    });
    if (config === null || !config.enabled) throw new ServiceError(ErrorCode.EMAIL_VERIFY_DISABLED);
  }

  /**
   * Stores the next code of a member (a new pending verification, or the
   * existing one with a fresh code) and counts the mail against the member
   * and the day, in one transaction: when a limit refuses, nothing is stored.
   */
  private async issue(
    guildRowId: string,
    userId: string,
    email: string,
    emailHash: string,
  ): Promise<{ pendingId: string; code: string; expiresAt: Date }> {
    return this.prisma.$transaction(async (tx) => {
      await lockMember(tx, guildRowId, userId);
      const now = new Date();
      const found = await tx.emailVerifyPending.findUnique({
        where: { guildId_userId: { guildId: guildRowId, userId } },
      });
      const live = found !== null && found.expiresAt > now ? found : null;
      if (live !== null) this.assertMayResend(live, now);
      // Checked whether or not a pending verification exists: closing or
      // erasing one must not reset the wait or the member's daily mails.
      await reserveUserSend(tx, guildRowId, userId, now);
      await reserveDailySend(tx, guildRowId, now);

      const code = newCode();
      const expiresAt = new Date(now.getTime() + TTL_MS);
      const emailEnc = this.crypto.encrypt(email);
      if (live !== null) {
        await tx.emailVerifyPending.update({
          where: { id: live.id },
          data: {
            emailEnc,
            emailHash,
            codeHash: this.crypto.hashCode(live.id, code),
            attempts: 0,
            sendCount: live.sendCount + 1,
            expiresAt,
            lastSentAt: now,
          },
        });
        return { pendingId: live.id, code, expiresAt };
      }
      if (found !== null) await tx.emailVerifyPending.delete({ where: { id: found.id } });
      // The hash covers the row's own id, which exists only once the row does.
      const created = await tx.emailVerifyPending.create({
        data: {
          guildId: guildRowId,
          userId,
          emailEnc,
          emailHash,
          codeHash: 'pending',
          expiresAt,
          lastSentAt: now,
        },
        select: { id: true },
      });
      await tx.emailVerifyPending.update({
        where: { id: created.id },
        data: { codeHash: this.crypto.hashCode(created.id, code) },
      });
      return { pendingId: created.id, code, expiresAt };
    }, TX);
  }

  /**
   * A pending verification that has used its mails, or whose codes were
   * guessed wrong too often, takes no new code until it expires: a fresh
   * code would hand out a fresh set of guesses.
   */
  private assertMayResend(pending: PendingRow, now: Date): void {
    if (
      pending.sendCount >= EMAIL_MAX_SENDS_PER_PENDING ||
      pending.attempts >= EMAIL_CODE_MAX_ATTEMPTS
    ) {
      throw new ServiceError(ErrorCode.EMAIL_RESEND_COOLDOWN, {
        seconds: Math.ceil((pending.expiresAt.getTime() - now.getTime()) / 1_000),
      });
    }
  }

  /**
   * Sends the mail of a stored code. Only after the commit: a mail cannot be
   * taken back and a rolled-back row would leave a code nobody can use. When
   * the mail fails the wait is lifted so the member can try again at once
   * (their mails of the day stay counted).
   */
  private async deliver(
    guildId: string,
    guildRowId: string,
    userId: string,
    email: string,
    issued: { pendingId: string; code: string; expiresAt: Date },
    locale: string,
  ): Promise<CodeSent> {
    try {
      await this.mailer.sendVerificationCode({
        to: email,
        code: issued.code,
        guildName: await this.discord.guildName(guildId),
        locale,
      });
    } catch (error) {
      await liftSendCooldown(this.prisma, guildRowId, userId).catch(() => {
        this.logger.warn('Could not lift the resend cooldown after a failed mail');
      });
      throw error;
    }
    return {
      status: 'SENT',
      maskedEmail: maskEmail(email),
      expiresAt: issued.expiresAt,
      pendingId: issued.pendingId,
    };
  }

  private async close(pending: Pick<PendingRow, 'id'>): Promise<void> {
    await this.prisma.emailVerifyPending.deleteMany({ where: { id: pending.id } });
  }
}
