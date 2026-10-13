import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  ALLOWED_MENTIONS_ALL,
  ALLOWED_MENTIONS_NONE,
  AUDIT_ACTIONS,
  ErrorCode,
  QUEUES,
  SCHEDULE_AUTOCOMPLETE_MAX,
  SCHEDULE_MAX_HORIZON_DAYS,
  SCHEDULE_PENDING_MAX,
  ScheduleCancelResultSchema,
  ScheduleCopyInputSchema,
  ScheduleListQuerySchema,
  ScheduleSendInputSchema,
  ScheduledMessageViewSchema,
  SnowflakeSchema,
  z,
  type ActorContext,
  type AllowedMentions,
  type ScheduleCancelByKeyResult,
  type ScheduleCancelResult,
  type ScheduleCreateResult,
  type ScheduleFailure,
  type SchedulePendingChoice,
  type ScheduledMessageView,
} from '@sab/shared';
import { Client } from 'discord.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { ServiceError } from '../../common/errors/service-error.js';
import { DiscordReadyService } from '../../discord/discord-ready.service.js';
import { isHiddenChannelError } from '../../discord/helpers/channel-visibility.js';
import {
  buildMessageCopy,
  copyErrorCode,
  copyProblem,
  uploadLimitForChannel,
} from '../../discord/helpers/message-copy.js';
import { ChannelAccessService } from '../../discord/services/channel-access.service.js';
import { MessageResolver } from '../../discord/services/message-resolver.service.js';
import { PgBossService } from '../../jobs/pg-boss.service.js';
import { errorLabel } from '../../prisma/pool-factory.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { GuildConfigService } from '../guild-config/guild-config.service.js';
import {
  SCHEDULE_RETRY_DELAY_S,
  SCHEDULE_MAX_ATTEMPTS,
  ScheduleDelivery,
  guildIdOf,
} from './schedule.delivery.js';

/**
 * A pending message is only "overdue" this long after its time, so a job that
 * pg-boss is about to deliver is not also sent by the reconcile pass.
 */
const SCHEDULE_OVERDUE_GRACE_MS = 30_000;

const RECONCILE_BATCH = 200;
const RECONCILE_MAX_BATCHES = 10;
const SEQ_RETRIES = 12;
const INT_MAX = 2_147_483_647;
const DAY_MS = 86_400_000;
const PREVIEW_LENGTH = 40;

type DestructiveOptions = { dryRun?: boolean };

const VIEW_SELECT = {
  id: true,
  seq: true,
  kind: true,
  channelId: true,
  content: true,
  sourceChannelId: true,
  sourceMessageId: true,
  allowedMentions: true,
  runAt: true,
  status: true,
  attempts: true,
  source: true,
  createdByUserId: true,
  lastError: true,
  createdAt: true,
} satisfies Prisma.ScheduledMessageSelect;

export const ScheduleJobDataSchema = z.object({ scheduleId: z.uuid() });

type ScheduleJobData = z.infer<typeof ScheduleJobDataSchema>;

/** The checked parts of a request to schedule, whichever way it was typed. */
type Plan = {
  kind: 'SEND' | 'COPY';
  channelId: string;
  runAt: Date;
  /** Text to send; null for a copy, whose text is read from the source when it is sent. */
  content: string | null;
  source: { channelId: string; messageId: string } | null;
  allowedMentions: AllowedMentions;
  /** What the person is shown: the text now, and how many files go with it. */
  preview: { content: string | null; attachmentCount: number };
};

function parseGuildId(guildId: string): string {
  const parsed = SnowflakeSchema.safeParse(guildId);
  if (!parsed.success) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
  return parsed.data;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

/**
 * `seq` values that begin with the digits typed, as ranges the database can
 * use: 12 matches 12, 120-129, 1200-1299 and so on.
 */
function seqPrefixFilter(typed: string): Prisma.ScheduledMessageWhereInput | undefined {
  if (typed === '') return undefined;
  // Leading zeros or other text match nothing; seq starts at 1.
  if (!/^[1-9]\d{0,9}$/.test(typed)) return { seq: { lt: 1 } };
  const prefix = Number(typed);
  const ranges: Prisma.ScheduledMessageWhereInput[] = [];
  for (let digits = 0; typed.length + digits <= 10; digits += 1) {
    const scale = 10 ** digits;
    const low = prefix * scale;
    if (low > INT_MAX) break;
    ranges.push({ seq: { gte: low, lte: Math.min((prefix + 1) * scale - 1, INT_MAX) } });
  }
  return { OR: ranges };
}

function toView(row: unknown): ScheduledMessageView {
  return ScheduledMessageViewSchema.parse(row);
}

function createdBy(actor: ActorContext): string {
  // Only background work has no person, and it never schedules.
  if (actor.userId === undefined) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
  return actor.userId;
}

/**
 * Messages sent later. `ScheduledMessage` is the truth and the pg-boss job is
 * only the alarm clock: a job lost to a restart, a deleted queue row or a
 * crash between "row saved" and "job queued" is rebuilt from the row by
 * `reconcilePending`. Sending itself, under a lease so that one worker wins
 * and a dead one is replaced, is `ScheduleDelivery`.
 *
 * The slash commands, the REST API and the MCP tools all call these methods.
 */
@Injectable()
export class ScheduleService {
  private readonly logger = new Logger(ScheduleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly guilds: GuildConfigService,
    private readonly boss: PgBossService,
    private readonly client: Client,
    private readonly channels: ChannelAccessService,
    private readonly resolver: MessageResolver,
    private readonly delivery: ScheduleDelivery,
    private readonly ready: DiscordReadyService,
  ) {}

  /**
   * Schedules `content` for `runAt` under `guildId`, the server the caller
   * works in. A slash command may name a channel of any server the bot is in
   * (the bot works across servers on purpose) and still finds the message in
   * its own server's list; the REST API and MCP must name a channel of
   * `guildId`. With `dryRun` it reports the message as it would be stored and
   * writes nothing.
   */
  async scheduleSend(
    guildId: string,
    input: unknown,
    actor: ActorContext,
    opts: DestructiveOptions = {},
  ): Promise<ScheduleCreateResult> {
    const id = parseGuildId(guildId);
    const parsed = ScheduleSendInputSchema.safeParse(input);
    if (!parsed.success) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
    const { channelId, content, runAt } = parsed.data;
    this.assertWithinHorizon(runAt, actor);
    await this.assertDestination(id, channelId, actor);

    return this.create(
      id,
      {
        kind: 'SEND',
        channelId,
        runAt,
        content,
        source: null,
        allowedMentions: this.mentionsFor(actor, parsed.data.allowedMentions),
        preview: { content, attachmentCount: 0 },
      },
      actor,
      opts,
    );
  }

  /**
   * Schedules a copy of an existing message. The text and files are read when
   * the time comes, so an edit made before then is what gets copied. A source
   * from another server is followed for a slash command and refused for the
   * API, which must not read servers the caller does not manage.
   */
  async scheduleCopy(
    guildId: string,
    input: unknown,
    actor: ActorContext,
    opts: DestructiveOptions = {},
  ): Promise<ScheduleCreateResult> {
    const id = parseGuildId(guildId);
    const parsed = ScheduleCopyInputSchema.safeParse(input);
    if (!parsed.success) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
    const { channelId, source, sourceChannelId, runAt } = parsed.data;
    this.assertWithinHorizon(runAt, actor);
    const destination = await this.assertDestination(id, channelId, actor);

    const resolved = await this.resolver.fetch(
      source,
      sourceChannelId === undefined ? {} : { channelId: sourceChannelId },
    );
    switch (resolved.status) {
      case 'INVALID_LINK':
        throw new ServiceError(ErrorCode.VALIDATION_FAILED, { reason: resolved.reason });
      case 'NOT_FOUND':
        throw new ServiceError(ErrorCode.DISCORD_MESSAGE_NOT_FOUND);
      case 'NO_ACCESS':
        // Not told apart from "no such message" for a caller held to one server: the
        // answer would say which ids are real messages elsewhere.
        throw actor.source === 'DISCORD'
          ? new ServiceError(ErrorCode.DISCORD_MISSING_PERMISSIONS, { permission: 'view' })
          : new ServiceError(ErrorCode.DISCORD_MESSAGE_NOT_FOUND);
      case 'OK':
        break;
    }
    const { message } = resolved;
    // The same answer as "no such message", so a caller cannot probe other servers.
    if (actor.source !== 'DISCORD' && message.guildId !== id) {
      throw new ServiceError(ErrorCode.DISCORD_MESSAGE_NOT_FOUND);
    }
    const copy = buildMessageCopy(message);
    if (copy === null)
      throw new ServiceError(ErrorCode.VALIDATION_FAILED, { reason: 'EMPTY_SOURCE' });
    const problem = copyProblem(copy, uploadLimitForChannel(destination));
    if (problem !== null) throw new ServiceError(copyErrorCode(problem));

    return this.create(
      id,
      {
        kind: 'COPY',
        channelId,
        runAt,
        content: null,
        source: { channelId: message.channelId, messageId: message.id },
        allowedMentions: this.mentionsFor(actor, parsed.data.allowedMentions),
        preview: {
          content: copy.content === '' ? null : copy.content,
          attachmentCount: copy.files.length,
        },
      },
      actor,
      opts,
    );
  }

  /** The newest messages of the server, oldest first; every status unless one is asked for. */
  async list(guildId: string, query: unknown = {}): Promise<ScheduledMessageView[]> {
    const id = parseGuildId(guildId);
    const parsed = ScheduleListQuerySchema.safeParse(query);
    if (!parsed.success) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
    const { status, limit } = parsed.data;

    const rows = await this.prisma.scheduledMessage.findMany({
      where: { guild: { discordId: id }, ...(status === undefined ? {} : { status }) },
      select: VIEW_SELECT,
      orderBy: { seq: 'desc' },
      take: limit,
    });
    return rows.reverse().map(toView);
  }

  /**
   * Cancels message number `seq`. Canceling twice is not an error
   * (`ALREADY_CANCELED`), and a message already sent, failed or being sent
   * right now answers `NOT_PENDING`. With `dryRun` it reports the answer and
   * changes nothing, not even the audit trail.
   */
  async cancel(
    guildId: string,
    seq: number,
    actor: ActorContext,
    opts: DestructiveOptions = {},
  ): Promise<ScheduleCancelResult> {
    const id = parseGuildId(guildId);
    const number = z.number().int().min(1).max(INT_MAX).safeParse(seq);
    if (!number.success) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
    const dryRun = opts.dryRun === true;
    const answer = (
      code: ScheduleCancelResult['code'],
      status: ScheduleCancelResult['status'],
    ): ScheduleCancelResult =>
      ScheduleCancelResultSchema.parse({ dryRun, code, seq: number.data, status });

    const row = await this.prisma.scheduledMessage.findFirst({
      where: { guild: { discordId: id }, seq: number.data },
      select: { id: true, status: true, kind: true, channelId: true },
    });
    if (row === null) return answer('NOT_FOUND', null);
    if (row.status === 'CANCELED') return answer('ALREADY_CANCELED', row.status);
    if (row.status !== 'PENDING') return answer('NOT_PENDING', row.status);
    if (dryRun) return answer('CANCELED', row.status);

    const outcome = await this.prisma.$transaction(async (tx) => {
      // The condition is the race guard: a worker that claimed the message a
      // moment ago has already moved it out of PENDING.
      const changed = await tx.scheduledMessage.updateMany({
        where: { id: row.id, status: 'PENDING' },
        data: { status: 'CANCELED', leaseUntil: null },
      });
      if (changed.count !== 1) {
        const now = await tx.scheduledMessage.findUnique({
          where: { id: row.id },
          select: { status: true },
        });
        return { canceled: false as const, status: now?.status ?? null };
      }
      await this.audit.record(
        {
          guildId: id,
          actor,
          action: AUDIT_ACTIONS.scheduleCancel,
          params: { scheduleId: row.id, channelId: row.channelId, kind: row.kind },
        },
        tx,
      );
      return { canceled: true as const };
    });

    if (outcome.canceled) {
      await this.cancelJobs([row.id]);
      return answer('CANCELED', 'CANCELED');
    }
    // Somebody else got there first: a worker (it is being sent) or another cancel.
    if (outcome.status === null) return answer('NOT_FOUND', null);
    return answer(
      outcome.status === 'CANCELED' ? 'ALREADY_CANCELED' : 'NOT_PENDING',
      outcome.status,
    );
  }

  /**
   * Withdraws every pending message a revoked API key had scheduled, in every
   * server, so a leaked key cannot keep posting after it is revoked. Called by
   * the key service when a key is revoked; `actor` is whoever revoked it.
   */
  async cancelByApiKey(apiKeyId: string, actor: ActorContext): Promise<ScheduleCancelByKeyResult> {
    const key = z.uuid().safeParse(apiKeyId);
    if (!key.success) throw new ServiceError(ErrorCode.VALIDATION_FAILED);

    const canceled = await this.prisma.$transaction(async (tx) => {
      const pending = await tx.scheduledMessage.findMany({
        where: { apiKeyId: key.data, status: 'PENDING' },
        select: { id: true },
      });
      if (pending.length === 0) return [];
      const ids = pending.map((row) => row.id);
      await tx.scheduledMessage.updateMany({
        where: { id: { in: ids }, status: 'PENDING' },
        data: {
          status: 'CANCELED',
          leaseUntil: null,
          lastError: 'KEY_REVOKED' satisfies ScheduleFailure,
        },
      });
      // Only what this call canceled: a worker may have claimed some meanwhile.
      const rows = await tx.scheduledMessage.findMany({
        where: { id: { in: ids }, status: 'CANCELED', lastError: 'KEY_REVOKED' },
        select: { id: true, guild: { select: { discordId: true } } },
      });
      const perGuild = new Map<string, number>();
      for (const { guild } of rows) {
        perGuild.set(guild.discordId, (perGuild.get(guild.discordId) ?? 0) + 1);
      }
      for (const [guildId, count] of perGuild) {
        await this.audit.record(
          { guildId, actor, action: AUDIT_ACTIONS.scheduleCancel, params: { count } },
          tx,
        );
      }
      return rows.map((row) => row.id);
    });

    await this.cancelJobs(canceled);
    return { count: canceled.length };
  }

  /**
   * The pending messages of a server for the `scheduler cancel` suggestions,
   * soonest first; `typed` narrows them to the numbers that start with it.
   */
  async autocompletePending(guildId: string, typed: string): Promise<SchedulePendingChoice[]> {
    const id = SnowflakeSchema.safeParse(guildId);
    if (!id.success) return [];
    const prefix = seqPrefixFilter(typed.trim());

    const rows = await this.prisma.scheduledMessage.findMany({
      where: { guild: { discordId: id.data }, status: 'PENDING', ...prefix },
      select: { seq: true, kind: true, runAt: true, content: true },
      orderBy: [{ runAt: 'asc' }, { seq: 'asc' }],
      take: SCHEDULE_AUTOCOMPLETE_MAX,
    });
    return rows.map((row) => ({
      seq: row.seq,
      kind: row.kind,
      runAt: row.runAt,
      preview:
        row.content === null ? 'copy' : (row.content.split('\n')[0] ?? '').slice(0, PREVIEW_LENGTH),
    }));
  }

  /**
   * What the pg-boss worker runs for a job. Returns normally when there is
   * nothing to do (canceled, already sent, or another worker holds the
   * lease), and throws when the send failed in a way worth retrying: the
   * throw is what makes pg-boss run the job again. True when this call took
   * the message and finished with it, whatever the outcome.
   */
  async handleJob(scheduleId: string): Promise<boolean> {
    return this.delivery.run(scheduleId);
  }

  /**
   * Brings the alarm clocks back in line with the table: messages that are
   * overdue (their job was lost, or the process was down at their time) are
   * sent now, once; pending messages in the future that have no job get one;
   * and a message whose sender died mid-send is taken over once its lease has
   * lapsed. Safe to run at any time and from several places: claiming decides.
   */
  async reconcilePending(
    graceMs: number = SCHEDULE_OVERDUE_GRACE_MS,
  ): Promise<{ handled: number; enqueued: number }> {
    let handled = 0;
    for (let batch = 0; batch < RECONCILE_MAX_BATCHES; batch += 1) {
      if (this.ready.isStopping()) break;
      const now = Date.now();
      const overdue = await this.prisma.scheduledMessage.findMany({
        where: {
          OR: [
            {
              status: 'PENDING',
              runAt: { lte: new Date(now - graceMs) },
              // A PENDING row with a lease is waiting out a retry delay.
              OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date(now) } }],
            },
            { status: 'SENDING', leaseUntil: { lt: new Date(now) } },
          ],
        },
        select: { id: true },
        orderBy: { runAt: 'asc' },
        take: RECONCILE_BATCH,
      });
      for (const { id } of overdue) {
        if (this.ready.isStopping()) break;
        try {
          if (await this.handleJob(id)) handled += 1;
        } catch (error) {
          // The row is back to PENDING for the next pass; one bad message must not stop the others.
          this.logger.warn(`Reconcile could not send ${id} (${errorLabel(error)})`);
        }
      }
      if (overdue.length < RECONCILE_BATCH) break;
    }

    let enqueued = 0;
    if (!this.ready.isStopping()) {
      const missing = await this.prisma.scheduledMessage.findMany({
        where: { status: 'PENDING', pgBossJobId: null, runAt: { gt: new Date() } },
        select: { id: true, runAt: true },
        orderBy: { runAt: 'asc' },
        take: RECONCILE_BATCH,
      });
      for (const row of missing) {
        if (await this.enqueue(row.id, row.runAt)) enqueued += 1;
      }
    }
    return { handled, enqueued };
  }

  /**
   * The past is refused for everyone. How far ahead is bounded for the API and
   * MCP only: a slash command may schedule as far as it likes, as in the
   * legacy bot.
   */
  private assertWithinHorizon(runAt: Date, actor: ActorContext): void {
    const now = Date.now();
    if (runAt.getTime() <= now) {
      throw new ServiceError(ErrorCode.VALIDATION_FAILED, { reason: 'PAST' });
    }
    if (actor.source !== 'DISCORD' && runAt.getTime() > now + SCHEDULE_MAX_HORIZON_DAYS * DAY_MS) {
      throw new ServiceError(ErrorCode.SCHEDULE_TOO_FAR);
    }
  }

  /**
   * Slash commands keep the old behaviour (a mention in the text notifies who
   * it names) unless they ask for less. Everything else is limited to nobody:
   * an API key is not the person who can be held to what the text pings.
   */
  private mentionsFor(
    actor: ActorContext,
    requested: AllowedMentions | undefined,
  ): AllowedMentions {
    return actor.source === 'DISCORD' ? (requested ?? ALLOWED_MENTIONS_ALL) : ALLOWED_MENTIONS_NONE;
  }

  /**
   * The bot can post in the channel. A slash command may name any server's
   * channel; every other caller must name one of `guildId`, and learns nothing
   * about channels elsewhere: the server is compared before the bot's own
   * access is, so "in another server" and "not visible to the bot" read alike.
   * Returns the channel.
   */
  private async assertDestination(
    guildId: string,
    channelId: string,
    actor: ActorContext,
  ): Promise<unknown> {
    if (actor.source !== 'DISCORD') {
      let channel;
      try {
        channel = await this.client.channels.fetch(channelId);
      } catch (error) {
        if (isHiddenChannelError(error))
          throw new ServiceError(ErrorCode.DISCORD_CHANNEL_NOT_FOUND);
        throw error;
      }
      if (guildIdOf(channel) !== guildId) {
        throw new ServiceError(ErrorCode.DISCORD_CHANNEL_NOT_FOUND);
      }
    }
    const access = await this.channels.check(channelId, 'send');
    if (access === 'not-found') throw new ServiceError(ErrorCode.DISCORD_CHANNEL_NOT_FOUND);
    if (access === 'missing-permissions') {
      throw new ServiceError(ErrorCode.DISCORD_MISSING_PERMISSIONS, { permission: 'send' });
    }
    return this.client.channels.fetch(channelId);
  }

  private async create(
    guildId: string,
    plan: Plan,
    actor: ActorContext,
    opts: DestructiveOptions,
  ): Promise<ScheduleCreateResult> {
    const base = {
      kind: plan.kind,
      channelId: plan.channelId,
      runAt: plan.runAt,
      content: plan.preview.content,
      attachmentCount: plan.preview.attachmentCount,
      allowedMentions: plan.allowedMentions,
    };
    // Allowed without a bound for slash commands, as in the legacy bot.
    if (actor.source !== 'DISCORD') await this.assertRoom(guildId);
    if (opts.dryRun === true) return { dryRun: true, ...base, schedule: null };

    const row = await this.insert(guildId, plan, actor);
    // After the commit: a job must never exist for a row that rolled back.
    await this.enqueue(row.id, plan.runAt);
    return { dryRun: false, ...base, schedule: toView(row) };
  }

  /**
   * A server holds a bounded number of pending messages. Two creations in the
   * same instant can overshoot by one each; the bound is a guard against runaway
   * callers, not an exact quota.
   */
  private async assertRoom(guildId: string): Promise<void> {
    const pending = await this.prisma.scheduledMessage.count({
      where: { guild: { discordId: guildId }, status: 'PENDING' },
    });
    if (pending >= SCHEDULE_PENDING_MAX) {
      throw new ServiceError(ErrorCode.SCHEDULE_LIMIT_REACHED);
    }
  }

  /**
   * Saves the row under the next number of the server. Two schedules created
   * at the same moment read the same highest number; the unique key lets one
   * of them through and the other starts over with a fresh read.
   */
  private async insert(guildId: string, plan: Plan, actor: ActorContext) {
    const author = createdBy(actor);
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const guild = await this.guilds.ensureGuild(guildId, undefined, tx);
          const highest = await tx.scheduledMessage.aggregate({
            where: { guildId: guild.id },
            _max: { seq: true },
          });
          const row = await tx.scheduledMessage.create({
            data: {
              guildId: guild.id,
              seq: (highest._max.seq ?? 0) + 1,
              kind: plan.kind,
              channelId: plan.channelId,
              content: plan.content,
              sourceChannelId: plan.source?.channelId ?? null,
              sourceMessageId: plan.source?.messageId ?? null,
              allowedMentions: plan.allowedMentions,
              runAt: plan.runAt,
              source: actor.source,
              createdByUserId: author,
              apiKeyId: actor.apiKeyId ?? null,
            },
            select: VIEW_SELECT,
          });
          await this.audit.record(
            {
              guildId,
              actor,
              action: AUDIT_ACTIONS.scheduleCreate,
              params: { scheduleId: row.id, channelId: plan.channelId, kind: plan.kind },
            },
            tx,
          );
          return row;
        });
      } catch (error) {
        if (!isUniqueViolation(error) || attempt >= SEQ_RETRIES) throw error;
      }
    }
  }

  /**
   * Queues the alarm for a saved row. The job's id is the row's id, so queuing
   * twice makes one job. A failure is not the caller's: the row exists and
   * `reconcilePending` queues it on its next pass.
   */
  private async enqueue(id: string, runAt: Date): Promise<boolean> {
    try {
      const jobId = await this.boss.send(
        QUEUES.scheduledMessageSend,
        { scheduleId: id } satisfies ScheduleJobData,
        {
          id,
          startAfter: runAt,
          // Spread over minutes: a Discord or network fault that lasts seconds
          // would otherwise use all attempts before it clears.
          retryLimit: SCHEDULE_MAX_ATTEMPTS - 1,
          retryDelay: SCHEDULE_RETRY_DELAY_S,
          retryBackoff: true,
        },
      );
      // `null`: a job with this id already exists, which is as good.
      await this.prisma.scheduledMessage.updateMany({
        where: { id, status: 'PENDING', pgBossJobId: null },
        data: { pgBossJobId: jobId ?? id },
      });
      return true;
    } catch (error) {
      this.logger.warn(`Could not queue scheduled message ${id} (${errorLabel(error)})`);
      return false;
    }
  }

  /** Best effort: a job that survives a cancel finds the row canceled and does nothing. */
  private async cancelJobs(ids: readonly string[]): Promise<void> {
    const results = await Promise.allSettled(
      ids.map((id) => this.boss.cancel(QUEUES.scheduledMessageSend, id)),
    );
    for (const result of results) {
      if (result.status === 'rejected') {
        this.logger.warn(`Could not cancel a scheduled message job (${errorLabel(result.reason)})`);
      }
    }
  }
}
