import { Injectable } from '@nestjs/common';
import { ErrorCode, SnowflakeSchema, canManageGuild } from '@sab/shared';
import { Client } from 'discord.js';
import { LRUCache } from 'lru-cache';
import { discordErrorCode } from '../../discord/helpers/reply.js';
import { ServiceError } from '../errors/service-error.js';

/** Upper bound on remembered (guild, user) pairs; a flood of new keys evicts the oldest. */
export const GUILD_ACCESS_CACHE_MAX = 5000;
/** How long "may manage" is trusted for reads; the longest a revoked right keeps working. */
export const GUILD_ACCESS_ALLOW_TTL_MS = 30_000;
/** Refusals are remembered only briefly: enough to absorb a retry loop, short enough not to lock out a user who was just promoted. */
export const GUILD_ACCESS_DENY_TTL_MS = 5_000;

/** Unknown Member (not in the guild), Unknown User, Unknown Guild. */
const NOT_A_MEMBER_CODES: ReadonlySet<number> = new Set([10007, 10013, 10004]);

/**
 * The one answer for "no such server for you": the bot is not in it, the user
 * is not in it, or the user may not manage it. A single error keeps a caller
 * from probing which servers the bot has joined.
 */
export class GuildNotFoundError extends ServiceError {
  constructor() {
    super(ErrorCode.GUILD_NOT_FOUND);
    this.name = 'GuildNotFoundError';
  }
}

type GuildAccessOptions = {
  /**
   * Skip the cached "allowed" answer and ask Discord. Every write passes this,
   * so a revoked Manage Server stops mutations at once; reads may lag by
   * `GUILD_ACCESS_ALLOW_TTL_MS`.
   */
  fresh?: boolean;
};

/**
 * Whether a Discord user may manage a guild the bot is in, judged by the
 * member's current permissions on Discord's side, never by what the browser or
 * an API key claims. For the HTTP/MCP layer and for background jobs that must
 * re-check the person who created them; slash commands do not use it.
 */
@Injectable()
export class GuildAccessService {
  private readonly cache = new LRUCache<string, boolean>({
    max: GUILD_ACCESS_CACHE_MAX,
    ttl: GUILD_ACCESS_ALLOW_TTL_MS,
    // lru-cache binds the global clock once, at import; reading it per call is
    // still monotonic and lets a replaced clock (fake timers) take effect.
    perf: { now: () => performance.now() },
  });
  /** Concurrent checks for one pair share a single Discord request. */
  private readonly inFlight = new Map<string, Promise<boolean>>();

  constructor(private readonly client: Client) {}

  /** Number of remembered answers; never above `GUILD_ACCESS_CACHE_MAX`. */
  get cacheSize(): number {
    return this.cache.size;
  }

  async canManage(
    userId: string,
    guildId: string,
    { fresh = false }: GuildAccessOptions = {},
  ): Promise<boolean> {
    // Ids reach Discord's REST paths; refuse anything that is not a snowflake.
    if (!SnowflakeSchema.safeParse(userId).success || !SnowflakeSchema.safeParse(guildId).success) {
      return false;
    }
    const key = `${guildId}:${userId}`;

    const cached = this.cache.get(key);
    if (cached !== undefined && (!fresh || !cached)) return cached;

    const running = this.inFlight.get(key);
    if (running !== undefined) return running;

    const pending = this.lookup(userId, guildId).then((allowed) => {
      this.cache.set(key, allowed, {
        ttl: allowed ? GUILD_ACCESS_ALLOW_TTL_MS : GUILD_ACCESS_DENY_TTL_MS,
      });
      return allowed;
    });
    this.inFlight.set(key, pending);
    const release = (): void => {
      if (this.inFlight.get(key) === pending) this.inFlight.delete(key);
    };
    void pending.then(release, release);
    return pending;
  }

  /** Resolves when the user may manage the guild; throws `GuildNotFoundError` otherwise. */
  async assertManageGuild(
    userId: string,
    guildId: string,
    options: GuildAccessOptions = {},
  ): Promise<void> {
    if (!(await this.canManage(userId, guildId, options))) throw new GuildNotFoundError();
  }

  /** Asks Discord. Failures other than "not a member" are thrown and never cached. */
  private async lookup(userId: string, guildId: string): Promise<boolean> {
    const guild = this.client.guilds.cache.get(guildId);
    if (guild === undefined) return false;

    try {
      // `force` reads the member from the API: the cache can trail a role change.
      const member = await guild.members.fetch({ user: userId, force: true });
      return canManageGuild({
        permissions: member.permissions.bitfield.toString(),
        isOwner: guild.ownerId === userId,
      });
    } catch (error) {
      const code = discordErrorCode(error);
      if (code !== undefined && NOT_A_MEMBER_CODES.has(code)) return false;
      throw error;
    }
  }
}
