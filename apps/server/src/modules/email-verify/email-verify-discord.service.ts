import { Injectable, Logger } from '@nestjs/common';
import {
  AUDIT_ACTIONS,
  EmailVerifyButtonInputSchema,
  ErrorCode,
  type ActorContext,
  type EmailVerifyButtonResult,
} from '@sab/shared';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  type Guild,
  type GuildMember,
} from 'discord.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { ServiceError } from '../../common/errors/service-error.js';
import {
  discordRefusal,
  failureLabel,
  failureReason,
} from '../../discord/helpers/discord-failure.js';
import { discordErrorCode } from '../../discord/helpers/reply.js';
import { ChannelAccessService } from '../../discord/services/channel-access.service.js';
import { GuildLocaleService } from '../../i18n/guild-locale.service.js';
import { translatorFor } from '../../i18n/translator.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { emailVerifyCustomId } from './email-verify.ids.js';
import { parseGuildId } from './email-verify-data.js';

/** Unknown Member: the user left the server (or never was in it). */
const UNKNOWN_MEMBER = 10007;
/** Unknown Guild, Missing Access: the bot is not in (or cannot see) the server. */
const BOT_NOT_IN_GUILD_CODES: ReadonlySet<number> = new Set([10004, 50001]);
const MESSAGE_MAX = 2000;
const REASON = 'Email verification';
/** Members asked for in one gateway request; Discord allows a hundred. */
const MEMBER_CHUNK = 100;
/** Members one REST page of the server's member list holds, at most. */
const MEMBER_PAGE = 1_000;

/** What happened to the roles of one member. Never thrown: a refusal is a result the caller reports. */
export type GrantResult = {
  /** Roles that were given now (not those the member already had). */
  added: string[];
  /** Roles that were taken away now. */
  removed: string[];
  /** Roles that could not be given or taken away: Discord refused, or the member could not be reached. */
  refused: string[];
  /** Discord's own words for what went wrong (a role above the bot's, a missing permission), else `null`. */
  failure: string | null;
  /** The member is no longer in the server: nothing could be changed. */
  memberGone: boolean;
};

/** A member as the server knows them now. */
type MemberInfo = {
  username: string;
  displayName: string;
  roleIds: string[];
  roleNames: string[];
};

/**
 * Everything of email verification that talks to Discord: roles, the log
 * channel, the verify button and member names. Called after the database
 * change has committed, never inside a transaction.
 */
@Injectable()
export class EmailVerifyDiscordService {
  private readonly logger = new Logger(EmailVerifyDiscordService.name);

  constructor(
    private readonly client: Client,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly channelAccess: ChannelAccessService,
    private readonly locales: GuildLocaleService,
  ) {}

  /** The language of the server's replies and mails. */
  locale(guildId: string): Promise<string> {
    return this.locales.resolve(guildId);
  }

  /** The server's name for a mail or a message; its id when nothing better is known. */
  async guildName(guildId: string): Promise<string> {
    const cached = this.client.guilds.cache.get(guildId)?.name;
    if (cached !== undefined) return cached;
    const row = await this.prisma.guild.findUnique({
      where: { discordId: guildId },
      select: { name: true },
    });
    return row?.name ?? guildId;
  }

  /**
   * Gives and takes roles, one role per call: for a single role discord.js
   * uses the idempotent PUT/DELETE of that role, while an array makes it
   * PATCH the member's whole role list, which overwrites a role another bot
   * or moderator changed a moment earlier. A role that no longer exists, or
   * that the member has (or lacks) already, is left out. Roles are given
   * first and taken away after, and nothing is taken away when every role to
   * give was refused (a member must not lose the "unverified" role while
   * getting nothing in return). A refusal is reported in `refused` and
   * `failure`, never thrown; so is any other failure after it was logged
   * (without the member's data): the database change this follows has
   * committed, so the caller must still be able to report it.
   */
  async grantRoles(
    guildId: string,
    userId: string,
    plan: { add: readonly string[]; remove?: readonly string[] },
  ): Promise<GrantResult> {
    const result: GrantResult = {
      added: [],
      removed: [],
      refused: [],
      failure: null,
      memberGone: false,
    };
    const reasons = new Set<string>();
    const refuse = (roleIds: readonly string[], error: unknown) => {
      this.logger.warn(`Changing the roles of a member failed (${failureLabel(error)})`);
      result.refused.push(...roleIds);
      reasons.add(discordRefusal(error) ?? failureReason(error));
    };
    try {
      const guild = await this.fetchGuild(parseGuildId(guildId));
      let member: GuildMember;
      try {
        member = await guild.members.fetch(userId);
      } catch (error) {
        if (discordErrorCode(error) === UNKNOWN_MEMBER) return { ...result, memberGone: true };
        throw error;
      }
      const add = [...new Set(plan.add)].filter(
        (id) => guild.roles.cache.has(id) && !member.roles.cache.has(id),
      );
      const remove = [...new Set(plan.remove ?? [])].filter(
        (id) => guild.roles.cache.has(id) && member.roles.cache.has(id) && !add.includes(id),
      );
      for (const roleId of add) {
        try {
          await member.roles.add(roleId, REASON);
          result.added.push(roleId);
        } catch (error) {
          refuse([roleId], error);
        }
      }
      const nothingGiven = add.length > 0 && result.added.length === 0;
      for (const roleId of nothingGiven ? [] : remove) {
        try {
          await member.roles.remove(roleId, REASON);
          result.removed.push(roleId);
        } catch (error) {
          refuse([roleId], error);
        }
      }
    } catch (error) {
      refuse(
        plan.add.filter((id) => !result.added.includes(id)),
        error,
      );
    }
    result.failure = reasons.size === 0 ? null : [...reasons].join('; ');
    return result;
  }

  /**
   * One line in the server's log channel, if it has one. Mentions are muted.
   * Never throws: a log that cannot be posted must not undo a verification.
   */
  async postLog(guildId: string, content: string): Promise<void> {
    try {
      const config = await this.prisma.emailVerifyConfig.findFirst({
        where: { guild: { discordId: guildId } },
        select: { logChannelId: true },
      });
      if (config?.logChannelId == null) return;
      const channel = await this.client.channels.fetch(config.logChannelId);
      if (channel === null || !channel.isSendable()) return;
      await channel.send({
        content: content.slice(0, MESSAGE_MAX),
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      this.logger.warn(`Posting to the verification log failed (${failureLabel(error)})`);
    }
  }

  /**
   * Posts the message with the verify button in a channel of the server. The
   * text is the given one, else the server's own, else the built-in one.
   */
  async postButton(
    guildId: string,
    input: unknown,
    actor: ActorContext,
  ): Promise<EmailVerifyButtonResult> {
    const id = parseGuildId(guildId);
    const parsed = EmailVerifyButtonInputSchema.safeParse(input);
    if (!parsed.success) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
    const { channelId, title, message, buttonText } = parsed.data;

    const access = await this.channelAccess.check(channelId, 'send', id);
    if (access === 'not-found') throw new ServiceError(ErrorCode.DISCORD_CHANNEL_NOT_FOUND);
    if (access !== 'ok') {
      throw new ServiceError(ErrorCode.DISCORD_MISSING_PERMISSIONS, { permission: 'send' });
    }
    const [locale, config] = await Promise.all([
      this.locales.resolve(id),
      this.prisma.emailVerifyConfig.findFirst({
        where: { guild: { discordId: id } },
        select: { verifyMessage: true },
      }),
    ]);
    const t = translatorFor(locale);
    const embed = new EmbedBuilder()
      .setTitle(title ?? t('email-verify.verify.panel.title'))
      .setDescription(message ?? config?.verifyMessage ?? t('email-verify.verify.panel.message'));
    const button = new ButtonBuilder()
      .setCustomId(emailVerifyCustomId('start', id))
      .setLabel(buttonText ?? t('email-verify.verify.panel.button'))
      .setStyle(ButtonStyle.Primary);

    let sent;
    try {
      const channel = await this.client.channels.fetch(channelId);
      if (channel === null || !channel.isSendable()) {
        throw new ServiceError(ErrorCode.DISCORD_CHANNEL_NOT_FOUND);
      }
      sent = await channel.send({
        embeds: [embed],
        components: [new ActionRowBuilder<ButtonBuilder>().addComponents(button)],
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      if (discordRefusal(error) === undefined) throw error;
      throw new ServiceError(ErrorCode.DISCORD_MISSING_PERMISSIONS, { permission: 'send' });
    }
    await this.audit.record({
      guildId: id,
      actor,
      action: AUDIT_ACTIONS.emailVerifyButtonPost,
      params: { channelId, messageId: sent.id },
    });
    return { channelId, messageId: sent.id };
  }

  /**
   * Username, name in the server and roles of each member of `userIds` who is
   * still in the server; the others are left out of the map. Members not in
   * the cache are asked for in groups of a hundred; a group that fails is
   * logged and its members left out.
   */
  async lookupMembers(
    guildId: string,
    userIds: readonly string[],
  ): Promise<Map<string, MemberInfo>> {
    const found = new Map<string, MemberInfo>();
    if (userIds.length === 0) return found;
    const guild = await this.fetchGuild(parseGuildId(guildId));
    const missing: string[] = [];
    for (const userId of userIds) {
      const cached = guild.members.cache.get(userId);
      if (cached === undefined) missing.push(userId);
      else found.set(userId, describe(guild, cached));
    }
    for (let start = 0; start < missing.length; start += MEMBER_CHUNK) {
      try {
        const members = await guild.members.fetch({
          user: missing.slice(start, start + MEMBER_CHUNK),
        });
        for (const member of members.values()) found.set(member.id, describe(guild, member));
      } catch (error) {
        this.logger.warn(
          `Fetching members for the verification list failed (${failureLabel(error)})`,
        );
      }
    }
    return found;
  }

  /**
   * Like `lookupMembers` for a long list (an export): instead of one gateway
   * request per hundred members, which Discord rate-limits hard, it reads the
   * server's member list over REST a thousand at a time, without caching what
   * it reads, and stops as soon as every wanted member is found. `unresolved`
   * counts the wanted members that were not found (they left, or a page could
   * not be read), so the caller can say the file is incomplete.
   */
  async lookupManyMembers(
    guildId: string,
    userIds: readonly string[],
  ): Promise<{ found: Map<string, MemberInfo>; unresolved: number }> {
    const wanted = new Set(userIds);
    const found = new Map<string, MemberInfo>();
    if (wanted.size === 0) return { found, unresolved: 0 };
    const guild = await this.fetchGuild(parseGuildId(guildId));
    for (const id of wanted) {
      const cached = guild.members.cache.get(id);
      if (cached !== undefined) found.set(id, describe(guild, cached));
    }
    let after: string | undefined;
    // A page is full while members remain; the cap only guards a list that never shrinks.
    const pagesMax = Math.ceil(Math.max(guild.memberCount, wanted.size) / MEMBER_PAGE) + 2;
    for (let page = 0; page < pagesMax && found.size < wanted.size; page += 1) {
      let members;
      try {
        members = await guild.members.list({
          limit: MEMBER_PAGE,
          cache: false,
          ...(after ? { after } : {}),
        });
      } catch (error) {
        this.logger.warn(`Reading the member list for an export failed (${failureLabel(error)})`);
        break;
      }
      for (const member of members.values()) {
        if (wanted.has(member.id)) found.set(member.id, describe(guild, member));
      }
      const last = members.lastKey();
      if (members.size < MEMBER_PAGE || last === undefined) break;
      after = last;
    }
    return { found, unresolved: wanted.size - found.size };
  }

  private async fetchGuild(guildId: string): Promise<Guild> {
    try {
      return await this.client.guilds.fetch(guildId);
    } catch (error) {
      const code = discordErrorCode(error);
      if (code !== undefined && BOT_NOT_IN_GUILD_CODES.has(code)) {
        throw new ServiceError(ErrorCode.GUILD_BOT_MISSING);
      }
      throw error;
    }
  }
}

function describe(guild: Guild, member: GuildMember): MemberInfo {
  const roles = member.roles.cache.filter((role) => role.id !== guild.id);
  return {
    username: member.user.username,
    displayName: member.displayName,
    roleIds: [...roles.keys()],
    roleNames: roles.map((role) => role.name),
  };
}
