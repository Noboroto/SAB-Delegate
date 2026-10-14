import { ErrorCode } from '@sab/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceError } from '../errors/service-error.js';
import {
  GUILD_ACTION_LIMITER_MAX_KEYS,
  GUILD_ACTION_LIMITS,
  GuildActionLimiter,
  type GuildActionBucket,
} from './guild-action.limiter.js';

const GUILD = '100000000000000001';
const OTHER = '100000000000000002';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['performance', 'Date', 'setTimeout', 'clearTimeout'] });
  // lru-cache reads an entry stamped 0 as "no expiry".
  vi.advanceTimersByTime(1);
});
afterEach(() => {
  vi.useRealTimers();
});

function useUp(
  limiter: GuildActionLimiter,
  guild: string,
  bucket: GuildActionBucket,
  already = 0,
): void {
  for (let i = already; i < GUILD_ACTION_LIMITS[bucket].max; i++) limiter.consume(guild, bucket);
}

describe('GuildActionLimiter', () => {
  it.each(['message', 'schedule'] as const)(
    'allows %s up to its limit, then RATE_LIMITED',
    (bucket) => {
      const limiter = new GuildActionLimiter();
      useUp(limiter, GUILD, bucket);
      expect(() => limiter.consume(GUILD, bucket)).toThrow(ServiceError);
      try {
        limiter.consume(GUILD, bucket);
      } catch (error) {
        expect((error as ServiceError).code).toBe(ErrorCode.RATE_LIMITED);
      }
    },
  );

  it('counts each server and each kind of action separately', () => {
    const limiter = new GuildActionLimiter();
    useUp(limiter, GUILD, 'message');
    expect(() => limiter.consume(OTHER, 'message')).not.toThrow();
    expect(() => limiter.consume(GUILD, 'schedule')).not.toThrow();
  });

  it('forgives the server once the window has passed', () => {
    const limiter = new GuildActionLimiter();
    useUp(limiter, GUILD, 'message');
    vi.advanceTimersByTime(GUILD_ACTION_LIMITS.message.windowMs + 1);
    expect(() => limiter.consume(GUILD, 'message')).not.toThrow();
  });

  it('does not extend the window with every attempt', () => {
    const limiter = new GuildActionLimiter();
    const { windowMs } = GUILD_ACTION_LIMITS.message;
    limiter.consume(GUILD, 'message');
    vi.advanceTimersByTime(windowMs - 1000);
    useUp(limiter, GUILD, 'message', 1);
    expect(() => limiter.consume(GUILD, 'message')).toThrow(ServiceError);
    vi.advanceTimersByTime(1001);
    expect(() => limiter.consume(GUILD, 'message')).not.toThrow();
  });

  it('keeps the number of tracked servers bounded', () => {
    const limiter = new GuildActionLimiter();
    for (let i = 0; i < GUILD_ACTION_LIMITER_MAX_KEYS + 50; i++) {
      limiter.consume(String(400_000_000_000_000_000n + BigInt(i)), 'message');
    }
    // The oldest were evicted: the first server is counted from zero again.
    useUp(limiter, String(400_000_000_000_000_000n), 'message');
  });
});
