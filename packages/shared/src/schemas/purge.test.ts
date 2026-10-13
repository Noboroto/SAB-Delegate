import { describe, expect, it } from 'vitest';
import { PURGE_COUNT_MAX, PurgeLastSchema, PurgeRangeSchema } from './purge.js';

const CHANNEL = '123456789012345678';
const UNTIL = '223456789012345678';
const FROM = '323456789012345678';

describe('PurgeRangeSchema', () => {
  it('needs the until message and takes the from message as optional', () => {
    expect(PurgeRangeSchema.parse({ channelId: CHANNEL, untilMessageId: UNTIL })).toEqual({
      channelId: CHANNEL,
      untilMessageId: UNTIL,
    });
    expect(
      PurgeRangeSchema.parse({ channelId: CHANNEL, untilMessageId: UNTIL, fromMessageId: FROM }),
    ).toMatchObject({ fromMessageId: FROM });
    expect(PurgeRangeSchema.safeParse({ channelId: CHANNEL }).success).toBe(false);
  });

  it('refuses ids that are not snowflakes and strips unknown fields', () => {
    expect(PurgeRangeSchema.safeParse({ channelId: CHANNEL, untilMessageId: 'abc' }).success).toBe(
      false,
    );
    expect(
      PurgeRangeSchema.parse({ channelId: CHANNEL, untilMessageId: UNTIL, guildId: 'x' }),
    ).toEqual({ channelId: CHANNEL, untilMessageId: UNTIL });
  });
});

describe('PurgeLastSchema', () => {
  it('accepts a whole count between 1 and the maximum', () => {
    expect(PurgeLastSchema.safeParse({ channelId: CHANNEL, count: 1 }).success).toBe(true);
    expect(PurgeLastSchema.safeParse({ channelId: CHANNEL, count: PURGE_COUNT_MAX }).success).toBe(
      true,
    );
    for (const count of [0, -3, 1.5, PURGE_COUNT_MAX + 1, Number.NaN]) {
      expect(PurgeLastSchema.safeParse({ channelId: CHANNEL, count }).success, String(count)).toBe(
        false,
      );
    }
  });
});
