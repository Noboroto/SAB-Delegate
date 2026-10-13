import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_NAME_MAX_LENGTH,
  ActivityCreateResultSchema,
  ActivityCreateSchema,
} from './activity.js';

const CATEGORY = '123456789012345678';

describe('ActivityCreateSchema', () => {
  it('trims the texts and leaves the category out when none is given', () => {
    expect(
      ActivityCreateSchema.parse({ emoji: ' 🎉 ', name: ' Game Night ', shortName: ' GNT ' }),
    ).toEqual({
      emoji: '🎉',
      name: 'Game Night',
      shortName: 'GNT',
    });
  });

  it('accepts a category snowflake and rejects anything else', () => {
    expect(
      ActivityCreateSchema.parse({ emoji: 'x', name: 'n', shortName: 'abc', categoryId: CATEGORY })
        .categoryId,
    ).toBe(CATEGORY);
    expect(
      ActivityCreateSchema.safeParse({ emoji: 'x', name: 'n', shortName: 'abc', categoryId: '12' })
        .success,
    ).toBe(false);
  });

  it('wants a short name of exactly three characters after trimming', () => {
    for (const shortName of ['ab', 'abcd', '  a ', '']) {
      expect(ActivityCreateSchema.safeParse({ emoji: 'x', name: 'n', shortName }).success).toBe(
        false,
      );
    }
  });

  it('rejects a blank or over-long name and a blank emoji', () => {
    const base = { emoji: 'x', name: 'n', shortName: 'abc' };
    expect(ActivityCreateSchema.safeParse({ ...base, name: '   ' }).success).toBe(false);
    expect(
      ActivityCreateSchema.safeParse({ ...base, name: 'a'.repeat(ACTIVITY_NAME_MAX_LENGTH + 1) })
        .success,
    ).toBe(false);
    expect(ActivityCreateSchema.safeParse({ ...base, emoji: ' ' }).success).toBe(false);
  });

  it('strips fields it does not know', () => {
    const parsed = ActivityCreateSchema.parse({
      emoji: 'x',
      name: 'n',
      shortName: 'abc',
      guildId: 'internal',
    });
    expect(parsed).not.toHaveProperty('guildId');
  });
});

describe('ActivityCreateResultSchema', () => {
  it('describes the three roles and three channels that were made', () => {
    const id = (n: number) => `${n}`.repeat(18);
    const result = {
      categoryId: id(1),
      roles: { event: id(2), multi: id(3), mc: id(4) },
      channels: { general: id(5), threadOnly: id(6), voice: id(7) },
    };
    expect(ActivityCreateResultSchema.parse(result)).toEqual(result);
  });
});
