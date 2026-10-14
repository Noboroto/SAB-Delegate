import { Injectable } from '@nestjs/common';
import { ErrorCode } from '@sab/shared';
import { LRUCache } from 'lru-cache';
import { ServiceError } from '../errors/service-error.js';

/**
 * How often one server may trigger each kind of action through the dashboard
 * or an API key. Discord throttles the bot per channel and per route, and one
 * busy dashboard must not spend the bot's allowance for everyone else's
 * servers. Not for slash commands, which a person types one at a time.
 */
export const GUILD_ACTION_LIMITS = {
  /** Send, copy, edit, react and poll: everything that posts or changes a message. */
  message: { max: 30, windowMs: 60_000 },
  /** Creating scheduled messages. */
  schedule: { max: 10, windowMs: 60_000 },
} as const;

export type GuildActionBucket = keyof typeof GUILD_ACTION_LIMITS;

/** Counted (guild, bucket) pairs; a flood of new keys evicts the oldest. */
export const GUILD_ACTION_LIMITER_MAX_KEYS = 5000;

/**
 * Fixed-window counters per server and action kind, in memory: one process
 * serves the API, and a restart forgetting the counts only forgives a minute.
 * Shared by the REST controllers and the MCP tools so both spend one budget.
 * A package such as rate-limiter-flexible was not added: this is one map with a
 * TTL, and the HTTP-level limits already come from @fastify/rate-limit.
 */
@Injectable()
export class GuildActionLimiter {
  private readonly counts = new LRUCache<string, number>({
    max: GUILD_ACTION_LIMITER_MAX_KEYS,
    // lru-cache binds the global clock once, at import; reading it per call
    // lets a replaced clock (fake timers) take effect.
    perf: { now: () => performance.now() },
  });

  /** Counts one action; throws `RATE_LIMITED` once the server used up its window. */
  consume(guildId: string, bucket: GuildActionBucket): void {
    const { max, windowMs } = GUILD_ACTION_LIMITS[bucket];
    const key = `${bucket}:${guildId}`;
    const used = this.counts.get(key) ?? 0;
    if (used >= max) throw new ServiceError(ErrorCode.RATE_LIMITED);
    // The window starts at the first action and is not extended by later ones.
    if (used === 0) this.counts.set(key, 1, { ttl: windowMs });
    else this.counts.set(key, used + 1, { noUpdateTTL: true });
  }
}
