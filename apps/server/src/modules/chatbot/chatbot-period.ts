import { BUSINESS_TIME_ZONE } from '@sab/shared';

// Built once and pinned to the business zone: a quota month ends at midnight
// there, whatever zone the host or the database session runs in.
const MONTH_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
});

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
