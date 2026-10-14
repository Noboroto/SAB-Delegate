import { Injectable, Logger } from '@nestjs/common';
import {
  AUDIT_ACTIONS,
  BOT_AVATAR_MAX_BYTES,
  BotProfileSchema,
  BotProfileSetRequestSchema,
  ErrorCode,
  SnowflakeSchema,
  type ActorContext,
  type BotProfile,
  type BotProfileSetResult,
} from '@sab/shared';
import { Client, DiscordAPIError, type Guild } from 'discord.js';
import { LRUCache } from 'lru-cache';
import { AuditService } from '../../common/audit/audit.service.js';
import { ServiceError } from '../../common/errors/service-error.js';
import { toServiceError } from '../../discord/helpers/discord-failure.js';
import { fetchGuild } from '../../discord/helpers/discord-lookup.js';
import { errorLabel } from '../../prisma/pool-factory.js';

/**
 * Discord refuses a second avatar change for the same bot within about a
 * minute, answering 400 / 50035 `AVATAR_RATE_LIMIT` (not a 429, no retry-after)
 * and rejecting the whole request. Waiting this long before asking again
 * spares the call; the answer from Discord still wins when it comes anyway.
 */
const AVATAR_COOLDOWN_MS = 60_000;

const COOLDOWN_MAX_GUILDS = 1_000;
const INVALID_FORM_BODY = 50035;

type SetOptions = { dryRun?: boolean };

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];
const GIF87 = [0x47, 0x49, 0x46, 0x38, 0x37, 0x61];
const GIF89 = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61];

const startsWith = (bytes: Buffer, signature: readonly number[]): boolean =>
  signature.every((byte, index) => bytes[index] === byte);

/** The picture format by its first bytes; the declared type of a file is not trusted. */
function imageMime(bytes: Buffer): 'image/png' | 'image/jpeg' | 'image/gif' | null {
  if (startsWith(bytes, PNG)) return 'image/png';
  if (startsWith(bytes, JPEG)) return 'image/jpeg';
  if (startsWith(bytes, GIF87) || startsWith(bytes, GIF89)) return 'image/gif';
  return null;
}

function isAvatarRateLimit(error: unknown): boolean {
  return (
    error instanceof DiscordAPIError &&
    error.code === INVALID_FORM_BODY &&
    JSON.stringify(error.rawError).includes('AVATAR_RATE_LIMIT')
  );
}

/** A data URI of the checked picture, or a `VALIDATION_FAILED` for bytes that are not an accepted image. */
function avatarDataUri(base64: string): string {
  const bytes = Buffer.from(base64, 'base64');
  const mime = imageMime(bytes);
  if (bytes.length === 0 || bytes.length > BOT_AVATAR_MAX_BYTES || mime === null) {
    throw new ServiceError(ErrorCode.VALIDATION_FAILED);
  }
  return `data:${mime};base64,${bytes.toString('base64')}`;
}

/**
 * How the bot looks in one server: its nickname and its server avatar. The
 * dashboard and the MCP tools both go through here. The caller sends the
 * picture itself, never an address, so the server fetches nothing a caller
 * chose.
 */
@Injectable()
export class BotProfileService {
  private readonly logger = new Logger(BotProfileService.name);
  /** Servers whose avatar changed a moment ago; a flood of new ids evicts the oldest. */
  private readonly avatarCooldown = new LRUCache<string, true>({
    max: COOLDOWN_MAX_GUILDS,
    ttl: AVATAR_COOLDOWN_MS,
    // lru-cache binds the global clock once, at import; reading it per call
    // lets a replaced clock (fake timers) take effect.
    perf: { now: () => performance.now() },
  });

  constructor(
    private readonly client: Client,
    private readonly audit: AuditService,
  ) {}

  /** `GUILD_BOT_MISSING` when the bot is not in the server. */
  async getBotProfile(guildId: string): Promise<BotProfile> {
    return this.readProfile(await fetchGuild(this.client, this.parseGuildId(guildId)));
  }

  /**
   * Changes the nickname and/or the avatar. Discord takes them as two
   * separate requests (an avatar refused for rate limiting would otherwise
   * take the nickname down with it), the nickname first. With `dryRun` the
   * input is checked and nothing is sent. A change that Discord accepted
   * before a later one failed stays in place.
   */
  async setBotProfile(
    guildId: string,
    input: unknown,
    actor: ActorContext,
    opts: SetOptions = {},
  ): Promise<BotProfileSetResult> {
    const id = this.parseGuildId(guildId);
    const parsed = BotProfileSetRequestSchema.safeParse(input);
    if (!parsed.success) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
    const { nick, avatar } = parsed.data;
    const picture = avatar === undefined ? undefined : avatarDataUri(avatar);
    const changes: Array<'nick' | 'avatar'> = [
      ...(nick === undefined ? [] : (['nick'] as const)),
      ...(picture === undefined ? [] : (['avatar'] as const)),
    ];

    if (picture !== undefined && this.avatarCooldown.has(id)) {
      throw new ServiceError(ErrorCode.RATE_LIMITED);
    }
    const guild = await fetchGuild(this.client, id);
    if (opts.dryRun === true) {
      return { dryRun: true, changes, profile: await this.readProfile(guild) };
    }

    if (nick !== undefined) {
      await this.edit(guild, { nick });
      await this.record(id, actor, 'nick');
    }
    if (picture !== undefined) {
      try {
        await this.edit(guild, { avatar: picture });
      } catch (error) {
        if (error instanceof ServiceError && error.code === ErrorCode.RATE_LIMITED) {
          this.avatarCooldown.set(id, true);
        }
        throw error;
      }
      this.avatarCooldown.set(id, true);
      await this.record(id, actor, 'avatar');
    }
    return { dryRun: false, changes, profile: await this.readProfile(guild) };
  }

  private async edit(
    guild: Guild,
    change: { nick: string | null } | { avatar: string },
  ): Promise<void> {
    try {
      await guild.members.editMe(change);
    } catch (error) {
      if (isAvatarRateLimit(error)) throw new ServiceError(ErrorCode.RATE_LIMITED);
      throw toServiceError(error);
    }
  }

  private async readProfile(guild: Guild): Promise<BotProfile> {
    let me;
    try {
      me = await guild.members.fetchMe();
    } catch (error) {
      throw toServiceError(error);
    }
    return BotProfileSchema.parse({ nick: me.nickname, avatarUrl: me.avatarURL({ size: 256 }) });
  }

  /** The change is already on Discord, so a failed audit write is logged rather than reported as a failed change. */
  private async record(guildId: string, actor: ActorContext, kind: 'nick' | 'avatar') {
    try {
      await this.audit.record({
        guildId,
        actor,
        action: AUDIT_ACTIONS.botProfileUpdate,
        params: { kind },
      });
    } catch (error) {
      this.logger.error(`Audit write failed after a bot profile change (${errorLabel(error)})`);
    }
  }

  private parseGuildId(guildId: string): string {
    const parsed = SnowflakeSchema.safeParse(guildId);
    if (!parsed.success) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
    return parsed.data;
  }
}
