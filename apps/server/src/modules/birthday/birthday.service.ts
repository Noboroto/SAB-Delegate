import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  AUDIT_ACTIONS,
  BIRTHDAY_SAMPLE_SIZE,
  BirthdayAddSchema,
  BirthdaySelectorSchema,
  ErrorCode,
  SnowflakeSchema,
  renderBirthdayWish,
  z,
  type ActorContext,
  type BirthdayAdd,
  type BirthdayAddResult,
  type BirthdayEntryView,
  type BirthdayImportResult,
  type BirthdayRemoveResult,
} from '@sab/shared';
import { Client } from 'discord.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { ServiceError } from '../../common/errors/service-error.js';
import { DiscordReadyService } from '../../discord/discord-ready.service.js';
import { ErrorReporter } from '../../discord/error-reporter.service.js';
import { discordErrorCode } from '../../discord/helpers/reply.js';
import { errorLabel } from '../../prisma/pool-factory.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { GuildConfigService } from '../guild-config/guild-config.service.js';
import {
  BusinessDaySchema,
  birthdayDatesFor,
  dateColumnValue,
  previousDay,
  type BusinessDay,
} from './birthday.date.js';
import { pickUnusedWish } from './birthday.wish.js';

/** The configured birthday channel exists but is not a channel the bot can post in. */
class UnsendableChannelError extends Error {
  constructor() {
    super('The birthday channel cannot be written to');
    this.name = 'UnsendableChannelError';
  }
}

/**
 * How long a run owns its day. Every greeting that goes out extends it, so it
 * only has to outlast one send; a process that died leaves a lease that
 * lapses, and the next run takes the rest over.
 */
export const RUN_LEASE_MS = 5 * 60_000;

/** A failed run is picked up again after this long (its lease is released at once). */
const FAILURE_RETRY_MS = 5 * 60_000;

/** Unknown Guild: the bot is no longer in the server. */
const UNKNOWN_GUILD = 10004;

/**
 * The birthday channel was deleted (10003), or the bot lost the right to see
 * (50001) or write in (50013) it. Only an admin can fix that, so a retry the
 * same day cannot help: the server is skipped until the next run.
 */
const UNUSABLE_CHANNEL_CODES: ReadonlySet<number> = new Set([10003, 50001, 50013]);

const IMPORT_CHUNK = 2000;
const LOOKUP_CHUNK = 10_000;
const IMPORT_TIMEOUT_MS = 30_000;

const SYSTEM_ACTOR: ActorContext = { source: 'SYSTEM' };

const ENTRY_VIEW = {
  studentId: true,
  name: true,
  discordId: true,
  month: true,
  day: true,
} satisfies Prisma.BirthdayEntrySelect;

const ENTRY_ORDER = [
  { month: 'asc' },
  { day: 'asc' },
  { createdAt: 'asc' },
  { id: 'asc' },
] satisfies Prisma.BirthdayEntryOrderByWithRelationInput[];

type DestructiveOptions = { dryRun?: boolean };

type Db = Pick<Prisma.TransactionClient, 'birthdayEntry'>;

/** What one pass over a day did. `retryAt` is when unfinished work can be tried again. */
const RunSummarySchema = z.object({
  guilds: z.number().int().min(0),
  sent: z.number().int().min(0),
  failed: z.number().int().min(0),
  retryAt: z.date().nullable(),
});

export type BirthdayRunSummary = z.infer<typeof RunSummarySchema>;

/**
 * A lease this process holds. `leaseUntil` is the exact value it last wrote:
 * every write while sending is conditional on it, so once another run has
 * taken the day over (its write replaced the value) none of ours can land.
 */
type Run = { id: string; sent: Set<string>; leaseUntil: Date };

/** A server with someone to greet today, and where. */
type Target = {
  id: string;
  discordId: string;
  channelId: string | null;
  recipients: string[];
};

function parseGuildId(guildId: string): string {
  const parsed = SnowflakeSchema.safeParse(guildId);
  if (!parsed.success) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
  return parsed.data;
}

function earliest(a: Date | null, b: Date | null): Date | null {
  if (a === null) return b;
  if (b === null) return a;
  return a < b ? a : b;
}

function failureLabel(error: unknown): string {
  const code = discordErrorCode(error);
  return code === undefined ? errorLabel(error) : `${errorLabel(error)} ${code}`;
}

/**
 * The birthday list and the daily greeting. The slash commands, the REST API
 * and the MCP tools all call these methods; the daily job does too.
 *
 * A day's greetings for a server are one row of `BirthdayCompletedDate`, held
 * as a lease: the row is `SENDING` until every greeting has gone out, each
 * person is appended to `sentDiscordIds` right after their message, and only
 * then does it become `DONE`. A run that dies half way therefore leaves a row
 * the next run resumes from where it stopped. The worst case is one person
 * greeted twice, when the process dies between sending and recording.
 */
@Injectable()
export class BirthdayService {
  private readonly logger = new Logger(BirthdayService.name);
  /** Servers whose unusable channel was already reported, for the day in `reportedDay`. */
  private readonly reportedChannels = new Set<string>();
  private reportedDay = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly guilds: GuildConfigService,
    private readonly client: Client,
    private readonly reporter: ErrorReporter,
    private readonly ready: DiscordReadyService,
  ) {}

  /** Everyone on the list, ordered as the list prints; `month` narrows it to one month. */
  async list(guildId: string, filter: { month?: number } = {}): Promise<BirthdayEntryView[]> {
    const id = parseGuildId(guildId);
    const { month } = filter;
    if (month !== undefined && !(Number.isInteger(month) && month >= 1 && month <= 12)) {
      throw new ServiceError(ErrorCode.VALIDATION_FAILED);
    }
    return this.prisma.birthdayEntry.findMany({
      where: { guild: { discordId: id }, ...(month === undefined ? {} : { month }) },
      select: ENTRY_VIEW,
      orderBy: ENTRY_ORDER,
    });
  }

  /**
   * One page of the list, in the order the list prints, with the total the page
   * is cut from. Paging and the month filter run in the database.
   */
  async listPage(
    guildId: string,
    query: { month?: number; page: number; limit: number },
  ): Promise<{ items: BirthdayEntryView[]; total: number }> {
    const id = parseGuildId(guildId);
    const { month, page, limit } = query;
    if (month !== undefined && !(Number.isInteger(month) && month >= 1 && month <= 12)) {
      throw new ServiceError(ErrorCode.VALIDATION_FAILED);
    }
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1) {
      throw new ServiceError(ErrorCode.VALIDATION_FAILED);
    }
    const where = { guild: { discordId: id }, ...(month === undefined ? {} : { month }) };
    const [items, total] = await Promise.all([
      this.prisma.birthdayEntry.findMany({
        where,
        select: ENTRY_VIEW,
        orderBy: ENTRY_ORDER,
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.birthdayEntry.count({ where }),
    ]);
    return { items, total };
  }

  /**
   * Adds one person. A student ID the server already has is left alone:
   * `DUPLICATE_ID`. With `dryRun` it reports which of the two would happen and
   * writes nothing, not even an audit row.
   */
  async add(
    guildId: string,
    entry: unknown,
    actor: ActorContext,
    opts: { dryRun?: boolean } = {},
  ): Promise<BirthdayAddResult> {
    const id = parseGuildId(guildId);
    const parsed = BirthdayAddSchema.safeParse(entry);
    if (!parsed.success) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
    const person = parsed.data;

    if (opts.dryRun === true) {
      const taken = await this.prisma.birthdayEntry.count({
        where: { guild: { discordId: id }, studentId: person.studentId },
      });
      return { code: taken > 0 ? 'DUPLICATE_ID' : 'ADDED' };
    }

    return this.prisma.$transaction(async (tx) => {
      const guild = await this.guilds.ensureGuild(id, undefined, tx);
      const created = await tx.birthdayEntry.createMany({
        data: [{ guildId: guild.id, ...person }],
        skipDuplicates: true,
      });
      if (created.count === 0) return { code: 'DUPLICATE_ID' };
      await this.audit.record(
        {
          guildId: id,
          actor,
          action: AUDIT_ACTIONS.birthdayAdd,
          params: { userId: person.discordId, month: person.month, day: person.day },
        },
        tx,
      );
      return { code: 'ADDED' };
    });
  }

  /**
   * Removes by student ID, or by Discord user when no student ID is given
   * (a user can hold several rows; all of them go). With `dryRun` it reports
   * what a real run would remove and changes nothing, not even the audit trail.
   */
  async remove(
    guildId: string,
    selector: unknown,
    actor: ActorContext,
    opts: DestructiveOptions = {},
  ): Promise<BirthdayRemoveResult> {
    const id = parseGuildId(guildId);
    const parsed = BirthdaySelectorSchema.safeParse(selector);
    if (!parsed.success) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
    const { studentId, discordId } = parsed.data;
    const dryRun = opts.dryRun === true;

    if (studentId === undefined && discordId === undefined) {
      return { dryRun, code: 'NO_SELECTOR', count: 0, sample: [] };
    }
    const where: Prisma.BirthdayEntryWhereInput =
      studentId !== undefined
        ? { guild: { discordId: id }, studentId }
        : { guild: { discordId: id }, discordId };
    const code = studentId !== undefined ? 'REMOVED_BY_STUDENT' : 'REMOVED_BY_USER';

    if (dryRun) {
      const plan = await this.planRemoval(this.prisma, where);
      return { dryRun, code: plan.count === 0 ? 'NOT_FOUND' : code, ...plan };
    }

    return this.prisma.$transaction(async (tx) => {
      const plan = await this.planRemoval(tx, where);
      if (plan.count === 0) return { dryRun, code: 'NOT_FOUND', ...plan };
      const removed = await tx.birthdayEntry.deleteMany({ where });
      await this.audit.record(
        {
          guildId: id,
          actor,
          action: AUDIT_ACTIONS.birthdayRemove,
          params:
            studentId !== undefined
              ? { count: removed.count, targetId: studentId }
              : { count: removed.count, userId: discordId },
        },
        tx,
      );
      return { dryRun, code, count: removed.count, sample: plan.sample };
    });
  }

  /**
   * Merges rows into the list: a student ID that is already there (or repeats
   * inside `rows`) is skipped and named in `duplicates`; nothing is ever
   * overwritten. With `dryRun` it reports what would be added and writes nothing.
   */
  async importRows(
    guildId: string,
    rows: unknown,
    actor: ActorContext,
    opts: DestructiveOptions = {},
  ): Promise<BirthdayImportResult> {
    const id = parseGuildId(guildId);
    const parsed = z.array(BirthdayAddSchema).safeParse(rows);
    if (!parsed.success) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
    const entries = parsed.data;
    if (entries.length === 0) {
      return { dryRun: opts.dryRun === true, total: 0, added: 0, duplicates: [], sample: [] };
    }

    if (opts.dryRun === true) {
      const plan = await this.planImport(this.prisma, id, entries);
      return {
        dryRun: true,
        total: entries.length,
        added: plan.toAdd.length,
        duplicates: plan.duplicates,
        sample: plan.toAdd.slice(0, BIRTHDAY_SAMPLE_SIZE).map((entry) => entry.studentId),
      };
    }

    return this.prisma.$transaction(
      async (tx) => {
        const guild = await this.guilds.ensureGuild(id, undefined, tx);
        const plan = await this.planImport(tx, id, entries);
        let added = 0;
        for (let from = 0; from < plan.toAdd.length; from += IMPORT_CHUNK) {
          const chunk = plan.toAdd.slice(from, from + IMPORT_CHUNK);
          // A concurrent import may add the same ID between the plan and here;
          // the unique key decides and the count below is what really went in.
          const created = await tx.birthdayEntry.createMany({
            data: chunk.map((entry) => ({ guildId: guild.id, ...entry })),
            skipDuplicates: true,
          });
          added += created.count;
        }
        if (added > 0) {
          await this.audit.record(
            {
              guildId: id,
              actor,
              action: AUDIT_ACTIONS.birthdayImport,
              params: { count: added, total: entries.length, skipped: entries.length - added },
            },
            tx,
          );
        }
        return {
          dryRun: false,
          total: entries.length,
          added,
          duplicates: plan.duplicates,
          sample: plan.toAdd.slice(0, BIRTHDAY_SAMPLE_SIZE).map((entry) => entry.studentId),
        };
      },
      { timeout: IMPORT_TIMEOUT_MS },
    );
  }

  /**
   * A wish this server has not used in the current cycle, as an index into
   * `BIRTHDAY_WISHES`; the cycle restarts when all of them are used.
   */
  async pickWish(guildId: string): Promise<number> {
    const guild = await this.prisma.guild.findUnique({
      where: { discordId: parseGuildId(guildId) },
      select: { id: true },
    });
    if (guild === null) throw new ServiceError(ErrorCode.GUILD_NOT_FOUND);
    return this.pickWishFor(guild.id);
  }

  /**
   * Greets everyone whose birthday is `day` (29 February people on 28 February
   * in a year without a 29th), once per server and day however often this is
   * called and from however many places at once: the day's lease decides.
   * A server that fails is reported and does not stop the others.
   */
  async runDailyWishes(day: BusinessDay): Promise<BirthdayRunSummary> {
    return this.runDay(BusinessDaySchema.parse(day), false);
  }

  /**
   * Finishes the previous day's runs that were left unfinished (a run that
   * crossed midnight, or died near it). It never starts a day that was not
   * started: those people missed their day.
   */
  async recoverStaleRuns(today: BusinessDay): Promise<BirthdayRunSummary> {
    return this.runDay(previousDay(BusinessDaySchema.parse(today)), true);
  }

  private async runDay(day: BusinessDay, resumeOnly: boolean): Promise<BirthdayRunSummary> {
    const targets = await this.targetsFor(day, resumeOnly);
    let sent = 0;
    let failed = 0;
    let retryAt: Date | null = null;

    for (const target of targets) {
      // A long list of servers can still be running when shutdown begins; the
      // database pool is about to close.
      if (this.ready.isStopping()) break;
      const progress = { sent: 0 };
      try {
        retryAt = earliest(retryAt, await this.wishGuild(target, day, resumeOnly, progress));
      } catch (error) {
        failed += 1;
        retryAt = earliest(retryAt, new Date(Date.now() + FAILURE_RETRY_MS));
        await this.reportFailure(target, error);
      }
      sent += progress.sent;
    }
    return RunSummarySchema.parse({ guilds: targets.length, sent, failed, retryAt });
  }

  private async targetsFor(day: BusinessDay, resumeOnly: boolean): Promise<Target[]> {
    const date = dateColumnValue(day);
    const unfinished = resumeOnly
      ? await this.prisma.birthdayCompletedDate.findMany({
          where: { date, status: 'SENDING' },
          select: { guildId: true },
        })
      : undefined;
    if (unfinished?.length === 0) return [];

    const entries = await this.prisma.birthdayEntry.findMany({
      where: {
        OR: birthdayDatesFor(day).map(({ month, day: dayOfMonth }) => ({
          month,
          day: dayOfMonth,
        })),
        ...(unfinished === undefined
          ? {}
          : { guildId: { in: unfinished.map((run) => run.guildId) } }),
      },
      select: {
        discordId: true,
        guild: {
          select: {
            id: true,
            discordId: true,
            config: { select: { birthdayChannelId: true } },
          },
        },
      },
      orderBy: [{ guildId: 'asc' }, ...ENTRY_ORDER],
    });

    const targets = new Map<string, Target>();
    for (const entry of entries) {
      let target = targets.get(entry.guild.id);
      if (target === undefined) {
        target = {
          id: entry.guild.id,
          discordId: entry.guild.discordId,
          channelId: entry.guild.config?.birthdayChannelId ?? null,
          recipients: [],
        };
        targets.set(entry.guild.id, target);
      }
      // One greeting per person a day, even when the list holds them twice.
      if (!target.recipients.includes(entry.discordId)) target.recipients.push(entry.discordId);
    }
    return [...targets.values()];
  }

  /**
   * One server's greetings for `day`. Returns when unfinished work can be tried
   * again (a lease somebody else holds), or null. Throws on failure after
   * releasing the lease, so a retry can carry on at once.
   *
   * A birthday channel that is gone, or that the bot may no longer see or write
   * in, is not retried: the server is skipped for the day with one warning.
   */
  private async wishGuild(
    target: Target,
    day: BusinessDay,
    resumeOnly: boolean,
    progress: { sent: number },
  ): Promise<Date | null> {
    if (target.channelId === null) {
      this.logger.log(`No birthday channel set for guild ${target.discordId}`);
      return null;
    }
    if (!(await this.botIsIn(target.discordId))) return null;

    let channel;
    try {
      channel = await this.client.channels.fetch(target.channelId);
    } catch (error) {
      if (await this.skipUnusableChannel(target, day, error)) return null;
      throw error;
    }
    if (channel === null || !channel.isSendable()) {
      // A deleted or non-text channel is a configuration problem like a
      // missing permission: retrying cannot fix it, so skip the day once.
      await this.skipUnusableChannel(target, day, new UnsendableChannelError());
      return null;
    }

    const run = await this.acquireRun(target.id, day, resumeOnly);
    if (!run.acquired) return run.liveUntil;

    try {
      const pending = target.recipients.filter((discordId) => !run.sent.has(discordId));
      for (const discordId of pending) {
        if (this.ready.isStopping()) {
          await this.releaseLease(run);
          return null;
        }
        // Asked before the send, not only after: a run that lost the day while
        // it was stalled must not greet people the new holder is greeting.
        if (!(await this.holdLease(run))) return this.lostLease(target);
        const wishIndex = await this.pickWishFor(target.id);
        await channel.send({
          content: renderBirthdayWish(wishIndex, `<@${discordId}>`),
          allowedMentions: { users: [discordId] },
        });
        progress.sent += 1;
        if (!(await this.holdLease(run, discordId))) return this.lostLease(target);
      }
      await this.complete(run, target, progress.sent);
      return null;
    } catch (error) {
      await this.releaseLease(run);
      if (await this.skipUnusableChannel(target, day, error)) return null;
      throw error;
    }
  }

  private lostLease(target: Target): null {
    this.logger.warn(`Lost the birthday lease of guild ${target.discordId}; stopping`);
    return null;
  }

  /**
   * Logs the skip and reports it, at most once per server and day however many
   * times the day is run (the daily job, its retries and the start-up pass).
   * False when `error` is something else, which the caller treats as a failure.
   */
  private async skipUnusableChannel(
    target: Target,
    day: BusinessDay,
    error: unknown,
  ): Promise<boolean> {
    const code = discordErrorCode(error);
    const unusable =
      error instanceof UnsendableChannelError ||
      (code !== undefined && UNUSABLE_CHANNEL_CODES.has(code));
    if (!unusable) return false;

    this.logger.warn(
      `Skipping birthdays of guild ${target.discordId}: the birthday channel is unusable (${failureLabel(error)})`,
    );
    const dayKey = dateColumnValue(day).getTime();
    if (dayKey !== this.reportedDay) {
      this.reportedChannels.clear();
      this.reportedDay = dayKey;
    }
    if (this.reportedChannels.has(target.discordId)) return true;
    this.reportedChannels.add(target.discordId);
    await this.reporter.report(
      `Birthday channel of guild ${target.discordId} is unusable; its wishes are skipped today`,
      error,
    );
    return true;
  }

  /** True while the bot is in the server; a server it was removed from is skipped with a warning. */
  private async botIsIn(guildId: string): Promise<boolean> {
    try {
      await this.client.guilds.fetch(guildId);
      return true;
    } catch (error) {
      if (discordErrorCode(error) !== UNKNOWN_GUILD) throw error;
      this.logger.warn(`Skipping birthdays of guild ${guildId}: the bot is no longer in it`);
      return false;
    }
  }

  /**
   * Takes the day's lease: a fresh row (`INSERT .. ON CONFLICT DO NOTHING`), or
   * a `SENDING` row whose lease has lapsed. A `DONE` row, or one whose lease is
   * still live, is somebody else's; the second case says when to look again.
   */
  private async acquireRun(
    guildId: string,
    day: BusinessDay,
    resumeOnly: boolean,
  ): Promise<({ acquired: true } & Run) | { acquired: false; liveUntil: Date | null }> {
    const date = dateColumnValue(day);
    const now = new Date();
    const leaseUntil = new Date(now.getTime() + RUN_LEASE_MS);

    let won = false;
    if (!resumeOnly) {
      const created = await this.prisma.birthdayCompletedDate.createMany({
        data: [{ guildId, date, status: 'SENDING', leaseUntil }],
        skipDuplicates: true,
      });
      won = created.count === 1;
    }
    if (!won) {
      const reclaimed = await this.prisma.birthdayCompletedDate.updateMany({
        where: { guildId, date, status: 'SENDING', leaseUntil: { lt: now } },
        data: { leaseUntil },
      });
      won = reclaimed.count === 1;
    }

    const row = await this.prisma.birthdayCompletedDate.findUnique({
      where: { guildId_date: { guildId, date } },
      select: { id: true, status: true, leaseUntil: true, sentDiscordIds: true },
    });
    // The value this run wrote, not the one just read: if somebody took the day
    // over in between, the first conditional write of this run must fail.
    if (won && row !== null) {
      return { acquired: true, id: row.id, sent: new Set(row.sentDiscordIds), leaseUntil };
    }

    const live = row?.status === 'SENDING' && row.leaseUntil !== null && row.leaseUntil > now;
    return { acquired: false, liveUntil: live ? row.leaseUntil : null };
  }

  /**
   * Extends the lease and, with `greeted`, notes that person as greeted. The
   * write applies only while the stored lease is still exactly the one this run
   * last wrote, so it is false once the run was taken over (or finished) and
   * the caller must stop. An expired lease nobody has claimed is still ours.
   */
  private async holdLease(run: Run, greeted?: string): Promise<boolean> {
    const next = new Date(Date.now() + RUN_LEASE_MS);
    const updated = await this.prisma.birthdayCompletedDate.updateMany({
      where: { id: run.id, status: 'SENDING', leaseUntil: run.leaseUntil },
      data: {
        leaseUntil: next,
        ...(greeted === undefined ? {} : { sentDiscordIds: { push: greeted } }),
      },
    });
    if (updated.count !== 1) return false;
    run.leaseUntil = next;
    return true;
  }

  private async complete(run: Run, target: Target, sent: number): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const done = await tx.birthdayCompletedDate.updateMany({
        where: { id: run.id, status: 'SENDING', leaseUntil: run.leaseUntil },
        data: { status: 'DONE', leaseUntil: null, doneAt: new Date() },
      });
      if (done.count !== 1) {
        this.lostLease(target);
        return;
      }
      await this.audit.record(
        {
          guildId: target.discordId,
          actor: SYSTEM_ACTOR,
          action: AUDIT_ACTIONS.birthdayWish,
          params: { count: sent, total: target.recipients.length },
        },
        tx,
      );
    });
  }

  /**
   * Makes the run reclaimable right away; the progress stays. Best effort: the
   * lease lapses anyway. Conditional like every other write, so it cannot
   * shorten the lease of the run that took the day over.
   */
  private async releaseLease(run: Run): Promise<void> {
    try {
      await this.prisma.birthdayCompletedDate.updateMany({
        where: { id: run.id, status: 'SENDING', leaseUntil: run.leaseUntil },
        data: { leaseUntil: new Date(Date.now() - 1) },
      });
    } catch (error) {
      this.logger.warn(`Could not release a birthday lease (${errorLabel(error)})`);
    }
  }

  private pickWishFor(guildId: string): Promise<number> {
    return this.prisma.$transaction((tx) => pickUnusedWish(tx, guildId));
  }

  private async reportFailure(target: Target, error: unknown): Promise<void> {
    const label = failureLabel(error);
    this.logger.error(`Birthday wishes failed for guild ${target.discordId} (${label})`);
    try {
      await this.audit.record({
        guildId: target.discordId,
        actor: SYSTEM_ACTOR,
        action: AUDIT_ACTIONS.birthdayWish,
        ok: false,
        error: label,
      });
    } catch (auditError) {
      this.logger.warn(`Could not audit the birthday failure (${errorLabel(auditError)})`);
    }
    await this.reporter.report(`Birthday wishes failed for guild ${target.discordId}`, error);
  }

  private async planRemoval(
    db: Db,
    where: Prisma.BirthdayEntryWhereInput,
  ): Promise<{ count: number; sample: BirthdayEntryView[] }> {
    const [count, sample] = await Promise.all([
      db.birthdayEntry.count({ where }),
      db.birthdayEntry.findMany({
        where,
        select: ENTRY_VIEW,
        orderBy: ENTRY_ORDER,
        take: BIRTHDAY_SAMPLE_SIZE,
      }),
    ]);
    return { count, sample };
  }

  private async planImport(
    db: Db,
    guildId: string,
    rows: readonly BirthdayAdd[],
  ): Promise<{ toAdd: BirthdayAdd[]; duplicates: string[] }> {
    const wanted = [...new Set(rows.map((row) => row.studentId))];
    const existing = new Set<string>();
    for (let from = 0; from < wanted.length; from += LOOKUP_CHUNK) {
      const found = await db.birthdayEntry.findMany({
        where: {
          guild: { discordId: guildId },
          studentId: { in: wanted.slice(from, from + LOOKUP_CHUNK) },
        },
        select: { studentId: true },
      });
      for (const { studentId } of found) existing.add(studentId);
    }

    const seen = new Set<string>();
    const toAdd: BirthdayAdd[] = [];
    const duplicates: string[] = [];
    for (const row of rows) {
      if (existing.has(row.studentId) || seen.has(row.studentId)) {
        duplicates.push(row.studentId);
      } else {
        seen.add(row.studentId);
        toAdd.push(row);
      }
    }
    return { toAdd, duplicates };
  }
}
