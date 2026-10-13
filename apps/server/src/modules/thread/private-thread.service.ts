import { Injectable, Logger } from '@nestjs/common';
import {
  AUDIT_ACTIONS,
  ErrorCode,
  PRIVATE_THREAD_MAX_MEMBERS,
  PrivateThreadCreateSchema,
  PrivateThreadFromReactorsSchema,
  SnowflakeSchema,
  THREAD_FAILURE_REASON,
  type ActorContext,
  type PrivateThreadFailure,
  type PrivateThreadResult,
  type PrivateThreadStatus,
} from '@sab/shared';
import {
  ChannelType,
  Client,
  ThreadAutoArchiveDuration,
  type Collection,
  type GuildMember,
  type Snowflake,
  type TextChannel,
  type ThreadChannel,
} from 'discord.js';
import pLimit from 'p-limit';
import { AuditService } from '../../common/audit/audit.service.js';
import { ServiceError } from '../../common/errors/service-error.js';
import { mentionsForActor } from '../../discord/helpers/allowed-mentions.js';
import { fetchGuildMembers } from '../../discord/helpers/guild-members.js';
import { assertInGuild } from '../../discord/helpers/message-target.js';
import { DiscordReactionService } from '../../discord/services/discord-reaction.service.js';
import { MessageResolver } from '../../discord/services/message-resolver.service.js';
import { errorLabel } from '../../prisma/pool-factory.js';
import {
  failureLabel,
  failureReason,
  toServiceError,
} from '../../discord/helpers/discord-failure.js';
import { guildChannel, reasonFor } from './thread.service.js';

/** Threads opened at once; Discord rate limits thread creation per channel. */
const CREATE_CONCURRENCY = 3;

type FromReactorsOptions = {
  /**
   * Allow the message that is read for reactors to be in another server, as
   * the slash command does (allowed, as in the legacy bot). An API caller may
   * not read outside the server it was given.
   */
  crossGuild?: boolean;
};

type Base = { channelId: string; prefix: string; message: string };

function parseSnowflake(value: string): string {
  const parsed = SnowflakeSchema.safeParse(value);
  if (!parsed.success) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
  return parsed.data;
}

const outcome = (
  status: Exclude<PrivateThreadStatus, 'OK'>,
  linkProblem: PrivateThreadResult['linkProblem'] = null,
): PrivateThreadResult => ({ status, linkProblem, total: 0, created: 0, failures: [] });

/**
 * One private thread per member, named `<prefix>-<username>`, closed to
 * invites, with the member and the person who asked inside and a first
 * message. A member that cannot get a thread does not stop the others; each
 * failure is reported by member.
 */
@Injectable()
export class PrivateThreadService {
  private readonly logger = new Logger(PrivateThreadService.name);

  constructor(
    private readonly client: Client,
    private readonly audit: AuditService,
    private readonly messages: MessageResolver,
    private readonly reactions: DiscordReactionService,
  ) {}

  /** Threads for the members in `userIds` and, when given, every member of `roleId`. */
  async createPrivateThreads(
    guildId: string,
    input: unknown,
    actor: ActorContext,
  ): Promise<PrivateThreadResult> {
    const id = parseSnowflake(guildId);
    const parsed = PrivateThreadCreateSchema.safeParse(input);
    if (!parsed.success) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
    const { userIds, roleId, ...base } = parsed.data;

    try {
      const channel = await this.textChannel(id, base.channelId);
      if (channel === null) return outcome('CHANNEL_NOT_TEXT');
      return await this.open(id, channel, base, userIds, roleId, actor);
    } catch (error) {
      throw toServiceError(error);
    }
  }

  /** Threads for the people who reacted to a message with one emoji; bots are left out. */
  async createPrivateThreadsFromReactors(
    guildId: string,
    input: unknown,
    actor: ActorContext,
    opts: FromReactorsOptions = {},
  ): Promise<PrivateThreadResult> {
    const id = parseSnowflake(guildId);
    const parsed = PrivateThreadFromReactorsSchema.safeParse(input);
    if (!parsed.success) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
    const { messageLink, emoji, ...base } = parsed.data;

    try {
      const channel = await this.textChannel(id, base.channelId);
      if (channel === null) return outcome('CHANNEL_NOT_TEXT');

      const found = await this.messages.fetch(messageLink);
      if (found.status === 'INVALID_LINK') return outcome('INVALID_LINK', found.reason);
      if (found.status === 'NOT_FOUND') return outcome('MESSAGE_NOT_FOUND');
      if (found.status === 'NO_ACCESS') return outcome('NO_ACCESS');

      if (opts.crossGuild !== true) assertInGuild(found.message, id);

      const userIds = await this.reactions.fetchReactorIds(found.message, emoji);
      return await this.open(id, channel, base, userIds, undefined, actor);
    } catch (error) {
      throw toServiceError(error);
    }
  }

  /** The channel when it is a text channel of this server; null for any other kind (private threads need a text channel). */
  private async textChannel(guildId: string, channelId: string): Promise<TextChannel | null> {
    const channel = guildChannel(await this.client.channels.fetch(channelId), guildId);
    return channel.type === ChannelType.GuildText ? channel : null;
  }

  private async open(
    guildId: string,
    channel: TextChannel,
    base: Base,
    userIds: readonly string[],
    roleId: string | undefined,
    actor: ActorContext,
  ): Promise<PrivateThreadResult> {
    if (userIds.length === 0 && roleId === undefined) return outcome('NO_MEMBERS');

    // The cache only holds members seen so far; the full list needs a fetch.
    const members = await fetchGuildMembers(channel.guild);
    const wanted = new Set(userIds);
    if (roleId !== undefined) {
      for (const member of members.values()) {
        if (member.roles.cache.has(roleId)) wanted.add(member.id);
      }
    }
    if (wanted.size === 0) return outcome('NO_MEMBERS');
    if (wanted.size > PRIVATE_THREAD_MAX_MEMBERS) {
      throw new ServiceError(ErrorCode.VALIDATION_FAILED);
    }

    const results = await pLimit(CREATE_CONCURRENCY).map([...wanted], (userId) =>
      this.openOne(channel, members, userId, base, actor),
    );
    const failures = results.filter((result): result is PrivateThreadFailure => result !== null);
    const created = results.length - failures.length;

    if (created > 0 || failures.length > 0) {
      await this.record(guildId, channel.id, actor, {
        count: created,
        failed: failures.length,
        total: results.length,
      });
    }
    return { status: 'OK', linkProblem: null, total: results.length, created, failures };
  }

  /** Null when the thread is made; otherwise why it was not. */
  private async openOne(
    channel: TextChannel,
    members: Collection<Snowflake, GuildMember>,
    userId: string,
    base: Base,
    actor: ActorContext,
  ): Promise<PrivateThreadFailure | null> {
    const member = members.get(userId);
    if (member === undefined) {
      return { userId, reason: THREAD_FAILURE_REASON.memberNotFound };
    }
    let created: ThreadChannel | undefined;
    try {
      const thread = await channel.threads.create({
        type: ChannelType.PrivateThread,
        name: `${base.prefix}-${member.user.username}`,
        autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
        reason: reasonFor(`Create thread for ${base.prefix}`, actor),
        invitable: false,
      });
      created = thread;
      await thread.members.add(member.id);
      if (actor.userId !== undefined && actor.userId !== member.id) {
        await thread.members.add(actor.userId);
      }
      await thread.send({
        content: base.message,
        allowedMentions: mentionsForActor(actor, ['users', 'roles']),
      });
      return null;
    } catch (error) {
      this.logger.warn(`Could not open a private thread for ${userId} (${failureLabel(error)})`);
      // A thread that never got its member or message would sit empty for a week.
      if (created !== undefined) await this.discard(created, actor);
      return { userId, reason: failureReason(error) };
    }
  }

  /** Removes a thread this call made but could not finish; a failure to remove it is logged for a person. */
  private async discard(thread: ThreadChannel, actor: ActorContext): Promise<void> {
    try {
      await thread.delete(reasonFor('Create private thread failed', actor));
    } catch (error) {
      this.logger.error(`Could not remove unfinished thread ${thread.id} (${failureLabel(error)})`);
    }
  }

  /**
   * The threads exist by now, so a failed audit write must not turn the answer
   * into an error: it is logged for whoever keeps the trail.
   */
  private async record(
    guildId: string,
    channelId: string,
    actor: ActorContext,
    params: { count: number; failed: number; total: number },
  ): Promise<void> {
    try {
      await this.audit.record({
        guildId,
        actor,
        action: AUDIT_ACTIONS.privateThreadCreate,
        params: { channelId, ...params },
      });
    } catch (error) {
      this.logger.error(`Could not record the private threads (${errorLabel(error)})`);
    }
  }
}
