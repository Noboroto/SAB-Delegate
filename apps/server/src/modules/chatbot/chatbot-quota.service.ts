import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AUDIT_ACTIONS,
  CHATBOT_DEFAULT_MONTHLY_LIMIT,
  CHATBOT_LIMIT_MAX,
  ChatbotQuotaGrantRequestSchema,
  ChatbotQuotaSetRequestSchema,
  ErrorCode,
  SnowflakeSchema,
  type ActorContext,
  type ChatbotQuotaListQuery,
  type ChatbotQuotaRow,
} from '@sab/shared';
import { AuditService } from '../../common/audit/audit.service.js';
import { ServiceError } from '../../common/errors/service-error.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { GuildConfigService } from '../guild-config/guild-config.service.js';
import { periodOf } from './chatbot-period.js';

/** A member's month as the footer and the admin views show it. */
type Quota = Pick<ChatbotQuotaRow, 'used' | 'limit' | 'bonus' | 'overridden' | 'remaining'> & {
  /** The limit in force plus this month's bonus. */
  total: number;
};

type QuotaListItem = Omit<ChatbotQuotaRow, 'displayName'>;

type QuotaPage = { items: QuotaListItem[]; total: number; period: string; defaultLimit: number };

type QuotaColumns = {
  limit: number;
  bonus: number;
  used: number;
  overridden: boolean;
};

/** The sort keys the list accepts, each mapped to a column of the merged rows. */
const SORT_COLUMNS = {
  used: Prisma.sql`"used"`,
  limit: Prisma.sql`"limit"`,
  userId: Prisma.sql`"userId"`,
} satisfies Record<NonNullable<ChatbotQuotaListQuery['sort']>, Prisma.Sql>;

/** Queries the usage and turn rows: the pool itself, or a transaction. */
type SqlClient = Pick<Prisma.TransactionClient, '$queryRaw' | '$executeRaw' | 'chatbotUsage'>;

/** Short statements only; a wait longer than this means something is stuck. */
const TURN_TX = { maxWait: 5_000, timeout: 15_000 };

/**
 * Takes the hold off a turn: locks the row, zeroes `reservedTokens` and
 * returns what it was. `null` when there was none, so of any callers racing
 * for one hold exactly one gets it.
 */
async function takeHold(
  db: SqlClient,
  triggerMessageId: string,
): Promise<{ reserved: number; period: string } | null> {
  const rows = await db.$queryRaw<{ reserved: number; period: string | null }[]>`
    WITH held AS (
      SELECT "id", "reservedTokens", "period" FROM "ChatbotTurn"
      WHERE "triggerMessageId" = ${triggerMessageId} AND "reservedTokens" > 0
      FOR UPDATE
    )
    UPDATE "ChatbotTurn" t
    SET "reservedTokens" = 0, "updatedAt" = now()
    FROM held
    WHERE t."id" = held."id"
    RETURNING held."reservedTokens" AS "reserved", held."period" AS "period"`;
  const row = rows[0];
  // The table CHECK ties a hold to its period, so a missing one is not expected.
  return row === undefined || row.period === null
    ? null
    : { reserved: row.reserved, period: row.period };
}

const DIGITS = /^[0-9]+$/;

function parseSnowflake(value: string): string {
  const parsed = SnowflakeSchema.safeParse(value);
  if (!parsed.success) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
  return parsed.data;
}

/** A token count the `Int` columns and their CHECKs can hold; anything else counts as zero. */
function clampTokens(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(CHATBOT_LIMIT_MAX, Math.max(0, Math.trunc(value)));
}

function toQuota(columns: QuotaColumns): Quota {
  const limit = clampTokens(columns.limit);
  const bonus = clampTokens(columns.bonus);
  const used = clampTokens(columns.used);
  const total = limit + bonus;
  return {
    limit,
    bonus,
    used,
    total,
    remaining: Math.max(0, total - used),
    overridden: columns.overridden,
  };
}

/**
 * The limit in force for one member as a CTE named `lim`: their own, else the
 * server default, else the built-in one. `guildKey` is an SQL expression.
 */
function limitCte(guildKey: Prisma.Sql, user: string): Prisma.Sql {
  return Prisma.sql`lim AS (
    SELECT COALESCE(
             (SELECT "monthlyLimit" FROM "ChatbotUserQuota" WHERE "guildId" = ${guildKey} AND "userId" = ${user}),
             (SELECT "defaultMonthlyLimit" FROM "ChatbotConfig" WHERE "guildId" = ${guildKey}),
             ${CHATBOT_DEFAULT_MONTHLY_LIMIT}::int
           ) AS "limit",
           EXISTS (SELECT 1 FROM "ChatbotUserQuota" WHERE "guildId" = ${guildKey} AND "userId" = ${user}) AS "overridden"
  )`;
}

/**
 * Each member's monthly token allowance: reserve before the model is called,
 * settle with what the provider reports, refund when the call fails. The
 * counters change in single SQL statements so concurrent replies of one member
 * cannot both spend the same tokens.
 */
@Injectable()
export class ChatbotQuotaService {
  private readonly logger = new Logger(ChatbotQuotaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly guilds: GuildConfigService,
  ) {}

  /** The member's month; a server or member with no rows yet gets the defaults. */
  async limitOf(
    guildId: string,
    userId: string,
    period: string = periodOf(new Date()),
  ): Promise<Quota> {
    const guild = parseSnowflake(guildId);
    const user = parseSnowflake(userId);
    const rows = await this.prisma.$queryRaw<QuotaColumns[]>`
      SELECT COALESCE(q."monthlyLimit", c."defaultMonthlyLimit", ${CHATBOT_DEFAULT_MONTHLY_LIMIT}::int) AS "limit",
             (q."monthlyLimit" IS NOT NULL) AS "overridden",
             COALESCE(u."bonus", 0) AS "bonus",
             COALESCE(u."used", 0) AS "used"
      FROM "Guild" g
      LEFT JOIN "ChatbotConfig" c ON c."guildId" = g."id"
      LEFT JOIN "ChatbotUserQuota" q ON q."guildId" = g."id" AND q."userId" = ${user}
      LEFT JOIN "ChatbotUsage" u ON u."guildId" = g."id" AND u."userId" = ${user} AND u."period" = ${period}
      WHERE g."discordId" = ${guild}`;
    return toQuota(
      rows[0] ?? {
        limit: CHATBOT_DEFAULT_MONTHLY_LIMIT,
        bonus: 0,
        used: 0,
        overridden: false,
      },
    );
  }

  /**
   * Sets aside up to `estimate` tokens of the member's remaining allowance.
   * What is left is reserved when less than the estimate remains, so a call
   * may overshoot by at most its own size. With nothing left the answer is
   * `exhausted`, with the month as it stands, and the model must not be called.
   */
  async reserve(
    guildId: string,
    userId: string,
    estimate: number,
    now: Date = new Date(),
  ): Promise<{ reserved: number; period: string } | { exhausted: true; quota: Quota }> {
    const guild = parseSnowflake(guildId);
    const user = parseSnowflake(userId);
    const outcome = await this.reserveWith(
      this.prisma,
      await this.guildKey(guild),
      user,
      estimate,
      now,
    );
    if ('reserved' in outcome) return outcome;
    return { exhausted: true, quota: await this.limitOf(guild, user, outcome.period) };
  }

  /**
   * Like `reserve`, and in the same transaction writes the hold on the pending
   * turn of `triggerMessageId`, so a crash cannot leave tokens held that no
   * row knows about. `durable` is false when there is no pending turn to
   * record it on; the caller then settles or refunds with the plain methods.
   * The turn row is locked before the usage row, the order every method that
   * touches both uses, so none of them can deadlock another.
   */
  async reserveForTurn(
    guildId: string,
    userId: string,
    estimate: number,
    triggerMessageId: string,
    now: Date = new Date(),
  ): Promise<
    { reserved: number; period: string; durable: boolean } | { exhausted: true; quota: Quota }
  > {
    const guild = parseSnowflake(guildId);
    const user = parseSnowflake(userId);
    const trigger = parseSnowflake(triggerMessageId);
    // Resolved first: it may create the server row, which must not be inside the
    // transaction, and a second pool connection taken while the transaction holds
    // one can starve the pool under load.
    const key = await this.guildKey(guild);
    const outcome = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "ChatbotTurn"
        WHERE "triggerMessageId" = ${trigger} AND "status" = 'PENDING' FOR UPDATE`;
      const reserved = await this.reserveWith(tx, key, user, estimate, now);
      if (!('reserved' in reserved) || locked.length === 0) return { ...reserved, durable: false };
      await tx.$executeRaw`
        UPDATE "ChatbotTurn"
        SET "reservedTokens" = ${reserved.reserved}::int, "period" = ${reserved.period}, "updatedAt" = now()
        WHERE "triggerMessageId" = ${trigger} AND "status" = 'PENDING'`;
      return { ...reserved, durable: true };
    }, TURN_TX);
    if ('reserved' in outcome) return outcome;
    return { exhausted: true, quota: await this.limitOf(guild, user, outcome.period) };
  }

  /**
   * Replaces the reservation with what the call really cost and returns the
   * month as the same statement left it, which is what the footer shows. The
   * period is the one the reservation was made in, so a call that runs across
   * midnight still lands in the month it started in.
   */
  async settle(
    guildId: string,
    userId: string,
    period: string,
    reserved: number,
    actual: number,
  ): Promise<Quota> {
    return this.settleWith(
      this.prisma,
      parseSnowflake(guildId),
      parseSnowflake(userId),
      period,
      reserved,
      actual,
    );
  }

  /**
   * Settles the hold written on the turn: takes it off the row and applies the
   * settlement in one transaction, so the member is never charged without a
   * record and a hold is settled by one caller only. `null` when the hold was
   * already taken (a restart gave it back), in which case nothing is charged.
   */
  async settleTurn(
    guildId: string,
    userId: string,
    triggerMessageId: string,
    actual: number,
  ): Promise<Quota | null> {
    const guild = parseSnowflake(guildId);
    const user = parseSnowflake(userId);
    const trigger = parseSnowflake(triggerMessageId);
    return this.prisma.$transaction(async (tx) => {
      const held = await takeHold(tx, trigger);
      if (held === null) return null;
      return this.settleWith(tx, guild, user, held.period, held.reserved, actual);
    }, TURN_TX);
  }

  /**
   * Gives back the hold written on the turn, taking it off the row in the same
   * transaction; two callers racing cannot both refund. Returns the tokens
   * given back, 0 when there was no hold. A failure leaves the hold on the row.
   */
  async refundTurn(guildId: string, userId: string, triggerMessageId: string): Promise<number> {
    const guild = parseSnowflake(guildId);
    const user = parseSnowflake(userId);
    const trigger = parseSnowflake(triggerMessageId);
    return this.prisma.$transaction(async (tx) => {
      const held = await takeHold(tx, trigger);
      if (held === null) return 0;
      await this.refundWith(tx, guild, user, held.period, held.reserved);
      return held.reserved;
    }, TURN_TX);
  }

  /** Gives a reservation back after a failed call. The caller makes sure it does so once. */
  async refund(guildId: string, userId: string, period: string, reserved: number): Promise<void> {
    await this.refundWith(
      this.prisma,
      parseSnowflake(guildId),
      parseSnowflake(userId),
      period,
      reserved,
    );
  }

  /** `guild` and `user` are validated snowflakes. */
  /** `key` is the server row id, resolved by the caller outside any transaction. */
  private async reserveWith(
    db: SqlClient,
    key: string,
    user: string,
    estimate: number,
    now: Date,
  ): Promise<{ reserved: number; period: string } | { period: string }> {
    const period = periodOf(now);
    const wanted = Math.max(1, clampTokens(estimate));

    await db.chatbotUsage.createMany({
      data: [{ guildId: key, userId: user, period }],
      skipDuplicates: true,
    });
    // `cur ... FOR UPDATE` makes a concurrent reserve of the same member wait
    // and then read the row as the winner left it; the limit is read in the
    // same statement. `used` stays within its CHECK even when limit and bonus
    // together exceed it.
    const rows = await db.$queryRaw<{ reserved: number }[]>`
      WITH ${limitCte(Prisma.sql`${key}::uuid`, user)},
      cur AS (
        SELECT "id", "used" FROM "ChatbotUsage"
        WHERE "guildId" = ${key}::uuid AND "userId" = ${user} AND "period" = ${period}
        FOR UPDATE
      )
      UPDATE "ChatbotUsage" u
      SET "used" = LEAST(
            u."used"::bigint + LEAST(${wanted}::bigint, lim."limit"::bigint + u."bonus" - u."used"),
            ${CHATBOT_LIMIT_MAX}::bigint
          ),
          "updatedAt" = now()
      FROM cur, lim
      WHERE u."id" = cur."id" AND u."used" < lim."limit"::bigint + u."bonus"
      RETURNING (u."used" - cur."used") AS "reserved"`;
    const reserved = rows[0]?.reserved ?? 0;
    return reserved > 0 ? { reserved, period } : { period };
  }

  private async settleWith(
    db: SqlClient,
    guild: string,
    user: string,
    period: string,
    reserved: number,
    actual: number,
  ): Promise<Quota> {
    // `used` is capped by its CHECK; a violation would lose the whole spend record.
    const rows = await db.$queryRaw<QuotaColumns[]>`
      WITH ${limitCte(Prisma.sql`(SELECT "id" FROM "Guild" WHERE "discordId" = ${guild})`, user)}
      UPDATE "ChatbotUsage" u
      SET "used" = LEAST(
            GREATEST(0, u."used"::bigint - ${clampTokens(reserved)}::bigint + ${clampTokens(actual)}::bigint),
            ${CHATBOT_LIMIT_MAX}::bigint
          ),
          "updatedAt" = now()
      FROM lim
      WHERE u."userId" = ${user} AND u."period" = ${period}
        AND u."guildId" = (SELECT "id" FROM "Guild" WHERE "discordId" = ${guild})
      RETURNING lim."limit", lim."overridden", u."bonus", u."used"`;
    const row = rows[0];
    if (row === undefined) {
      this.warnNoRow('settle', guild, user, period);
      return this.limitOf(guild, user, period);
    }
    return toQuota(row);
  }

  private async refundWith(
    db: SqlClient,
    guild: string,
    user: string,
    period: string,
    reserved: number,
  ): Promise<void> {
    const count = await db.$executeRaw`
      UPDATE "ChatbotUsage"
      SET "used" = GREATEST(0, "used" - ${clampTokens(reserved)}::int), "updatedAt" = now()
      WHERE "userId" = ${user} AND "period" = ${period}
        AND "guildId" = (SELECT "id" FROM "Guild" WHERE "discordId" = ${guild})`;
    if (count === 0) this.warnNoRow('refund', guild, user, period);
  }

  /**
   * Gives the member their own monthly limit, or `null` to fall back to the
   * server default. `dryRun` answers the month as it would become and writes
   * nothing.
   */
  async setLimit(
    guildId: string,
    userId: string,
    limit: number | null,
    actor: ActorContext,
    options: { dryRun?: boolean } = {},
  ): Promise<Quota> {
    const guild = parseSnowflake(guildId);
    const user = parseSnowflake(userId);
    const parsed = ChatbotQuotaSetRequestSchema.safeParse({ limit });
    if (!parsed.success) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
    if (options.dryRun === true) {
      const current = await this.limitOf(guild, user);
      const config = await this.prisma.chatbotConfig.findFirst({
        where: { guild: { discordId: guild } },
        select: { defaultMonthlyLimit: true },
      });
      return toQuota({
        limit: parsed.data.limit ?? config?.defaultMonthlyLimit ?? CHATBOT_DEFAULT_MONTHLY_LIMIT,
        bonus: current.bonus,
        used: current.used,
        overridden: parsed.data.limit !== null,
      });
    }

    await this.prisma.$transaction(async (tx) => {
      const row = await this.guilds.ensureGuild(guild, undefined, tx);
      if (parsed.data.limit === null) {
        await tx.chatbotUserQuota.deleteMany({ where: { guildId: row.id, userId: user } });
      } else {
        await tx.chatbotUserQuota.upsert({
          where: { guildId_userId: { guildId: row.id, userId: user } },
          create: { guildId: row.id, userId: user, monthlyLimit: parsed.data.limit },
          update: { monthlyLimit: parsed.data.limit },
        });
      }
      await this.audit.record(
        {
          guildId: guild,
          actor,
          action: AUDIT_ACTIONS.chatbotQuotaSet,
          params: { userId: user, limit: parsed.data.limit },
        },
        tx,
      );
    });
    return this.limitOf(guild, user);
  }

  /**
   * Adds `tokens` (negative takes back) to this month's bonus. The bonus never
   * drops below zero and never passes the column ceiling. `dryRun` answers the
   * month as it would become and writes nothing.
   */
  async grant(
    guildId: string,
    userId: string,
    tokens: number,
    actor: ActorContext,
    now: Date = new Date(),
    options: { dryRun?: boolean } = {},
  ): Promise<Quota> {
    const guild = parseSnowflake(guildId);
    const user = parseSnowflake(userId);
    const parsed = ChatbotQuotaGrantRequestSchema.safeParse({ tokens });
    if (!parsed.success) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
    const period = periodOf(now);
    if (options.dryRun === true) {
      const current = await this.limitOf(guild, user, period);
      return toQuota({
        ...current,
        bonus: Math.min(CHATBOT_LIMIT_MAX, Math.max(0, current.bonus + parsed.data.tokens)),
      });
    }

    await this.prisma.$transaction(async (tx) => {
      const row = await this.guilds.ensureGuild(guild, undefined, tx);
      await tx.$executeRaw`
        INSERT INTO "ChatbotUsage" ("guildId", "userId", "period", "used", "bonus", "updatedAt")
        VALUES (${row.id}::uuid, ${user}, ${period}, 0,
                LEAST(GREATEST(${parsed.data.tokens}::bigint, 0), ${CHATBOT_LIMIT_MAX}::bigint), now())
        ON CONFLICT ("guildId", "userId", "period") DO UPDATE
        SET "bonus" = LEAST(
              GREATEST("ChatbotUsage"."bonus"::bigint + ${parsed.data.tokens}::bigint, 0),
              ${CHATBOT_LIMIT_MAX}::bigint
            ),
            "updatedAt" = now()`;
      await this.audit.record(
        {
          guildId: guild,
          actor,
          action: AUDIT_ACTIONS.chatbotQuotaGrant,
          params: { userId: user, tokens: parsed.data.tokens, period },
        },
        tx,
      );
    });
    return this.limitOf(guild, user, period);
  }

  /**
   * Zeroes what the member spent this month; the bonus stays. `dryRun` only
   * reports what would be cleared. `used` in the result is the amount before.
   */
  async reset(
    guildId: string,
    userId: string,
    actor: ActorContext,
    options: { dryRun: boolean },
    now: Date = new Date(),
  ): Promise<{ dryRun: boolean; used: number }> {
    const guild = parseSnowflake(guildId);
    const user = parseSnowflake(userId);
    const period = periodOf(now);
    if (options.dryRun) {
      const current = await this.limitOf(guild, user, period);
      return { dryRun: true, used: current.used };
    }

    const used = await this.prisma.$transaction(async (tx) => {
      const row = await this.guilds.ensureGuild(guild, undefined, tx);
      const rows = await tx.$queryRaw<{ previous: number }[]>`
        WITH cur AS (
          SELECT "id", "used" FROM "ChatbotUsage"
          WHERE "guildId" = ${row.id}::uuid AND "userId" = ${user} AND "period" = ${period}
          FOR UPDATE
        )
        UPDATE "ChatbotUsage" u SET "used" = 0, "updatedAt" = now()
        FROM cur WHERE u."id" = cur."id"
        RETURNING cur."used" AS "previous"`;
      const previous = rows[0]?.previous ?? 0;
      await this.audit.record(
        {
          guildId: guild,
          actor,
          action: AUDIT_ACTIONS.chatbotQuotaReset,
          params: { userId: user, period, tokens: previous },
        },
        tx,
      );
      return previous;
    });
    return { dryRun: false, used };
  }

  /**
   * One page of this month's members: everyone with usage or with a limit of
   * their own. `q` matches the start of the member id. Names are not stored
   * here; the caller resolves them for the page's ids.
   */
  async list(
    guildId: string,
    query: ChatbotQuotaListQuery,
    now: Date = new Date(),
  ): Promise<QuotaPage> {
    const guild = parseSnowflake(guildId);
    // The month and the default are answered with the page so a caller shows
    // the ones the rows were counted with.
    const period = periodOf(now);
    const config = await this.prisma.chatbotConfig.findFirst({
      where: { guild: { discordId: guild } },
      select: { defaultMonthlyLimit: true },
    });
    const defaultLimit = clampTokens(config?.defaultMonthlyLimit ?? CHATBOT_DEFAULT_MONTHLY_LIMIT);
    const search = query.q;
    // Member ids are digits; any other search text can match nothing.
    if (search !== undefined && search !== '' && !DIGITS.test(search)) {
      return { items: [], total: 0, period, defaultLimit };
    }
    const filter =
      search === undefined || search === ''
        ? Prisma.empty
        : Prisma.sql`WHERE "userId" LIKE ${`${search}%`}`;
    const merged = Prisma.sql`
      WITH g AS (SELECT "id" FROM "Guild" WHERE "discordId" = ${guild}),
      merged AS (
        SELECT COALESCE(q."userId", u."userId") AS "userId",
               COALESCE(u."used", 0) AS "used",
               COALESCE(u."bonus", 0) AS "bonus",
               COALESCE(
                 q."monthlyLimit",
                 (SELECT c."defaultMonthlyLimit" FROM "ChatbotConfig" c WHERE c."guildId" = (SELECT "id" FROM g)),
                 ${CHATBOT_DEFAULT_MONTHLY_LIMIT}::int
               ) AS "limit",
               (q."monthlyLimit" IS NOT NULL) AS "overridden"
        FROM (
          SELECT "userId", "monthlyLimit" FROM "ChatbotUserQuota"
          WHERE "guildId" = (SELECT "id" FROM g)
        ) q
        FULL OUTER JOIN (
          SELECT "userId", "used", "bonus" FROM "ChatbotUsage"
          WHERE "guildId" = (SELECT "id" FROM g) AND "period" = ${period}
        ) u ON u."userId" = q."userId"
      )`;
    const direction = query.order === 'desc' ? Prisma.sql`DESC` : Prisma.sql`ASC`;
    const column = SORT_COLUMNS[query.sort ?? 'userId'];
    const offset = (query.page - 1) * query.pageSize;

    const [rows, counted] = await Promise.all([
      this.prisma.$queryRaw<(QuotaColumns & { userId: string })[]>`
        ${merged}
        SELECT "userId", "used", "bonus", "limit", "overridden" FROM merged ${filter}
        ORDER BY ${column} ${direction}, "userId" ASC
        LIMIT ${query.pageSize}::int OFFSET ${offset}::int`,
      this.prisma.$queryRaw<{ total: number }[]>`
        ${merged}
        SELECT COUNT(*)::int AS "total" FROM merged ${filter}`,
    ]);
    return {
      items: rows.map((row) => {
        const quota = toQuota(row);
        return {
          userId: row.userId,
          used: quota.used,
          limit: quota.limit,
          bonus: quota.bonus,
          overridden: quota.overridden,
          remaining: quota.remaining,
        };
      }),
      total: counted[0]?.total ?? 0,
      period,
      defaultLimit,
    };
  }

  /** The server's row key; a server the bot is in but never recorded gets its row here. */
  private async guildKey(discordId: string): Promise<string> {
    const guild = await this.prisma.guild.findUnique({
      where: { discordId },
      select: { id: true },
    });
    if (guild !== null) return guild.id;
    return (await this.guilds.ensureGuild(discordId)).id;
  }

  private warnNoRow(step: string, guild: string, user: string, period: string): void {
    this.logger.warn(
      `Chatbot quota ${step} found no usage row (guild ${guild}, user ${user}, period ${period})`,
    );
  }
}
