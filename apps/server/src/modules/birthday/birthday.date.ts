import { BUSINESS_TIME_ZONE, z } from '@sab/shared';

const DAY_MS = 86_400_000;

/**
 * A calendar day in the business zone. Birthdays, runs and the "already done
 * today" decision all key on it, never on the host's clock or zone.
 */
export const BusinessDaySchema = z
  .object({
    year: z.number().int().min(1900).max(9999),
    month: z.number().int().min(1).max(12),
    day: z.number().int().min(1).max(31),
  })
  .refine(({ year, month, day }) => {
    const utc = new Date(Date.UTC(year, month - 1, day));
    return utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day;
  }, 'not a calendar day');

export type BusinessDay = z.infer<typeof BusinessDaySchema>;

const PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** The business-zone day `now` falls in: it turns over at 00:00 +07, not at UTC midnight. */
export function businessDayOf(now: Date): BusinessDay {
  const parts = PARTS.formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === type)?.value);
  return BusinessDaySchema.parse({ year: part('year'), month: part('month'), day: part('day') });
}

/** The value of a `date` column: midnight UTC of the calendar day, which Postgres stores as that day. */
export function dateColumnValue({ year, month, day }: BusinessDay): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

export function previousDay(day: BusinessDay): BusinessDay {
  const before = new Date(dateColumnValue(day).getTime() - DAY_MS);
  return BusinessDaySchema.parse({
    year: before.getUTCFullYear(),
    month: before.getUTCMonth() + 1,
    day: before.getUTCDate(),
  });
}

/** Gregorian rule: every fourth year, except centuries that are not divisible by 400. */
export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * The (month, day) pairs whose owners are greeted on `day`. People born on
 * 29 February are greeted on 28 February in a year that has no 29th.
 */
export function birthdayDatesFor({ year, month, day }: BusinessDay): Array<{
  month: number;
  day: number;
}> {
  const dates = [{ month, day }];
  if (month === 2 && day === 28 && !isLeapYear(year)) dates.push({ month: 2, day: 29 });
  return dates;
}
