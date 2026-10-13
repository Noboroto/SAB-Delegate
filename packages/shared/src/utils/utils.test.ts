import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { isValidMonthDay } from './month-day.js';
import { partialWithoutDefaults } from './partial-without-defaults.js';

describe('partialWithoutDefaults', () => {
  const Update = z.object({
    name: z.string().min(1),
    tags: z.array(z.string()).default([]),
    limit: z.number().int().optional().default(5),
    note: z.string().nullable().default(null),
  });

  it('leaves an absent field absent, where .partial() would invent its default', () => {
    expect(Update.partial().parse({ name: 'x' })).toMatchObject({ tags: [], limit: 5, note: null });
    expect(partialWithoutDefaults(Update).parse({ name: 'x' })).toEqual({ name: 'x' });
    expect(partialWithoutDefaults(Update).parse({})).toEqual({});
  });

  it('still validates and keeps a field that is present, including an explicit null', () => {
    const patch = partialWithoutDefaults(Update);
    expect(patch.parse({ tags: ['a'], note: null })).toEqual({ tags: ['a'], note: null });
    expect(patch.safeParse({ limit: 1.5 }).success).toBe(false);
    expect(patch.safeParse({ name: '' }).success).toBe(false);
  });

  it('strips fields the schema does not declare', () => {
    expect(partialWithoutDefaults(Update).parse({ name: 'x', extra: 1 })).toEqual({ name: 'x' });
  });
});

describe('isValidMonthDay', () => {
  it('accepts every real calendar day, 29 February included', () => {
    let valid = 0;
    for (let month = 1; month <= 12; month++) {
      for (let day = 1; day <= 31; day++) {
        // 2024 is a leap year, so a date that round-trips through it is real.
        const date = new Date(Date.UTC(2024, month - 1, day));
        const real = date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
        expect(isValidMonthDay(month, day), `${month}/${day}`).toBe(real);
        if (real) valid++;
      }
    }
    expect(valid).toBe(366);
  });

  it('rejects impossible dates and non-integers', () => {
    expect(isValidMonthDay(2, 30)).toBe(false);
    expect(isValidMonthDay(4, 31)).toBe(false);
    expect(isValidMonthDay(13, 1)).toBe(false);
    expect(isValidMonthDay(0, 1)).toBe(false);
    expect(isValidMonthDay(1, 0)).toBe(false);
    expect(isValidMonthDay(1.5, 1)).toBe(false);
    expect(isValidMonthDay(1, Number.NaN)).toBe(false);
  });
});
