import { Injectable, Logger } from '@nestjs/common';
import {
  AUDIT_ACTIONS,
  ErrorCode,
  SnowflakeSchema,
  THREAD_FAILURE_REASON,
  THREAD_NAME_MAX_LENGTH,
  THREAD_SAMPLE_SIZE,
  ThreadCreateSchema,
  ThreadDeleteSchema,
  ThreadRenameSchema,
  type ActorContext,
  type ThreadBatchPlan,
  type ThreadBatchResult,
  type ThreadBatchStatus,
  type ThreadCreateResult,
  type ThreadFailure,
  type ThreadMatch,
} from '@sab/shared';
import {
  ChannelType,
  Client,
  ThreadAutoArchiveDuration,
  type Channel,
  type ForumChannel,
  type GuildBasedChannel,
  type NewsChannel,
  type TextChannel,
  type ThreadChannel,
  type ThreadManager,
} from 'discord.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { ServiceError } from '../../common/errors/service-error.js';
import { errorLabel } from '../../prisma/pool-factory.js';
import {
  failureLabel,
  failureReason,
  toServiceError,
} from '../../discord/helpers/discord-failure.js';
import { compareSnowflakes } from '../../discord/helpers/snowflake-order.js';

type BatchOptions = { dryRun?: boolean };

type ThreadHost = TextChannel | NewsChannel | ForumChannel;

type ActiveThreads =
  | { status: 'OK'; channel: ThreadHost; threads: ThreadChannel[] }
  | { status: 'CHANNEL_CANNOT_HOLD_THREADS' };

function parseSnowflake(value: string): string {
  const parsed = SnowflakeSchema.safeParse(value);
  if (!parsed.success) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
  return parsed.data;
}

/** The text that lands in the server's audit log next to the change. */
export const reasonFor = (what: string, actor: ActorContext): string =>
  actor.userId === undefined ? what : `${what} by ${actor.userId}`;

/** The channel, only if it belongs to this server: an id from another one is "not found". */
export function guildChannel(channel: Channel | null, guildId: string): GuildBasedChannel {
  if (channel === null || !('guild' in channel) || channel.guildId !== guildId) {
    throw new ServiceError(ErrorCode.DISCORD_CHANNEL_NOT_FOUND);
  }
  return channel;
}

const isThreadHost = (channel: GuildBasedChannel): channel is ThreadHost =>
  channel.type === ChannelType.GuildText ||
  channel.type === ChannelType.GuildAnnouncement ||
  channel.type === ChannelType.GuildForum;

/**
 * Creates threads and renames or deletes them by name prefix. Renaming and
 * deleting come in a preview form (`dryRun`) that lists what would change and
 * touches nothing. Only active threads are considered: archived ones are
 * usually history people want kept.
 */
@Injectable()
export class ThreadService {
  private readonly logger = new Logger(ThreadService.name);

  constructor(
    private readonly client: Client,
    private readonly audit: AuditService,
  ) {}

  /**
   * One thread in a text, announcement or forum channel of this server, with
   * the message as its first post. In a forum the post is the thread, so
   * `isPrivate` has no effect there.
   */
  async create(guildId: string, input: unknown, actor: ActorContext): Promise<ThreadCreateResult> {
    const id = parseSnowflake(guildId);
    const parsed = ThreadCreateSchema.safeParse(input);
    if (!parsed.success) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
    const { channelId, name, message, isPrivate, byline } = parsed.data;

    try {
      const channel = guildChannel(await this.client.channels.fetch(channelId), id);
      const content = byline === undefined ? message : `${byline}\n\n${message}`;
      const options = {
        name,
        autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
        reason: reasonFor('Create thread', actor),
      };

      let thread: ThreadChannel;
      let kind: 'forum' | 'private' | 'public';
      if (channel.type === ChannelType.GuildForum) {
        // The first post is created together with the thread.
        thread = await channel.threads.create({
          ...options,
          message: { content, allowedMentions: { parse: [] } },
        });
        kind = 'forum';
      } else if (channel.type === ChannelType.GuildText) {
        thread = await channel.threads.create({
          ...options,
          type: isPrivate ? ChannelType.PrivateThread : ChannelType.PublicThread,
        });
        kind = isPrivate ? 'private' : 'public';
      } else if (channel.type === ChannelType.GuildAnnouncement) {
        if (isPrivate) return { status: 'PRIVATE_NEEDS_TEXT_CHANNEL', threadId: null };
        thread = await channel.threads.create({ ...options, type: ChannelType.AnnouncementThread });
        kind = 'public';
      } else {
        return { status: 'CHANNEL_CANNOT_HOLD_THREADS', threadId: null };
      }

      // The thread exists from here on, so it is recorded before the post that
      // could still fail.
      await this.record(id, actor, AUDIT_ACTIONS.threadCreate, {
        channelId,
        threadId: thread.id,
        kind,
      });
      if (kind !== 'forum') await thread.send({ content, allowedMentions: { parse: [] } });
      return { status: 'CREATED', threadId: thread.id };
    } catch (error) {
      throw toServiceError(error);
    }
  }

  /**
   * Replaces the leading `oldPrefix` of every active thread whose name starts
   * with it; a later occurrence in the name is left alone. A thread whose new
   * name would be empty or past 100 characters is reported as failed, not
   * attempted.
   */
  renameByPrefix(
    guildId: string,
    input: unknown,
    actor: ActorContext,
    opts: { dryRun: true },
  ): Promise<ThreadBatchPlan>;
  renameByPrefix(
    guildId: string,
    input: unknown,
    actor: ActorContext,
    opts?: { dryRun?: false },
  ): Promise<ThreadBatchResult>;
  renameByPrefix(
    guildId: string,
    input: unknown,
    actor: ActorContext,
    opts?: BatchOptions,
  ): Promise<ThreadBatchPlan | ThreadBatchResult>;
  async renameByPrefix(
    guildId: string,
    input: unknown,
    actor: ActorContext,
    opts: BatchOptions = {},
  ): Promise<ThreadBatchPlan | ThreadBatchResult> {
    const id = parseSnowflake(guildId);
    const parsed = ThreadRenameSchema.safeParse(input);
    if (!parsed.success) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
    const { channelId, oldPrefix, newPrefix } = parsed.data;

    const active = await this.activeThreads(id, channelId, oldPrefix);
    if (active.status !== 'OK') return emptyBatch(active.status, opts);

    const items = active.threads.map((thread) => ({
      thread,
      newName: newPrefix + thread.name.slice(oldPrefix.length),
    }));
    const usable = items.filter((item) => isUsableName(item.newName));
    if (opts.dryRun === true) {
      return {
        status: 'OK',
        count: items.length,
        invalid: items.length - usable.length,
        sample: items.slice(0, THREAD_SAMPLE_SIZE).map(({ thread, newName }) => ({
          threadId: thread.id,
          name: thread.name,
          newName,
        })),
      };
    }

    const failures: ThreadFailure[] = [];
    let done = 0;
    for (const { thread, newName } of items) {
      if (!isUsableName(newName)) {
        failures.push(failureOf(thread, THREAD_FAILURE_REASON.nameInvalid));
        continue;
      }
      // Renaming to the same name is a request for nothing, and rate limited.
      if (newName === thread.name) {
        done += 1;
        continue;
      }
      try {
        await thread.setName(newName, reasonFor('Rename thread', actor));
        done += 1;
      } catch (error) {
        this.logger.warn(`Could not rename thread ${thread.id} (${failureLabel(error)})`);
        failures.push(failureOf(thread, failureReason(error)));
      }
    }
    await this.record(id, actor, AUDIT_ACTIONS.threadRename, {
      channelId,
      count: done,
      failed: failures.length,
      total: items.length,
    });
    return { status: 'OK', count: items.length, done, failures };
  }

  /** Deletes every active thread whose name starts with `prefix`. */
  deleteByPrefix(
    guildId: string,
    input: unknown,
    actor: ActorContext,
    opts: { dryRun: true },
  ): Promise<ThreadBatchPlan>;
  deleteByPrefix(
    guildId: string,
    input: unknown,
    actor: ActorContext,
    opts?: { dryRun?: false },
  ): Promise<ThreadBatchResult>;
  deleteByPrefix(
    guildId: string,
    input: unknown,
    actor: ActorContext,
    opts?: BatchOptions,
  ): Promise<ThreadBatchPlan | ThreadBatchResult>;
  async deleteByPrefix(
    guildId: string,
    input: unknown,
    actor: ActorContext,
    opts: BatchOptions = {},
  ): Promise<ThreadBatchPlan | ThreadBatchResult> {
    const id = parseSnowflake(guildId);
    const parsed = ThreadDeleteSchema.safeParse(input);
    if (!parsed.success) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
    const { channelId, prefix } = parsed.data;

    const active = await this.activeThreads(id, channelId, prefix);
    if (active.status !== 'OK') return emptyBatch(active.status, opts);

    const { threads } = active;
    if (opts.dryRun === true) {
      return {
        status: 'OK',
        count: threads.length,
        invalid: 0,
        sample: threads.slice(0, THREAD_SAMPLE_SIZE).map(matchOf),
      };
    }

    const failures: ThreadFailure[] = [];
    let done = 0;
    for (const thread of threads) {
      try {
        await thread.delete(reasonFor('Delete thread', actor));
        done += 1;
      } catch (error) {
        this.logger.warn(`Could not delete thread ${thread.id} (${failureLabel(error)})`);
        failures.push(failureOf(thread, failureReason(error)));
      }
    }
    if (threads.length > 0) {
      await this.record(id, actor, AUDIT_ACTIONS.threadDelete, {
        channelId,
        count: done,
        failed: failures.length,
        total: threads.length,
      });
    }
    return { status: 'OK', count: threads.length, done, failures };
  }

  /** Active threads of one channel whose name starts with `prefix`, oldest first. */
  private async activeThreads(
    guildId: string,
    channelId: string,
    prefix: string,
  ): Promise<ActiveThreads> {
    try {
      const channel = guildChannel(await this.client.channels.fetch(channelId), guildId);
      if (!isThreadHost(channel)) return { status: 'CHANNEL_CANNOT_HOLD_THREADS' };
      // The managers of the three channel kinds share this base; calling `fetch`
      // through their union has no single signature.
      const { threads } = await (channel.threads as ThreadManager).fetch();
      return {
        status: 'OK',
        channel,
        threads: [...threads.values()]
          .filter((thread) => thread.name.startsWith(prefix))
          .sort((a, b) => compareSnowflakes(a.id, b.id)),
      };
    } catch (error) {
      throw toServiceError(error);
    }
  }

  /**
   * The change is done by now, so a failed audit write must not turn the
   * answer into an error: it is logged for whoever keeps the trail.
   */
  private async record(
    guildId: string,
    actor: ActorContext,
    action: (typeof AUDIT_ACTIONS)['threadCreate' | 'threadRename' | 'threadDelete'],
    params: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.audit.record({ guildId, actor, action, params });
    } catch (error) {
      this.logger.error(`Could not record ${action} in the audit trail (${errorLabel(error)})`);
    }
  }
}

const isUsableName = (name: string): boolean =>
  name.trim().length > 0 && name.length <= THREAD_NAME_MAX_LENGTH;

const matchOf = (thread: ThreadChannel): ThreadMatch => ({
  threadId: thread.id,
  name: thread.name,
});

const failureOf = (thread: ThreadChannel, reason: string): ThreadFailure => ({
  threadId: thread.id,
  name: thread.name,
  reason,
});

function emptyBatch(
  status: Exclude<ThreadBatchStatus, 'OK'>,
  opts: BatchOptions,
): ThreadBatchPlan | ThreadBatchResult {
  return opts.dryRun === true
    ? { status, count: 0, invalid: 0, sample: [] }
    : { status, count: 0, done: 0, failures: [] };
}
