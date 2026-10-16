import { BUSINESS_TIME_ZONE } from '@sab/shared';

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Minutes the business zone is ahead of UTC at `at` (read from the zone, not hard-coded). */
function zoneOffsetMinutes(at: Date): number {
  const label = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIME_ZONE,
    timeZoneName: 'longOffset',
  })
    .formatToParts(at)
    .find((part) => part.type === 'timeZoneName')?.value;
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(label ?? '');
  if (match === null) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === '-' ? -minutes : minutes;
}

/** The instant a calendar day (`YYYY-MM-DD`) starts in the business zone, or `undefined` for text that is not a day. */
function startOfDay(day: string): number | undefined {
  if (!DATE_ONLY.test(day)) return undefined;
  const utcMidnight = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(utcMidnight)) return undefined;
  return utcMidnight - zoneOffsetMinutes(new Date(utcMidnight)) * 60_000;
}

/** First instant of the day, as the ISO text the history query takes. */
export function dayStartIso(day: string): string | undefined {
  const start = startOfDay(day);
  return start === undefined ? undefined : new Date(start).toISOString();
}

/** Last millisecond of the day, so a filter "up to this day" includes the whole day. */
export function dayEndIso(day: string): string | undefined {
  const start = startOfDay(day);
  return start === undefined ? undefined : new Date(start + DAY_MS - 1).toISOString();
}

/** The business-zone calendar day (`YYYY-MM-DD`) an instant falls on; empty for no value. */
export function dayOf(iso: string | undefined): string {
  if (iso === undefined) return '';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}
