import { Injectable, Logger } from '@nestjs/common';
import {
  AUDIT_ACTIONS,
  ErrorCode,
  PURGE_RANGE_MAX,
  PURGE_SAMPLE_SIZE,
  PurgeLastSchema,
  PurgeRangeSchema,
  SnowflakeSchema,
  type ActorContext,
  type PurgeLast,
  type PurgePlan,
  type PurgeRange,
  type PurgeResult,
  type PurgeStatus,
} from '@sab/shared';
import { Client, type GuildTextBasedChannel, type Message } from 'discord.js';
import pLimit from 'p-limit';
import { AuditService } from '../../common/audit/audit.service.js';
import { ServiceError } from '../../common/errors/service-error.js';
import {
  failureLabel,
  isMissingPermission,
  isUnknownMessage,
  toServiceError,
} from '../../discord/helpers/discord-failure.js';
import { compareSnowflakes, isNewer } from '../../discord/helpers/snowflake-order.js';
import { errorLabel } from '../../prisma/pool-factory.js';

type PurgeOptions = { dryRun?: boolean };

/** Discord returns at most this many messages per request and deletes this many per bulk call. */
const PAGE_SIZE = 100;
/**
 * Bulk delete refuses messages older than two weeks. The margin keeps a message
 * that crosses the line between the selection and the delete from failing the
 * whole call.
 */
const BULK_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000 - 60_000;
/** Deletes in flight at once for the messages bulk delete cannot take. */
const SINGLE_DELETE_CONCURRENCY = 5;

type Refusal = Exclude<PurgeStatus, 'OK'>;

/** Newest first. `status` is not `OK` only when the request itself was wrong. */
type Selection = { status: 'OK'; messages: Message[] } | { status: Refusal; messages: [] };

const refuse = (status: Refusal): Selection => ({ status, messages: [] });

function parseSnowflake(value: string): string {
  const parsed = SnowflakeSchema.safeParse(value);
  if (!parsed.success) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
  return parsed.data;
}

/** Newest first, whatever order Discord answered in. */
const newestFirst = (messages: Iterable<Message>): Message[] =>
  [...messages].sort((a, b) => compareSnowflakes(b.id, a.id));

/**
 * Deletes messages in one channel: everything between two messages, or the
 * latest few. Both come in a preview form (`dryRun`) that reports what would go
 * and touches nothing; the real run selects the same way, so with the newest
 * message of the preview passed back as the start (`fromMessageId`) it deletes
 * what the preview counted. System messages are never selected.
 */
@Injectable()
export class PurgeService {
  private readonly logger = new Logger(PurgeService.name);

  constructor(
    private readonly client: Client,
    private readonly audit: AuditService,
  ) {}

  /**
   * The messages after `untilMessageId` (kept) up to `fromMessageId`
   * (deleted; the newest message when absent). The channel must belong to
   * `guildId`.
   */
  purgeRange(
    guildId: string,
    input: unknown,
    actor: ActorContext,
    opts: { dryRun: true },
  ): Promise<PurgePlan>;
  purgeRange(
    guildId: string,
    input: unknown,
    actor: ActorContext,
    opts?: { dryRun?: false },
  ): Promise<PurgeResult>;
  purgeRange(
    guildId: string,
    input: unknown,
    actor: ActorContext,
    opts?: PurgeOptions,
  ): Promise<PurgePlan | PurgeResult>;
  async purgeRange(
    guildId: string,
    input: unknown,
    actor: ActorContext,
    opts: PurgeOptions = {},
  ): Promise<PurgePlan | PurgeResult> {
    const id = parseSnowflake(guildId);
    const parsed = PurgeRangeSchema.safeParse(input);
    if (!parsed.success) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
    const range = parsed.data;
    return this.run(
      id,
      range.channelId,
      (channel) => this.selectRange(channel, range),
      actor,
      opts,
    );
  }

  /** The newest `count` messages, counted from `fromMessageId` (inclusive) when given. */
  purgeLast(
    guildId: string,
    input: unknown,
    actor: ActorContext,
    opts: { dryRun: true },
  ): Promise<PurgePlan>;
  purgeLast(
    guildId: string,
    input: unknown,
    actor: ActorContext,
    opts?: { dryRun?: false },
  ): Promise<PurgeResult>;
  purgeLast(
    guildId: string,
    input: unknown,
    actor: ActorContext,
    opts?: PurgeOptions,
  ): Promise<PurgePlan | PurgeResult>;
  async purgeLast(
    guildId: string,
    input: unknown,
    actor: ActorContext,
    opts: PurgeOptions = {},
  ): Promise<PurgePlan | PurgeResult> {
    const id = parseSnowflake(guildId);
    const parsed = PurgeLastSchema.safeParse(input);
    if (!parsed.success) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
    const last = parsed.data;
    return this.run(id, last.channelId, (channel) => this.selectLast(channel, last), actor, opts);
  }

  private async run(
    guildId: string,
    channelId: string,
    select: (channel: GuildTextBasedChannel) => Promise<Selection>,
    actor: ActorContext,
    opts: PurgeOptions,
  ): Promise<PurgePlan | PurgeResult> {
    try {
      const channel = await this.channelOf(guildId, channelId);
      const selection = await select(channel);
      return opts.dryRun === true
        ? this.planOf(selection)
        : await this.execute(channel, guildId, selection, actor);
    } catch (error) {
      throw toServiceError(error);
    }
  }

  /** The channel, only if it is a text channel of this server: an id from another one is "not found". */
  private async channelOf(guildId: string, channelId: string): Promise<GuildTextBasedChannel> {
    const channel = await this.client.channels.fetch(channelId);
    if (
      channel === null ||
      !channel.isTextBased() ||
      channel.isDMBased() ||
      channel.guildId !== guildId
    ) {
      throw new ServiceError(ErrorCode.DISCORD_CHANNEL_NOT_FOUND);
    }
    return channel;
  }

  private async selectRange(channel: GuildTextBasedChannel, range: PurgeRange): Promise<Selection> {
    const until = await this.fetchOne(channel, range.untilMessageId);
    if (until === null) return refuse('UNTIL_NOT_FOUND');

    let from: Message;
    if (range.fromMessageId === undefined) {
      const newest = (await channel.messages.fetch({ limit: 1, cache: false })).first();
      // The kept message is the newest one: nothing lies after it.
      if (newest === undefined || newest.id === until.id) return { status: 'OK', messages: [] };
      from = newest;
    } else {
      const found = await this.fetchOne(channel, range.fromMessageId);
      if (found === null) return refuse('FROM_NOT_FOUND');
      from = found;
    }
    if (!isNewer(from.id, until.id)) return refuse('RANGE_REVERSED');

    const selected: Message[] = from.system ? [] : [from];
    let before = from.id;
    for (;;) {
      const page = await channel.messages.fetch({ limit: PAGE_SIZE, before, cache: false });
      if (page.size === 0) break;
      const ordered = newestFirst(page.values());
      let reachedUntil = false;
      for (const message of ordered) {
        // `until` itself and everything older stays.
        if (!isNewer(message.id, until.id)) {
          reachedUntil = true;
          break;
        }
        if (!message.system) selected.push(message);
      }
      if (selected.length > PURGE_RANGE_MAX) return refuse('RANGE_TOO_LARGE');
      const oldest = ordered.at(-1);
      if (reachedUntil || page.size < PAGE_SIZE || oldest === undefined) break;
      before = oldest.id;
    }
    return { status: 'OK', messages: selected };
  }

  private async selectLast(channel: GuildTextBasedChannel, last: PurgeLast): Promise<Selection> {
    const selected: Message[] = [];
    let before: string | undefined;
    if (last.fromMessageId !== undefined) {
      const from = await this.fetchOne(channel, last.fromMessageId);
      if (from === null) return refuse('FROM_NOT_FOUND');
      if (!from.system) selected.push(from);
      before = from.id;
    }
    while (selected.length < last.count) {
      const page = await channel.messages.fetch({
        limit: PAGE_SIZE,
        ...(before === undefined ? {} : { before }),
        cache: false,
      });
      if (page.size === 0) break;
      const ordered = newestFirst(page.values());
      for (const message of ordered) {
        if (selected.length >= last.count) break;
        if (!message.system) selected.push(message);
      }
      const oldest = ordered.at(-1);
      if (page.size < PAGE_SIZE || oldest === undefined) break;
      before = oldest.id;
    }
    return { status: 'OK', messages: selected };
  }

  /** Null when the message is not in the channel (deleted, or an id from somewhere else). */
  private async fetchOne(channel: GuildTextBasedChannel, id: string): Promise<Message | null> {
    try {
      return await channel.messages.fetch({ message: id, cache: false, force: true });
    } catch (error) {
      if (isUnknownMessage(error)) return null;
      throw error;
    }
  }

  private planOf(selection: Selection): PurgePlan {
    const { messages } = selection;
    const now = Date.now();
    return {
      status: selection.status,
      count: messages.length,
      fromMessageId: messages[0]?.id ?? null,
      olderCount: messages.filter((message) => isTooOldForBulk(message, now)).length,
      sample: messages.slice(0, PURGE_SAMPLE_SIZE).map((message) => message.id),
    };
  }

  private async execute(
    channel: GuildTextBasedChannel,
    guildId: string,
    selection: Selection,
    actor: ActorContext,
  ): Promise<PurgeResult> {
    const { messages } = selection;
    if (messages.length === 0) {
      return { status: selection.status, count: 0, deleted: 0, failed: 0 };
    }

    const run = new DeleteRun(channel, this.logger);
    const now = Date.now();
    const recent = messages.filter((message) => !isTooOldForBulk(message, now));
    const older = messages.filter((message) => isTooOldForBulk(message, now));
    for (let start = 0; start < recent.length; start += PAGE_SIZE) {
      await run.deleteChunk(recent.slice(start, start + PAGE_SIZE));
    }
    await run.deleteOneByOne(older);

    const result: PurgeResult = {
      status: 'OK',
      count: messages.length,
      deleted: run.deleted,
      failed: run.failed,
    };
    await this.record(guildId, channel.id, result, actor);
    return result;
  }

  /**
   * The messages are gone by now, so a failed audit write must not turn the
   * answer into an error: it is logged for whoever keeps the trail.
   */
  private async record(
    guildId: string,
    channelId: string,
    result: PurgeResult,
    actor: ActorContext,
  ): Promise<void> {
    try {
      await this.audit.record({
        guildId,
        actor,
        action: AUDIT_ACTIONS.purgeMessages,
        params: {
          channelId,
          count: result.deleted,
          failed: result.failed,
          total: result.count,
        },
      });
    } catch (error) {
      this.logger.error(`Could not record the purge in the audit trail (${errorLabel(error)})`);
    }
  }
}

const isTooOldForBulk = (message: Message, now: number): boolean =>
  now - message.createdTimestamp >= BULK_MAX_AGE_MS;

/**
 * Counts what one purge deleted. Once Discord says the bot may not delete in
 * this channel every further request would fail the same way, so the rest is
 * counted as failed without asking.
 */
class DeleteRun {
  deleted = 0;
  failed = 0;
  private blocked = false;

  constructor(
    private readonly channel: GuildTextBasedChannel,
    private readonly logger: Logger,
  ) {}

  /** Up to 100 messages younger than two weeks, in one request when there are at least two. */
  async deleteChunk(chunk: readonly Message[]): Promise<void> {
    if (chunk.length < 2) return this.deleteOneByOne(chunk);
    if (this.blocked) {
      this.failed += chunk.length;
      return;
    }
    try {
      await this.channel.bulkDelete(
        chunk.map((message) => message.id),
        false,
      );
      this.deleted += chunk.length;
    } catch (error) {
      this.logger.warn(`Bulk delete failed, deleting one by one (${failureLabel(error)})`);
      if (isMissingPermission(error)) {
        this.blocked = true;
        this.failed += chunk.length;
        return;
      }
      // One message that cannot be bulk deleted must not hold back the other 99.
      await this.deleteOneByOne(chunk);
    }
  }

  async deleteOneByOne(messages: readonly Message[]): Promise<void> {
    await pLimit(SINGLE_DELETE_CONCURRENCY).map(messages, (message) => this.deleteOne(message));
  }

  private async deleteOne(message: Message): Promise<void> {
    if (this.blocked) {
      this.failed += 1;
      return;
    }
    try {
      await this.channel.messages.delete(message.id);
      this.deleted += 1;
    } catch (error) {
      if (isUnknownMessage(error)) {
        // Already deleted by someone else: it is gone, as asked.
        this.deleted += 1;
        return;
      }
      if (isMissingPermission(error)) this.blocked = true;
      this.failed += 1;
      this.logger.warn(`Could not delete message ${message.id} (${failureLabel(error)})`);
    }
  }
}
