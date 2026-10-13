import { describe, expect, it } from 'vitest';
import {
  BusinessDaySchema,
  birthdayDatesFor,
  businessDayOf,
  dateColumnValue,
  isLeapYear,
  previousDay,
} from './birthday.date.js';

describe('isLeapYear', () => {
  it('follows the Gregorian rule', () => {
    expect(isLeapYear(1900)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
    expect(isLeapYear(2023)).toBe(false);
    expect(isLeapYear(2024)).toBe(true);
  });
});

describe('birthdayDatesFor', () => {
  it('greets 29 February people on 28 February only in a year without a 29th', () => {
    const on28 = (year: number) => birthdayDatesFor({ year, month: 2, day: 28 });
    expect(on28(1900)).toEqual([
      { month: 2, day: 28 },
      { month: 2, day: 29 },
    ]);
    expect(on28(2023)).toEqual([
      { month: 2, day: 28 },
      { month: 2, day: 29 },
    ]);
    expect(on28(2000)).toEqual([{ month: 2, day: 28 }]);
    expect(on28(2024)).toEqual([{ month: 2, day: 28 }]);
  });

  it('greets 29 February people on the 29th itself in a leap year', () => {
    expect(birthdayDatesFor({ year: 2024, month: 2, day: 29 })).toEqual([{ month: 2, day: 29 }]);
    expect(birthdayDatesFor({ year: 2000, month: 2, day: 29 })).toEqual([{ month: 2, day: 29 }]);
  });

  it('adds nothing on any other day', () => {
    expect(birthdayDatesFor({ year: 2023, month: 3, day: 1 })).toEqual([{ month: 3, day: 1 }]);
    expect(birthdayDatesFor({ year: 2023, month: 1, day: 28 })).toEqual([{ month: 1, day: 28 }]);
  });
});

describe('businessDayOf', () => {
  it('turns over at 00:00 +07, not at UTC midnight', () => {
    expect(businessDayOf(new Date('2026-03-01T16:59:59.999Z'))).toEqual({
      year: 2026,
      month: 3,
      day: 1,
    });
    expect(businessDayOf(new Date('2026-03-01T17:00:00.000Z'))).toEqual({
      year: 2026,
      month: 3,
      day: 2,
    });
  });

  it('crosses a year end and a leap day in the business zone', () => {
    expect(businessDayOf(new Date('2025-12-31T17:00:00Z'))).toEqual({
      year: 2026,
      month: 1,
      day: 1,
    });
    expect(businessDayOf(new Date('2024-02-28T17:00:00Z'))).toEqual({
      year: 2024,
      month: 2,
      day: 29,
    });
  });

  it('does not depend on the host zone', () => {
    const before = process.env['TZ'];
    try {
      for (const zone of ['UTC', 'America/Los_Angeles', 'Asia/Ho_Chi_Minh']) {
        process.env['TZ'] = zone;
        expect(businessDayOf(new Date('2026-03-01T17:00:00Z')).day).toBe(2);
      }
    } finally {
      if (before === undefined) delete process.env['TZ'];
      else process.env['TZ'] = before;
    }
  });
});

describe('BusinessDaySchema', () => {
  it('refuses a day the calendar lacks', () => {
    expect(BusinessDaySchema.safeParse({ year: 2023, month: 2, day: 29 }).success).toBe(false);
    expect(BusinessDaySchema.safeParse({ year: 2024, month: 2, day: 29 }).success).toBe(true);
    expect(BusinessDaySchema.safeParse({ year: 2024, month: 4, day: 31 }).success).toBe(false);
  });
});

describe('dateColumnValue and previousDay', () => {
  it('is midnight UTC of the calendar day', () => {
    expect(dateColumnValue({ year: 2026, month: 3, day: 2 }).toISOString()).toBe(
      '2026-03-02T00:00:00.000Z',
    );
  });

  it('steps over month, year and leap day', () => {
    expect(previousDay({ year: 2026, month: 3, day: 1 })).toEqual({
      year: 2026,
      month: 2,
      day: 28,
    });
    expect(previousDay({ year: 2024, month: 3, day: 1 })).toEqual({
      year: 2024,
      month: 2,
      day: 29,
    });
    expect(previousDay({ year: 2026, month: 1, day: 1 })).toEqual({
      year: 2025,
      month: 12,
      day: 31,
    });
  });
});
