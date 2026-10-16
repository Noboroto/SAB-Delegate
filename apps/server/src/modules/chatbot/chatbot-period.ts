import { BUSINESS_TIME_ZONE } from '@sab/shared';

// Built once and pinned to the business zone: a quota month ends at midnight
// there, whatever zone the host or the database session runs in.
const MONTH_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
});

const CLOCK_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/** How far the business zone's wall clock is ahead of UTC at `instant`, in ms. */
function offsetAt(instant: number): number {
  const field: Record<string, number> = {};
  for (const part of CLOCK_FORMAT.formatToParts(new Date(instant))) {
    if (part.type !== 'literal') field[part.type] = Number(part.value);
  }
  const wall = Date.UTC(
    field.year ?? 0,
    (field.month ?? 1) - 1,
    field.day ?? 1,
    field.hour ?? 0,
    field.minute ?? 0,
    field.second ?? 0,
  );
  return wall - Math.floor(instant / 1000) * 1000;
}

/** The quota month `date` falls in, `YYYY-MM`, in the business time zone. */
export function periodOf(date: Date): string {
  let year = '';
  let month = '';
  for (const part of MONTH_FORMAT.formatToParts(date)) {
    if (part.type === 'year') year = part.value;
    else if (part.type === 'month') month = part.value;
  }
  return `${year}-${month}`;
}

/**
 * The instant the quota month after the one `date` falls in begins: 00:00 on
 * day 1 in the business zone. The offset is read from the zone rather than
 * hardcoded, and looked up twice so a zone whose offset changes around that
 * midnight still lands on it.
 */
export function nextPeriodStart(date: Date): Date {
  const [year = 0, month = 1] = periodOf(date).split('-').map(Number);
  const wallMidnight = Date.UTC(year, month, 1);
  let instant = wallMidnight - offsetAt(wallMidnight);
  instant = wallMidnight - offsetAt(instant);
  return new Date(instant);
}

/**
 * When the allowance renews, as Discord timestamp markup: each viewer sees it
 * relative and in their own language, with the full date on hover.
 */
export function resetMarkup(now: Date): string {
  return `<t:${Math.floor(nextPeriodStart(now).getTime() / 1000)}:R>`;
}
