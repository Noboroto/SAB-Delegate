import { Injectable, Logger } from '@nestjs/common';
import {
  AUDIT_ACTIONS,
  ErrorCode,
  ROLE_ASSIGN_SAMPLE_SIZE,
  RoleAssignMembersInputSchema,
  RoleAssignReactorsInputSchema,
  SnowflakeSchema,
  type ActorContext,
  type RoleAssignFailure,
  type RoleAssignResult,
} from '@sab/shared';
import { Client, type Guild, type GuildMember, type Role } from 'discord.js';
import pLimit from 'p-limit';
import { AuditService } from '../../common/audit/audit.service.js';
import { ServiceError } from '../../common/errors/service-error.js';
import { discordRefusal } from '../../discord/helpers/discord-failure.js';
import { fetchGuildMembers } from '../../discord/helpers/guild-members.js';
import { assertInGuild, requireMessage } from '../../discord/helpers/message-target.js';
import { discordErrorCode } from '../../discord/helpers/reply.js';
import { DiscordReactionService } from '../../discord/services/discord-reaction.service.js';
import { MessageResolver } from '../../discord/services/message-resolver.service.js';
import { errorLabel } from '../../prisma/pool-factory.js';

type ApplyOptions = {
  /** Work out who would be changed; change nobody and audit nothing. */
  dryRun?: boolean;
  /**
   * Allow the message that is read for reactors to be in another server.
   * Only the slash commands set it: the bot follows links across servers on
   * purpose, whereas an API caller may not read outside the server it was given.
   */
  crossGuild?: boolean;
};

/**
 * Role edits in flight at once. Discord queues the requests per route and
 * waits out a rate limit, so more would not be faster; fewer would make a
 * hundred-member list take minutes.
 */
const ROLE_EDIT_CONCURRENCY = 5;

/** Unknown Guild, Missing Access: the bot is not in (or cannot see) the server. */
const BOT_NOT_IN_GUILD_CODES: ReadonlySet<number> = new Set([10004, 50001]);

const UNKNOWN_REASON = 'Unknown error';

type Plan = {
  readonly ids: readonly string[];
  readonly roleId: string;
  readonly remove: boolean;
  /** What the audit row says about where the ids came from. */
  readonly auditParams: Record<string, unknown>;
};

function parseGuild(guildId: string): string {
  const parsed = SnowflakeSchema.safeParse(guildId);
  if (!parsed.success) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
  return parsed.data;
}

/**
 * Gives or takes one role for many members at once: a list of ids, the holders
 * of another role, or everyone who reacted to a message. The slash commands,
 * the API and the MCP tools all go through here. Ids that are not members of
 * the server are left out without a word, as they always were.
 */
@Injectable()
export class RoleAssignService {
  private readonly logger = new Logger(RoleAssignService.name);

  constructor(
    private readonly client: Client,
    private readonly resolver: MessageResolver,
    private readonly reactions: DiscordReactionService,
    private readonly audit: AuditService,
  ) {}

  /** `userIds` plus, when `membersOfRoleId` is given, everyone who holds that role. */
  async applyToMembers(
    guildId: string,
    input: unknown,
    actor: ActorContext,
    opts: ApplyOptions = {},
  ): Promise<RoleAssignResult> {
    const id = parseGuild(guildId);
    const parsed = RoleAssignMembersInputSchema.safeParse(input);
    if (!parsed.success) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
    const { roleId, userIds, membersOfRoleId, remove } = parsed.data;

    const guild = await this.fetchGuild(id);
    const ids = new Set(userIds);
    if (membersOfRoleId !== undefined) {
      const holders = await fetchGuildMembers(guild);
      for (const member of holders.values()) {
        if (member.roles.cache.has(membersOfRoleId)) ids.add(member.id);
      }
    }
    const auditParams = membersOfRoleId === undefined ? {} : { targetId: membersOfRoleId };
    return this.apply(guild, { ids: [...ids], roleId, remove, auditParams }, actor, opts);
  }

  /** Everyone (not a bot) who reacted to the message with `emoji`. */
  async applyToReactors(
    guildId: string,
    input: unknown,
    actor: ActorContext,
    opts: ApplyOptions = {},
  ): Promise<RoleAssignResult> {
    const id = parseGuild(guildId);
    const parsed = RoleAssignReactorsInputSchema.safeParse(input);
    if (!parsed.success) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
    const { roleId, emoji, remove } = parsed.data;

    const guild = await this.fetchGuild(id);
    const message = await requireMessage(this.resolver, parsed.data);
    if (opts.crossGuild !== true) assertInGuild(message, id);

    const reactorIds = await this.reactions.fetchReactorIds(message, emoji);
    if (reactorIds.length === 0) {
      return {
        dryRun: opts.dryRun === true,
        status: 'NO_REACTORS',
        planned: 0,
        done: 0,
        skipped: 0,
        sample: [],
        failures: [],
      };
    }
    const auditParams = { channelId: message.channelId, messageId: message.id, emoji };
    return this.apply(guild, { ids: reactorIds, roleId, remove, auditParams }, actor, opts);
  }

  private async apply(
    guild: Guild,
    plan: Plan,
    actor: ActorContext,
    opts: ApplyOptions,
  ): Promise<RoleAssignResult> {
    const role = await this.fetchRole(guild, plan.roleId);
    // The cache holds only the members seen so far; the full list needs a fetch,
    // shared with the holders lookup above so a big server is paged once.
    const members = await fetchGuildMembers(guild);
    const targets = plan.ids.flatMap((id) => {
      const member = members.get(id);
      return member === undefined ? [] : [member];
    });
    const skipped = plan.ids.length - targets.length;
    const sample = targets.slice(0, ROLE_ASSIGN_SAMPLE_SIZE).map((member) => member.id);

    if (opts.dryRun === true) {
      return {
        dryRun: true,
        status: 'OK',
        planned: targets.length,
        done: 0,
        skipped,
        sample,
        failures: [],
      };
    }

    const failures = await this.edit(targets, role, plan.remove);
    const done = targets.length - failures.length;

    if (targets.length > 0) {
      await this.record(guild.id, actor, plan, {
        done,
        planned: targets.length,
        skipped,
        failures,
      });
    }
    return {
      dryRun: false,
      status: 'OK',
      planned: targets.length,
      done,
      skipped,
      sample,
      failures,
    };
  }

  /** One failure never hides the others; only successes are counted. */
  private async edit(
    members: readonly GuildMember[],
    role: Role,
    remove: boolean,
  ): Promise<RoleAssignFailure[]> {
    const outcomes = await pLimit(ROLE_EDIT_CONCURRENCY).map(
      members,
      async (member): Promise<RoleAssignFailure | null> => {
        try {
          if (remove) await member.roles.remove(role);
          else await member.roles.add(role);
          return null;
        } catch (error) {
          const reason = discordRefusal(error);
          if (reason === undefined) {
            this.logger.warn(`Role edit failed for a member (${errorLabel(error)})`);
          }
          return {
            userId: member.id,
            name: member.user.username.slice(0, 100),
            reason: reason ?? UNKNOWN_REASON,
          };
        }
      },
    );
    return outcomes.filter((outcome): outcome is RoleAssignFailure => outcome !== null);
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

  private async fetchRole(guild: Guild, roleId: string): Promise<Role> {
    const role = guild.roles.cache.get(roleId) ?? (await guild.roles.fetch(roleId));
    // A role that is not in the server is a bad value, not a missing server.
    if (role === null) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
    return role;
  }

  /**
   * The audit row follows the edits and a failure to write it must not turn
   * roles that were changed into an error for the person who changed them.
   */
  private async record(
    guildId: string,
    actor: ActorContext,
    plan: Plan,
    outcome: { done: number; planned: number; skipped: number; failures: readonly unknown[] },
  ): Promise<void> {
    const failed = outcome.failures.length;
    try {
      await this.audit.record({
        guildId,
        actor,
        action: AUDIT_ACTIONS.roleAssignApply,
        params: {
          ...plan.auditParams,
          roleId: plan.roleId,
          mode: plan.remove ? 'remove' : 'add',
          count: outcome.done,
          total: outcome.planned,
          skipped: outcome.skipped,
          failed,
        },
        ...(outcome.done === 0 && failed > 0 ? { ok: false, error: 'DISCORD_API_ERROR' } : {}),
      });
    } catch (error) {
      this.logger.warn(`Could not audit a role assignment (${errorLabel(error)})`);
    }
  }
}
