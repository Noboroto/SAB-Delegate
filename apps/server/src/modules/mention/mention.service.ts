import { Injectable, Logger } from '@nestjs/common';
import {
  AUDIT_ACTIONS,
  ErrorCode,
  MENTION_SAMPLE_SIZE,
  MentionEveryoneInputSchema,
  MentionNonReactorsInputSchema,
  MentionReactorsInputSchema,
  SnowflakeSchema,
  type ActorContext,
  type AuditAction,
  type MentionEveryoneResult,
  type MentionResult,
} from '@sab/shared';
import { ChannelType, Client, type GuildMember, type Message } from 'discord.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { ServiceError } from '../../common/errors/service-error.js';
import { mentionsForActor } from '../../discord/helpers/allowed-mentions.js';
import { discordRefusal } from '../../discord/helpers/discord-failure.js';
import { fetchGuildMembers } from '../../discord/helpers/guild-members.js';
import { assertInGuild, requireMessage } from '../../discord/helpers/message-target.js';
import { discordErrorCode } from '../../discord/helpers/reply.js';
import { DiscordReactionService } from '../../discord/services/discord-reaction.service.js';
import { MessageResolver } from '../../discord/services/message-resolver.service.js';
import { translatorFor } from '../../i18n/translator.js';
import { errorLabel } from '../../prisma/pool-factory.js';
import { postAsReply, renderMentionList } from './mention.format.js';

type MentionOptions = {
  /** Work out the list and the text; post nothing and audit nothing. */
  dryRun?: boolean;
  /**
   * Allow the reply target to be in another server. Only the slash commands
   * set it: the bot follows links across servers on purpose, whereas an API
   * caller may not reach outside the server it was given.
   */
  crossGuild?: boolean;
};

/** Unknown Channel, Missing Access: the thread is not one the bot can use. */
const UNUSABLE_CHANNEL_CODES: ReadonlySet<number> = new Set([10003, 50001]);

const SAMPLE = MENTION_SAMPLE_SIZE;

function requesterOf(actor: ActorContext): string {
  // The sentence names who asked; background work has nobody to name.
  if (actor.userId === undefined) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
  return actor.userId;
}

/**
 * Slash commands keep the old bot's reach on purpose (AGENTS.md): users, roles
 * and a typed `@everyone` all ping. A program calling in through the API or
 * MCP never gets to wake anybody.
 */
function postPolicy(actor: ActorContext): Parameters<typeof postAsReply>[2] {
  return {
    mentions: mentionsForActor(actor, ['users', 'roles', 'everyone']),
    pingAuthor: actor.source === 'DISCORD',
  };
}

/** `postAsReply` hands back what it caught; rethrown, it must be an Error for the handler. */
function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error('Unexpected failure');
}

function parseGuild(guildId: string): string {
  const parsed = SnowflakeSchema.safeParse(guildId);
  if (!parsed.success) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
  return parsed.data;
}

/**
 * Lists people for a message: who reacted with an emoji, who did not react at
 * all, or everybody in a thread. The slash commands, the context menu and
 * (later) the API all go through here. A mention command exists to ping: for
 * a slash command the posts ping whatever they name, as the old bot did, and
 * every other door pings nobody (see `postPolicy`).
 */
@Injectable()
export class MentionService {
  private readonly logger = new Logger(MentionService.name);

  constructor(
    private readonly client: Client,
    private readonly resolver: MessageResolver,
    private readonly reactions: DiscordReactionService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Everyone (not a bot) who reacted with `emoji`. With `replyTo` the list is
   * posted as a reply to that message and `delivered` is true; without it the
   * text comes back in `chunks`, each within Discord's limit, for the caller
   * to post.
   */
  async mentionReactors(
    guildId: string,
    input: unknown,
    actor: ActorContext,
    opts: MentionOptions = {},
  ): Promise<MentionResult> {
    const guild = parseGuild(guildId);
    const parsed = MentionReactorsInputSchema.safeParse(input);
    if (!parsed.success) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
    const { emoji, content, replyTo, locale } = parsed.data;
    const requesterId = requesterOf(actor);

    const message = await requireMessage(this.resolver, parsed.data);
    assertInGuild(message, guild);
    const target = replyTo === undefined ? undefined : await requireMessage(this.resolver, replyTo);
    if (target !== undefined && opts.crossGuild !== true) assertInGuild(target, guild);

    const userIds = await this.reactions.fetchReactorIds(message, emoji);
    if (userIds.length === 0) return this.nothing('NO_REACTORS', opts);

    const t = translatorFor(locale ?? 'vi');
    const chunks = renderMentionList({
      header: t('mention.reactors.header', {
        user: `<@${requesterId}>`,
        count: userIds.length,
        url: message.url,
        emoji,
      }),
      userIds,
      requesterId,
      authorLabel: t('mention.author'),
      content,
    });

    return this.finish({
      guildId: guild,
      actor,
      action: AUDIT_ACTIONS.mentionReactors,
      params: { channelId: message.channelId, messageId: message.id, emoji, count: userIds.length },
      userIds,
      chunks,
      target,
      opts,
    });
  }

  /**
   * The members expected to react who have not. Expected means: those who can
   * see the channel (or are in the thread), narrowed to a role if one is given;
   * with `onlyInChannel: false` and a role, every member of the role instead
   * (bots in the role included, as the old command did). Otherwise bots are
   * left out unless `includeBots`. With `reply` the list is posted as a reply
   * to the message itself.
   */
  async mentionNonReactors(
    guildId: string,
    input: unknown,
    actor: ActorContext,
    opts: MentionOptions = {},
  ): Promise<MentionResult> {
    const guild = parseGuild(guildId);
    const parsed = MentionNonReactorsInputSchema.safeParse(input);
    if (!parsed.success) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
    const { content, roleId, includeBots, onlyInChannel, reply, locale } = parsed.data;
    const requesterId = requesterOf(actor);

    const message = await requireMessage(this.resolver, parsed.data);
    assertInGuild(message, guild);

    const expected = await this.expectedReactors(message, { roleId, includeBots, onlyInChannel });
    if (expected === 'UNSUPPORTED_CHANNEL') return this.nothing('UNSUPPORTED_CHANNEL', opts);

    const reacted = new Set(await this.reactions.fetchReactorIds(message));
    const userIds = expected.filter((member) => !reacted.has(member.id)).map((member) => member.id);
    if (userIds.length === 0) return this.nothing('ALL_REACTED', opts);

    const t = translatorFor(locale ?? 'vi');
    const chunks = renderMentionList({
      header: t('mention.nonReactors.header', {
        user: `<@${requesterId}>`,
        count: userIds.length,
        url: message.url,
      }),
      userIds,
      requesterId,
      authorLabel: t('mention.author'),
      content,
    });

    return this.finish({
      guildId: guild,
      actor,
      action: AUDIT_ACTIONS.mentionNonReactors,
      params: {
        channelId: message.channelId,
        messageId: message.id,
        count: userIds.length,
        ...(roleId === undefined ? {} : { roleId }),
      },
      userIds,
      chunks,
      target: reply ? message : undefined,
      opts,
    });
  }

  /**
   * Posts "`<asker>` mentioned @everyone" and the given text in a thread, or as
   * a reply to `replyTo`. This is the one place `@everyone` may ping.
   */
  async mentionEveryoneInThread(
    guildId: string,
    input: unknown,
    actor: ActorContext,
    opts: MentionOptions = {},
  ): Promise<MentionEveryoneResult> {
    const guild = parseGuild(guildId);
    const parsed = MentionEveryoneInputSchema.safeParse(input);
    if (!parsed.success) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
    const { threadId, content, replyTo, locale } = parsed.data;
    const requesterId = requesterOf(actor);
    // `@everyone` is the one ping only a person at a slash command may cause.
    if (actor.source !== 'DISCORD') throw new ServiceError(ErrorCode.AUTH_FORBIDDEN);

    const thread = await this.fetchChannel(threadId);
    if (thread === null || !thread.isThread()) {
      return { dryRun: opts.dryRun === true, status: 'NOT_A_THREAD', text: '' };
    }
    if (thread.guildId !== guild) throw new ServiceError(ErrorCode.DISCORD_CHANNEL_NOT_FOUND);

    const target = replyTo === undefined ? undefined : await requireMessage(this.resolver, replyTo);
    if (target !== undefined && opts.crossGuild !== true) assertInGuild(target, guild);

    const header = translatorFor(locale ?? 'vi')('mention.everyone.header', {
      user: `<@${requesterId}>`,
    });
    const text = `${header}\n${content ?? ''}`.trimEnd();
    if (opts.dryRun === true) return { dryRun: true, status: 'OK', text };

    const allowedMentions = mentionsForActor(actor, ['users', 'roles', 'everyone']);
    try {
      if (target === undefined) {
        await thread.send({ content: text, allowedMentions });
      } else {
        await target.reply({
          content: text,
          allowedMentions: { ...allowedMentions, repliedUser: true },
        });
      }
    } catch (error) {
      const failure = discordRefusal(error);
      if (failure === undefined) throw error;
      await this.record(
        guild,
        actor,
        AUDIT_ACTIONS.mentionEveryone,
        {
          channelId: threadId,
        },
        'DISCORD_API_ERROR',
      );
      return { dryRun: false, status: 'SEND_FAILED', text, failure };
    }

    await this.record(guild, actor, AUDIT_ACTIONS.mentionEveryone, { channelId: threadId });
    return { dryRun: false, status: 'OK', text };
  }

  private nothing(status: MentionResult['status'], opts: MentionOptions): MentionResult {
    return {
      dryRun: opts.dryRun === true,
      status,
      count: 0,
      sample: [],
      chunks: [],
      delivered: false,
      postedChunks: 0,
    };
  }

  /** Posts (when there is a target and this is not a dry run), audits, and shapes the result. */
  private async finish(work: {
    guildId: string;
    actor: ActorContext;
    action: AuditAction;
    params: Record<string, unknown>;
    userIds: readonly string[];
    chunks: string[];
    target: Message | undefined;
    opts: MentionOptions;
  }): Promise<MentionResult> {
    const { userIds, chunks, target, opts } = work;
    const base = {
      count: userIds.length,
      sample: userIds.slice(0, SAMPLE),
      chunks,
    };
    if (opts.dryRun === true) {
      return { dryRun: true, status: 'OK', delivered: false, postedChunks: 0, ...base };
    }

    if (target !== undefined) {
      const { posted, error } = await postAsReply(target, chunks, postPolicy(work.actor));
      if (error !== undefined) {
        const failure = discordRefusal(error);
        // Pieces that went out stay out, so the failure is audited with how far it got.
        if (failure !== undefined || posted > 0) {
          await this.record(
            work.guildId,
            work.actor,
            work.action,
            { ...work.params, total: chunks.length, failed: chunks.length - posted },
            'DISCORD_API_ERROR',
          );
        }
        if (failure === undefined) throw toError(error);
        return {
          dryRun: false,
          status: 'SEND_FAILED',
          delivered: false,
          postedChunks: posted,
          failure,
          ...base,
        };
      }
    }
    await this.record(work.guildId, work.actor, work.action, work.params);
    return {
      dryRun: false,
      status: 'OK',
      delivered: target !== undefined,
      postedChunks: target === undefined ? 0 : chunks.length,
      ...base,
    };
  }

  /**
   * The audit row follows the post, never precedes it, and a failure to write
   * it must not turn a message that went out into an error for the person who
   * sent it.
   */
  private async record(
    guildId: string,
    actor: ActorContext,
    action: AuditAction,
    params: Record<string, unknown>,
    error?: string,
  ): Promise<void> {
    try {
      await this.audit.record({
        guildId,
        actor,
        action,
        params,
        ...(error === undefined ? {} : { ok: false, error }),
      });
    } catch (failure) {
      this.logger.warn(`Could not audit ${action} (${errorLabel(failure)})`);
    }
  }

  private async fetchChannel(channelId: string) {
    try {
      return await this.client.channels.fetch(channelId);
    } catch (error) {
      const code = discordErrorCode(error);
      if (code !== undefined && UNUSABLE_CHANNEL_CODES.has(code)) {
        throw new ServiceError(ErrorCode.DISCORD_CHANNEL_NOT_FOUND);
      }
      throw error;
    }
  }

  /**
   * Who is expected to react to `message`, or `UNSUPPORTED_CHANNEL` for
   * channels the idea does not fit (voice, stage, forum and the like).
   */
  private async expectedReactors(
    message: Message,
    filter: { roleId: string | undefined; includeBots: boolean; onlyInChannel: boolean },
  ): Promise<GuildMember[] | 'UNSUPPORTED_CHANNEL'> {
    const { channel, guild } = message;
    const isText =
      channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement;
    if (guild === null || (!isText && !channel.isThread())) return 'UNSUPPORTED_CHANNEL';

    // The member lists below are built from the cache; fill it first.
    const guildMembers = await fetchGuildMembers(guild);
    const { roleId } = filter;

    // The whole role is taken as it is, bots included: `includeBots` only ever
    // applied to the people who can see the channel.
    if (roleId !== undefined && !filter.onlyInChannel) {
      return [...guildMembers.filter((member) => member.roles.cache.has(roleId)).values()];
    }

    let members: GuildMember[];
    if (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement) {
      members = [...channel.members.values()];
    } else if (channel.isThread()) {
      const inThread = await channel.members.fetch({ withMember: true });
      members = inThread
        .map((entry) => guildMembers.get(entry.id))
        .filter((member): member is GuildMember => member !== undefined);
    } else {
      return 'UNSUPPORTED_CHANNEL';
    }
    if (!filter.includeBots) members = members.filter((member) => !member.user.bot);
    return roleId === undefined
      ? members
      : members.filter((member) => member.roles.cache.has(roleId));
  }
}
