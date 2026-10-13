import { Injectable, Logger } from '@nestjs/common';
import {
  ActivityCreateSchema,
  AUDIT_ACTIONS,
  ErrorCode,
  SnowflakeSchema,
  type ActivityCreateResult,
  type ActorContext,
} from '@sab/shared';
import { ChannelType, Client, type GuildBasedChannel, type Role } from 'discord.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { ServiceError } from '../../common/errors/service-error.js';
import { errorLabel } from '../../prisma/pool-factory.js';
import { GuildConfigService } from '../guild-config/guild-config.service.js';
import { fetchGuild, fetchGuildChannel } from '../../discord/helpers/discord-lookup.js';
import { buildActivityOverwrites } from './activity.overwrites.js';

/**
 * The category the previous bot always used. Servers that never set a default
 * keep getting it, but only where it exists (a server without it has none).
 */
export const LEGACY_ACTIVITY_CATEGORY_ID = '1046973611199697022';

/** Voice channel of an activity: room for a whole event. */
const VOICE_USER_LIMIT = 99;

/**
 * Roles and channels made so far; if a later step fails they are removed again,
 * so a failed command does not leave half an activity behind.
 */
type Created = { roles: Role[]; channels: GuildBasedChannel[] };

/**
 * Sets up what a new activity needs: three roles (`-Event`, `-Multi`, `-MC`)
 * and three channels (general, thread-only, voice) in a category. The slash
 * command, the REST API and the MCP tools all go through here.
 */
@Injectable()
export class ActivityService {
  private readonly logger = new Logger(ActivityService.name);

  constructor(
    private readonly client: Client,
    private readonly audit: AuditService,
    private readonly guilds: GuildConfigService,
  ) {}

  /**
   * The category the channels go in: the one asked for, else the server's
   * default, else the category the previous bot hardcoded when this server has
   * it; `null` when none exists. A server the bot has never recorded simply has
   * no default.
   */
  async resolveCategoryId(guildId: string, requested?: string): Promise<string | null> {
    if (requested !== undefined) return parseSnowflake(requested);
    const configured = await this.configuredCategoryId(guildId);
    if (configured !== null) return configured;
    return (await this.hasLegacyCategory(guildId)) ? LEGACY_ACTIVITY_CATEGORY_ID : null;
  }

  private async configuredCategoryId(guildId: string): Promise<string | null> {
    try {
      return (await this.guilds.get(guildId)).activityCategoryId;
    } catch (error) {
      if (error instanceof ServiceError && error.code === ErrorCode.GUILD_NOT_FOUND) return null;
      throw error;
    }
  }

  /** Whether the old hardcoded category is a category of this server; any lookup refusal means no. */
  private async hasLegacyCategory(guildId: string): Promise<boolean> {
    try {
      const guild = await fetchGuild(this.client, guildId);
      const channel = await fetchGuildChannel(this.client, guild, LEGACY_ACTIVITY_CATEGORY_ID);
      return channel.type === ChannelType.GuildCategory;
    } catch (error) {
      if (error instanceof ServiceError) return false;
      throw error;
    }
  }

  /**
   * Everything is checked before anything is created: the category must exist
   * in this server and be a category. `VALIDATION_FAILED` when there is no
   * category at all.
   */
  async createActivity(
    guildId: string,
    input: unknown,
    actor: ActorContext,
  ): Promise<ActivityCreateResult> {
    const id = parseSnowflake(guildId);
    const parsed = ActivityCreateSchema.safeParse(input);
    if (!parsed.success) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
    const { emoji, name, shortName } = parsed.data;

    const categoryId = await this.resolveCategoryId(id, parsed.data.categoryId);
    if (categoryId === null)
      throw new ServiceError(ErrorCode.VALIDATION_FAILED, { field: 'category' });

    const guild = await fetchGuild(this.client, id);
    const category = await fetchGuildChannel(this.client, guild, categoryId);
    if (category.type !== ChannelType.GuildCategory) {
      throw new ServiceError(ErrorCode.DISCORD_CHANNEL_NOT_FOUND);
    }

    const existing = await guild.roles.fetch();
    const technician = existing.find((role) => role.name.toLowerCase().startsWith('technician'));
    const muted = existing.find((role) => role.name === 'Muted');

    const created: Created = { roles: [], channels: [] };
    try {
      const reason = `Activity ${shortName}`;
      const role = async (suffix: string): Promise<Role> => {
        const made = await guild.roles.create({ name: `${name}-${suffix}`, reason });
        created.roles.push(made);
        return made;
      };
      const eventRole = await role('Event');
      const multiRole = await role('Multi');
      const mcRole = await role('MC');

      const overwrites = buildActivityOverwrites({
        everyoneId: guild.roles.everyone.id,
        technicianId: technician?.id,
        mutedId: muted?.id,
        activityRoleIds: [eventRole.id, multiRole.id, mcRole.id],
      });

      // Same name rule as before: lower case, spaces as dashes.
      const base = `${emoji}┃${name}`.toLowerCase().replaceAll(' ', '-');
      const general = await guild.channels.create({
        name: `${base}-general`,
        topic: `General channel for "${name}" with short name "${shortName}"`,
        type: ChannelType.GuildText,
        parent: categoryId,
        permissionOverwrites: overwrites.text,
        reason,
      });
      created.channels.push(general);
      const threadOnly = await guild.channels.create({
        name: `${base}-thread-only`,
        topic: `Thread only channel for "${name}" with short name "${shortName}"`,
        type: ChannelType.GuildText,
        parent: categoryId,
        permissionOverwrites: overwrites.threadOnly,
        reason,
      });
      created.channels.push(threadOnly);
      const voice = await guild.channels.create({
        name: `${emoji}┃${name} voice`,
        type: ChannelType.GuildVoice,
        parent: categoryId,
        userLimit: VOICE_USER_LIMIT,
        permissionOverwrites: overwrites.voice,
        reason,
      });
      created.channels.push(voice);

      const result: ActivityCreateResult = {
        categoryId,
        roles: { event: eventRole.id, multi: multiRole.id, mc: mcRole.id },
        channels: { general: general.id, threadOnly: threadOnly.id, voice: voice.id },
      };
      await this.recordAudit(id, actor, result);
      return result;
    } catch (error) {
      await this.undo(created);
      throw error;
    }
  }

  /** Removes what a failed run made; one that cannot be removed is logged and left for a person. */
  private async undo(created: Created): Promise<void> {
    const removals = [...created.channels, ...created.roles].map((item) =>
      item.delete('Activity setup failed'),
    );
    for (const outcome of await Promise.allSettled(removals)) {
      if (outcome.status === 'rejected') {
        this.logger.error(
          `Could not remove a leftover of a failed activity (${errorLabel(outcome.reason)})`,
        );
      }
    }
  }

  /** The trail is best effort: the activity exists by now and the person must be told so. */
  private async recordAudit(
    guildId: string,
    actor: ActorContext,
    result: ActivityCreateResult,
  ): Promise<void> {
    try {
      await this.audit.record({
        guildId,
        actor,
        action: AUDIT_ACTIONS.activityCreate,
        params: {
          targetId: result.categoryId,
          roleId: Object.values(result.roles),
          channelId: Object.values(result.channels),
        },
      });
    } catch (error) {
      this.logger.error(
        `Activity created but its audit row was not written (${errorLabel(error)})`,
      );
    }
  }
}

function parseSnowflake(value: string): string {
  const parsed = SnowflakeSchema.safeParse(value);
  if (!parsed.success) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
  return parsed.data;
}
