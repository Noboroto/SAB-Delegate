import type { Prisma } from '@prisma/client';
import {
  AccessConditionSchema,
  BUSINESS_TIME_ZONE,
  EMAIL_GUILD_DAILY_MAIL_CAP,
  EMAIL_RESEND_COOLDOWN_SECONDS,
  EMAIL_USER_DAILY_MAIL_CAP,
  ErrorCode,
  SnowflakeSchema,
  collectListNames,
  evaluateEmailAccess,
  type AccessCondition,
  type EmailAccessResult,
} from '@sab/shared';
import { ServiceError } from '../../common/errors/service-error.js';

/** The tables the reads below touch; a transaction client or the service itself fits. */
export type EmailVerifyDb = Pick<
  Prisma.TransactionClient,
  | 'guild'
  | 'accessRule'
  | 'emailListEntry'
  | 'memberJoinInvite'
  | 'emailBlockPattern'
  | 'emailVerifyConfig'
>;

/** A server's Discord id, checked: a malformed one must never reach a query. */
export function parseGuildId(guildId: string): string {
  const parsed = SnowflakeSchema.safeParse(guildId);
  if (!parsed.success) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
  return parsed.data;
}

/** The row id of a server the bot has seen; `null` for one it has not. */
export async function findGuildRowId(
  db: Pick<EmailVerifyDb, 'guild'>,
  discordId: string,
): Promise<string | null> {
  const row = await db.guild.findUnique({ where: { discordId }, select: { id: true } });
  return row?.id ?? null;
}

type StoredRule = {
  readonly roleIds: string[];
  readonly condition: AccessCondition;
};

/**
 * The server's rules in order. The condition column is Json, so every row is
 * parsed; a row that no longer parses stops the call instead of being skipped,
 * because a skipped rule can turn "only these addresses" into "anyone".
 */
export async function readRules(
  db: Pick<EmailVerifyDb, 'accessRule'>,
  guildRowId: string,
): Promise<StoredRule[]> {
  const rows = await db.accessRule.findMany({
    where: { guildId: guildRowId },
    orderBy: { position: 'asc' },
    select: { roleIds: true, condition: true },
  });
  return rows.map((row, index) => {
    const condition = AccessConditionSchema.safeParse(row.condition);
    if (!condition.success) {
      throw new ServiceError(ErrorCode.EMAIL_RULE_INVALID, {
        rule: index + 1,
        term: 'condition',
        reason: 'stored condition is damaged',
      });
    }
    return { roleIds: row.roleIds, condition: condition.data };
  });
}

/** Names of the lists, of those the rules refer to, that hold the address with this hash. */
async function listHitsFor(
  db: Pick<EmailVerifyDb, 'emailListEntry'>,
  guildRowId: string,
  rules: readonly StoredRule[],
  emailHash: string,
): Promise<Set<string>> {
  const names = [...new Set(rules.flatMap((rule) => collectListNames(rule.condition)))];
  if (names.length === 0) return new Set();
  const hits = await db.emailListEntry.findMany({
    where: { emailHash, list: { guildId: guildRowId, name: { in: names } } },
    select: { list: { select: { name: true } } },
  });
  return new Set(hits.map((hit) => hit.list.name));
}

/** The invite code a member joined with, `null` when the bot did not see it. */
async function inviteOf(
  db: Pick<EmailVerifyDb, 'memberJoinInvite'>,
  guildRowId: string,
  userId: string,
): Promise<string | null> {
  const row = await db.memberJoinInvite.findUnique({
    where: { guildId_userId: { guildId: guildRowId, userId } },
    select: { inviteCode: true },
  });
  return row?.inviteCode ?? null;
}

const DAY_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * The calendar day in the business time zone, as the UTC midnight a `@db.Date`
 * column stores (the column has no zone; this keeps the same day everywhere).
 */
export function businessDay(at: Date): Date {
  return new Date(`${DAY_FORMAT.format(at)}T00:00:00.000Z`);
}

/** Whether a Prisma error is a unique-constraint violation. */
export function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

/**
 * Judges an address for a member against the server's blocklist and rules:
 * the one place an address is accepted or refused, so a code is never mailed
 * to an address that confirming it would refuse. `emailHash` is the keyed hash
 * of `email`, which the caller has already computed.
 */
export async function judgeEmail(
  db: EmailVerifyDb,
  input: { guildRowId: string; userId: string; email: string; emailHash: string },
): Promise<EmailAccessResult & { defaultRoleIds: string[]; unverifiedRoleId: string | null }> {
  const { guildRowId, userId, email, emailHash } = input;
  const [rules, blocks, config, inviteCode] = await Promise.all([
    readRules(db, guildRowId),
    db.emailBlockPattern.findMany({ where: { guildId: guildRowId }, select: { pattern: true } }),
    db.emailVerifyConfig.findUnique({
      where: { guildId: guildRowId },
      select: { defaultRoleIds: true, unverifiedRoleId: true },
    }),
    inviteOf(db, guildRowId, userId),
  ]);
  const listHits = await listHitsFor(db, guildRowId, rules, emailHash);
  const defaultRoleIds = config?.defaultRoleIds ?? [];
  const result = evaluateEmailAccess({
    email,
    inviteCode,
    listHits,
    blockPatterns: blocks.map((block) => block.pattern),
    rules,
    defaultRoleIds,
  });
  return { ...result, defaultRoleIds, unverifiedRoleId: config?.unverifiedRoleId ?? null };
}

/**
 * Counts one mail against the server's day, refusing with `EMAIL_DAILY_CAP`
 * when the day is full. The check and the increment are one conditional
 * `UPDATE`, so two mails asked for at once cannot both take the last place.
 * Call it inside the transaction that records the mail, so a refusal leaves
 * nothing behind.
 */
export async function reserveDailySend(
  tx: Pick<Prisma.TransactionClient, 'emailSendDay'>,
  guildRowId: string,
  now: Date,
): Promise<void> {
  const day = businessDay(now);
  await tx.emailSendDay.createMany({
    data: [{ guildId: guildRowId, day, count: 0 }],
    skipDuplicates: true,
  });
  const { count } = await tx.emailSendDay.updateMany({
    where: { guildId: guildRowId, day, count: { lt: EMAIL_GUILD_DAILY_MAIL_CAP } },
    data: { count: { increment: 1 } },
  });
  if (count === 0) throw new ServiceError(ErrorCode.EMAIL_DAILY_CAP);
}

/** Takes back a mail counted by {@link reserveDailySend} that was never sent. */
export async function releaseDailySend(
  db: Pick<Prisma.TransactionClient, 'emailSendDay'>,
  guildRowId: string,
  now: Date,
): Promise<void> {
  await db.emailSendDay.updateMany({
    where: { guildId: guildRowId, day: businessDay(now), count: { gt: 0 } },
    data: { count: { decrement: 1 } },
  });
}

const COOLDOWN_MS = EMAIL_RESEND_COOLDOWN_SECONDS * 1_000;

/**
 * Counts one mail to a member against the limits that must outlive their
 * pending verification (which closing, expiring or erasing deletes): the wait
 * since their last mail and their mails of the day. Refuses with
 * `EMAIL_RESEND_COOLDOWN` or `EMAIL_USER_DAILY_CAP`. Call it inside the
 * transaction that holds {@link lockMember} for the same member, which is what
 * makes the read and the write one step.
 */
export async function reserveUserSend(
  tx: Pick<Prisma.TransactionClient, 'emailSendThrottle'>,
  guildRowId: string,
  userId: string,
  now: Date,
): Promise<void> {
  const key = { guildId: guildRowId, userId };
  const day = businessDay(now);
  const row = await tx.emailSendThrottle.findUnique({ where: { guildId_userId: key } });
  let count = 1;
  if (row !== null) {
    const wait = row.lastSentAt.getTime() + COOLDOWN_MS - now.getTime();
    if (wait > 0) {
      throw new ServiceError(ErrorCode.EMAIL_RESEND_COOLDOWN, { seconds: Math.ceil(wait / 1_000) });
    }
    if (row.day.getTime() === day.getTime()) {
      if (row.count >= EMAIL_USER_DAILY_MAIL_CAP) {
        throw new ServiceError(ErrorCode.EMAIL_USER_DAILY_CAP);
      }
      count = row.count + 1;
    }
  }
  await tx.emailSendThrottle.upsert({
    where: { guildId_userId: key },
    create: { ...key, day, count, lastSentAt: now },
    update: { day, count, lastSentAt: now },
  });
}

/** Lets a member ask again at once, after a mail that never went out. The day's count is kept. */
export async function liftSendCooldown(
  db: Pick<Prisma.TransactionClient, 'emailSendThrottle'>,
  guildRowId: string,
  userId: string,
): Promise<void> {
  await db.emailSendThrottle.updateMany({
    where: { guildId: guildRowId, userId },
    data: { lastSentAt: new Date(Date.now() - COOLDOWN_MS) },
  });
}

/** Serialises everything one member does to their own verification in one server. */
export async function lockMember(
  tx: Pick<Prisma.TransactionClient, '$executeRaw'>,
  guildRowId: string,
  userId: string,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`email-verify:${guildRowId}:${userId}`}, 0))`;
}
