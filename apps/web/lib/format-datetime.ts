import { BUSINESS_TIME_ZONE } from '@sab/shared';
import type { SupportedLocale } from './locale';

const INTL_LOCALE: Record<SupportedLocale, string> = { vi: 'vi-VN', en: 'en-GB' };

/**
 * The one formatter for a date or time shown to a person. It always reads the
 * clock in the business time zone, never the viewer's: two admins looking at the
 * same audit row must see the same wall-clock time. `toLocale*` and the local
 * getters are banned elsewhere by ESLint so this stays the only path.
 */
export function formatDateTime(value: Date | string | number, locale: SupportedLocale): string {
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    timeZone: BUSINESS_TIME_ZONE,
    dateStyle: 'medium',
    timeStyle: 'short',
    hourCycle: 'h23',
  }).format(new Date(value));
}

export function formatDate(value: Date | string | number, locale: SupportedLocale): string {
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    timeZone: BUSINESS_TIME_ZONE,
    dateStyle: 'medium',
  }).format(new Date(value));
}

/** A `YYYY-MM` period (the quota month) as "October 2026" / "tháng 10 năm 2026"; `period` is returned as it is when it is not one. */
export function formatMonth(period: string, locale: SupportedLocale): string {
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  if (match === null) return period;
  const instant = Date.UTC(Number(match[1]), Number(match[2]) - 1, 1);
  // The month is a calendar label, not an instant: UTC keeps it from shifting with any zone.
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  }).format(instant);
}
