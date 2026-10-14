import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { LRUCache } from 'lru-cache';
import { API_KEY_FORMAT } from '../modules/api-key/api-key.service.js';

/** Requests per minute for one key (a bearer shaped like one). */
export const MCP_KEY_LIMIT = { max: 120, windowMs: 60_000 } as const;
/** Failed authentications per minute from one address. */
export const MCP_FAILED_AUTH_LIMIT = { max: 10, windowMs: 60_000 } as const;
/** Counted keys per bucket; a flood of new ones evicts the oldest. */
const MCP_RATE_LIMIT_MAX_KEYS = 5000;

/** Fixed-window counter: the window opens at the first hit and later hits do not extend it. */
class WindowCounter {
  private readonly counts = new LRUCache<string, number>({
    max: MCP_RATE_LIMIT_MAX_KEYS,
    // lru-cache binds the global clock once, at import; reading it per call
    // lets a replaced clock (fake timers) take effect.
    perf: { now: () => performance.now() },
  });

  constructor(private readonly limit: { readonly max: number; readonly windowMs: number }) {}

  /** Whether the key is at its ceiling, without counting. */
  isFull(key: string): boolean {
    return (this.counts.get(key) ?? 0) >= this.limit.max;
  }

  /** Counts one hit and reports whether it fits in the window. */
  hit(key: string): boolean {
    const used = this.counts.get(key) ?? 0;
    if (used >= this.limit.max) return false;
    if (used === 0) this.counts.set(key, 1, { ttl: this.limit.windowMs });
    else this.counts.set(key, used + 1, { noUpdateTTL: true });
    return true;
  }
}

/** What a bucket is keyed by: the hash, never the bearer, so a memory dump holds no usable key. */
function bearerFingerprint(bearer: string): string {
  return createHash('sha256').update(bearer).digest('hex');
}

/**
 * The limits `/mcp` applies before it hijacks the reply, in memory like
 * `GuildActionLimiter`: one process serves the API, and a restart forgiving a
 * minute is acceptable. `@fastify/rate-limit` was not used because it is only
 * registered while the REST API is on and cannot count failures alone, which
 * the per-address brute-force limit needs.
 */
@Injectable()
export class McpRateLimiter {
  private readonly perKey = new WindowCounter(MCP_KEY_LIMIT);
  private readonly failures = new WindowCounter(MCP_FAILED_AUTH_LIMIT);

  /**
   * Counts a request for this bearer; `false` once it used up its window. A
   * bearer that is not even shaped like a key is not counted here: it can never
   * authenticate, the failed-attempt limit already meters it per address, and
   * a bucket per junk string would evict the counters of real keys.
   */
  allowKey(bearer: string): boolean {
    if (!API_KEY_FORMAT.test(bearer)) return true;
    return this.perKey.hit(bearerFingerprint(bearer));
  }

  /** Whether this address may still try to authenticate. */
  allowAddress(ip: string): boolean {
    return !this.failures.isFull(ip);
  }

  recordFailure(ip: string): void {
    this.failures.hit(ip);
  }
}
