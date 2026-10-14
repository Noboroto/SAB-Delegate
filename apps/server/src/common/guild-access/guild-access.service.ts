import { Injectable } from '@nestjs/common';
import { ErrorCode, SnowflakeSchema, canManageGuild, type GuildPickerItem } from '@sab/shared';
import { Client } from 'discord.js';
import { LRUCache } from 'lru-cache';
import { discordErrorCode } from '../../discord/helpers/reply.js';
import { ServiceError } from '../errors/service-error.js';
import { UserGuildsClient } from './user-guilds.client.js';

/** Upper bound on remembered (guild, user) pairs; a flood of new keys evicts the oldest. */
export const GUILD_ACCESS_CACHE_MAX = 5000;
/** How long "may manage" is trusted for reads; the longest a revoked right keeps working. */
export const GUILD_ACCESS_ALLOW_TTL_MS = 30_000;
/** Refusals are remembered only briefly: enough to absorb a retry loop, short enough not to lock out a user who was just promoted. */
export const GUILD_ACCESS_DENY_TTL_MS = 5_000;

/** Remembered server lists (one per person); a flood of new people evicts the oldest. */
const USER_GUILDS_CACHE_MAX = 1000;

/**
 * How long an infrastructure failure (Discord rate limit or outage, network)
 * is replayed to callers instead of asking Discord again. Short: it only has
 * to stop a retry loop from turning one outage into a flood of REST calls.
 */
export const GUILD_ACCESS_FAILURE_TTL_MS = 2_000;

/** Unknown Member (not in the guild), Unknown User, Unknown Guild. */
const NOT_A_MEMBER_CODES: ReadonlySet<number> = new Set([10007, 10013, 10004]);

const NETWORK_ERROR_NAMES: ReadonlySet<string> = new Set([
  'RateLimitError',
  'HTTPError',
  'AbortError',
  'TimeoutError',
]);

/**
 * Discord rate limiting (429), a Discord outage (5xx), or the request never
 * completing. Not "the answer is no": the caller has to see a server error.
 */
export function isInfrastructureError(error: unknown): error is Error {
  if (!(error instanceof Error)) return false;
  const { status, code, name } = error as { status?: unknown; code?: unknown; name?: unknown };
  if (typeof status === 'number') return status === 429 || status >= 500;
  if (typeof name === 'string' && NETWORK_ERROR_NAMES.has(name)) return true;
  // Node's fetch reports a dropped connection as `TypeError: fetch failed`, and
  // socket errors carry a string code such as ECONNRESET or UND_ERR_SOCKET.
  if (typeof code === 'string' && /^(E[A-Z]+|UND_ERR\w*)$/.test(code)) return true;
  return error instanceof TypeError && error.message === 'fetch failed';
}

/**
 * The one answer for "no such server for you": the bot is not in it, the user
 * is not in it, or the user may not manage it. These three share a single
 * error (and a single message) so a caller cannot probe which servers the bot
 * has joined. Infrastructure failures are deliberately not part of it: they
 * keep their own error class so the caller reports a server error instead of
 * telling someone they have no access.
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
  /** Infrastructure failures, replayed for a moment so a retry loop does not hammer REST. */
  private readonly failures = new LRUCache<string, Error>({
    max: GUILD_ACCESS_CACHE_MAX,
    ttl: GUILD_ACCESS_FAILURE_TTL_MS,
    perf: { now: () => performance.now() },
  });
  /** Concurrent checks for one pair share a single Discord request. */
  private readonly inFlight = new Map<string, Promise<boolean>>();
  /**
   * A person's OAuth server list for the picker. Kept as long as an allowed
   * answer, so reloading the picker does not ask Discord each time; only a
   * convenience filter, the guard still checks every request.
   */
  private readonly userGuilds = new LRUCache<string, GuildPickerItem[]>({
    max: USER_GUILDS_CACHE_MAX,
    ttl: GUILD_ACCESS_ALLOW_TTL_MS,
    perf: { now: () => performance.now() },
  });
  private readonly userGuildsInFlight = new Map<string, Promise<GuildPickerItem[]>>();

  constructor(
    private readonly client: Client,
    private readonly oauthGuilds: UserGuildsClient,
  ) {}

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

    const recentFailure = this.failures.get(key);
    if (recentFailure !== undefined) throw recentFailure;

    const running = this.inFlight.get(key);
    if (running !== undefined) return running;

    const pending = this.lookup(userId, guildId).then(
      (allowed) => {
        this.cache.set(key, allowed, {
          ttl: allowed ? GUILD_ACCESS_ALLOW_TTL_MS : GUILD_ACCESS_DENY_TTL_MS,
        });
        return allowed;
      },
      (error: unknown) => {
        if (isInfrastructureError(error)) {
          this.failures.set(key, error);
        }
        throw error;
      },
    );
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

  /**
   * The servers for the picker: the ones the person may manage (from Discord's
   * list for their login, with permission bits) that the bot is also in. No
   * request goes through the bot, so a person in many servers cannot spend the
   * bot's REST budget. Failures of the OAuth call are thrown as they are.
   */
  async listManageableGuilds(userId: string, accessToken: string): Promise<GuildPickerItem[]> {
    if (!SnowflakeSchema.safeParse(userId).success) return [];
    const mine = await this.oauthGuildsOf(userId, accessToken);
    return mine.filter((guild) => this.client.guilds.cache.has(guild.id));
  }

  private oauthGuildsOf(userId: string, accessToken: string): Promise<GuildPickerItem[]> {
    const cached = this.userGuilds.get(userId);
    if (cached !== undefined) return Promise.resolve(cached);
    const running = this.userGuildsInFlight.get(userId);
    if (running !== undefined) return running;

    const pending = this.oauthGuilds.manageableGuilds(accessToken).then((guilds) => {
      this.userGuilds.set(userId, guilds);
      return guilds;
    });
    this.userGuildsInFlight.set(userId, pending);
    const release = (): void => {
      if (this.userGuildsInFlight.get(userId) === pending) this.userGuildsInFlight.delete(userId);
    };
    void pending.then(release, release);
    return pending;
  }

  /** Asks Discord. Failures other than "not a member" are thrown as they are and never cached as an answer. */
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
