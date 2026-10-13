import { Injectable, Logger } from '@nestjs/common';
import {
  AUDIT_ACTIONS,
  ErrorCode,
  INTRO_SCAN_LIMIT,
  IntroductionQuerySchema,
  InviteCreateSchema,
  ReactorIdsQuerySchema,
  RoleMembersQuerySchema,
  SnowflakeSchema,
  z,
  type ActorContext,
  type IntroductionResult,
  type InviteResult,
  type ReactorIdsResult,
  type RoleMembersResult,
} from '@sab/shared';
import { Client, PermissionFlagsBits, type Message } from 'discord.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { ServiceError } from '../../common/errors/service-error.js';
import { discordErrorCode } from '../../discord/helpers/reply.js';
import { ChannelAccessService } from '../../discord/services/channel-access.service.js';
import { DiscordReactionService } from '../../discord/services/discord-reaction.service.js';
import { MessageResolver } from '../../discord/services/message-resolver.service.js';
import { errorLabel } from '../../prisma/pool-factory.js';
import { GuildConfigService } from '../guild-config/guild-config.service.js';
import { fetchGuild, fetchGuildChannel } from '../../discord/helpers/discord-lookup.js';

/** Discord returns at most this many messages per request. */
const SCAN_BATCH_SIZE = 100;
/** Missing Access, Missing Permissions. */
const FORBIDDEN_CODES: ReadonlySet<number> = new Set([50001, 50013]);

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
  return parsed.data;
}

/**
 * Lookups the commands of `/get` are built on: a member's introduction, who
 * reacted to a message, who holds a role, and an invite link. The slash
 * commands, the REST API and the MCP tools all go through here. Only the invite
 * changes anything, so only it is audited.
 */
@Injectable()
export class InfoService {
  private readonly logger = new Logger(InfoService.name);

  constructor(
    private readonly client: Client,
    private readonly audit: AuditService,
    private readonly guilds: GuildConfigService,
    private readonly channelAccess: ChannelAccessService,
    private readonly resolver: MessageResolver,
    private readonly reactions: DiscordReactionService,
  ) {}

  /**
   * The first message a member wrote in the server's intro channel, looking
   * through at most the newest `INTRO_SCAN_LIMIT` messages. The channel being
   * unset is an answer; the channel being unreadable is an error.
   */
  async getIntroduction(guildId: string, input: unknown): Promise<IntroductionResult> {
    const id = parseSnowflake(guildId);
    const { userId } = parse(IntroductionQuerySchema, input);

    const channelId = await this.introChannelId(id);
    if (channelId === null) return { status: 'NO_CHANNEL' };

    const access = await this.channelAccess.check(channelId, 'read');
    if (access === 'not-found') throw new ServiceError(ErrorCode.DISCORD_CHANNEL_NOT_FOUND);
    if (access === 'missing-permissions') {
      throw new ServiceError(ErrorCode.DISCORD_MISSING_PERMISSIONS, { permission: 'view' });
    }

    const guild = await fetchGuild(this.client, id);
    const channel = await fetchGuildChannel(this.client, guild, channelId);
    if (!channel.isTextBased()) throw new ServiceError(ErrorCode.DISCORD_CHANNEL_NOT_FOUND);

    // Newest first, so every later match is an older message and the last one
    // seen is the first introduction. Only that one message is kept, however
    // many are read.
    let earliest: Message | undefined;
    let scanned = 0;
    let before: string | undefined;
    while (scanned < INTRO_SCAN_LIMIT) {
      const requested = Math.min(SCAN_BATCH_SIZE, INTRO_SCAN_LIMIT - scanned);
      const batch = await channel.messages.fetch({
        limit: requested,
        cache: false,
        ...(before === undefined ? {} : { before }),
      });
      if (batch.size === 0) break;
      scanned += batch.size;
      for (const message of batch.values()) {
        if (message.author.id === userId) earliest = message;
      }
      before = batch.lastKey();
      if (batch.size < requested) break;
    }

    if (earliest === undefined) return { status: 'NOT_FOUND', scanned };
    return {
      status: 'FOUND',
      channelId: earliest.channelId,
      messageId: earliest.id,
      url: earliest.url,
      content: earliest.content,
    };
  }

  /**
   * Ids of the people (bots excluded) who reacted to a message with an emoji.
   * `guildId` is the server the message must belong to; a slash command passes
   * the server of the message it resolved, because following a link into
   * another server is allowed there, while the REST API passes its own.
   */
  async listReactorIds(guildId: string | null, input: unknown): Promise<ReactorIdsResult> {
    const { channelId, messageId, emoji } = parse(ReactorIdsQuerySchema, input);

    const found = await this.resolver.fetch(`${channelId}/${messageId}`);
    if (found.status === 'NOT_FOUND') {
      throw new ServiceError(ErrorCode.DISCORD_MESSAGE_NOT_FOUND);
    }
    if (found.status === 'NO_ACCESS') {
      throw new ServiceError(ErrorCode.DISCORD_MISSING_PERMISSIONS, { permission: 'view' });
    }
    if (found.status !== 'OK') throw new ServiceError(ErrorCode.VALIDATION_FAILED);
    const { message } = found;
    if (message.guildId !== guildId) {
      throw new ServiceError(ErrorCode.DISCORD_MESSAGE_NOT_FOUND);
    }

    // The cache says whether the reaction exists, so a typo costs no paging.
    const userIds = this.reactions.hasReaction(message, emoji)
      ? await this.reactions.fetchReactorIds(message, emoji)
      : [];
    return { url: message.url, emoji, userIds };
  }

  /**
   * Ids of everyone holding a role. With `channelId` only those who can see
   * the channel are kept (for a thread, its members).
   */
  async listRoleMemberIds(guildId: string, input: unknown): Promise<RoleMembersResult> {
    const id = parseSnowflake(guildId);
    const { roleId, channelId } = parse(RoleMembersQuerySchema, input);

    const guild = await fetchGuild(this.client, id);
    const role = await guild.roles.fetch(roleId);
    if (role === null) throw new ServiceError(ErrorCode.VALIDATION_FAILED, { field: 'role' });

    // `role.members` reads the cache; the full list needs the whole member list.
    await guild.members.fetch();
    let userIds = [...role.members.keys()];

    if (channelId !== undefined) {
      const channel = await fetchGuildChannel(this.client, guild, channelId);
      if (channel.isThread()) {
        // Thread members are not cached.
        const inThread = new Set((await channel.members.fetch()).keys());
        userIds = userIds.filter((userId) => inThread.has(userId));
      } else if ('permissionsFor' in channel) {
        userIds = userIds.filter((userId) => {
          const member = role.members.get(userId);
          return (
            member !== undefined &&
            channel.permissionsFor(member)?.has(PermissionFlagsBits.ViewChannel) === true
          );
        });
      }
    }
    return { roleId: role.id, roleName: role.name, userIds };
  }

  /**
   * A permanent invite (no expiry, no use limit) that is unique to this
   * request. A thread has no invite of its own, so it is made for the channel
   * the thread sits in. Delivering it (a direct message, an HTTP body) is up to
   * the caller.
   */
  async createInvite(guildId: string, input: unknown, actor: ActorContext): Promise<InviteResult> {
    const id = parseSnowflake(guildId);
    const { channelId, reason } = parse(InviteCreateSchema, input);

    const guild = await fetchGuild(this.client, id);
    const requested = await fetchGuildChannel(this.client, guild, channelId);
    const target = requested.isThread() ? requested.parent : requested;
    if (target === null || !('createInvite' in target)) {
      throw new ServiceError(ErrorCode.VALIDATION_FAILED, { field: 'channel' });
    }

    let url: string;
    try {
      const invite = await target.createInvite({
        maxAge: 0,
        maxUses: 0,
        unique: true,
        ...(reason === undefined ? {} : { reason }),
      });
      url = invite.url;
    } catch (error) {
      const code = discordErrorCode(error);
      if (code !== undefined && FORBIDDEN_CODES.has(code)) {
        throw new ServiceError(ErrorCode.DISCORD_MISSING_PERMISSIONS, { permission: 'other' });
      }
      throw error;
    }

    await this.recordInviteAudit(id, actor, target.id);
    return { url, channelId: target.id, channelName: target.name };
  }

  private async introChannelId(guildId: string): Promise<string | null> {
    try {
      return (await this.guilds.get(guildId)).introChannelId;
    } catch (error) {
      // A server the bot has never recorded has no intro channel either.
      if (error instanceof ServiceError && error.code === ErrorCode.GUILD_NOT_FOUND) return null;
      throw error;
    }
  }

  /** The invite exists by now; a failed audit row is logged and must not hide it from the person. */
  private async recordInviteAudit(
    guildId: string,
    actor: ActorContext,
    channelId: string,
  ): Promise<void> {
    try {
      await this.audit.record({
        guildId,
        actor,
        action: AUDIT_ACTIONS.inviteCreate,
        params: { channelId },
      });
    } catch (error) {
      this.logger.error(`Invite created but its audit row was not written (${errorLabel(error)})`);
    }
  }
}

function parseSnowflake(value: string): string {
  const parsed = SnowflakeSchema.safeParse(value);
  if (!parsed.success) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
  return parsed.data;
}
