const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export type UptimeParts =
  | { unit: 'lessThanMinute' }
  | { unit: 'minutes'; minutes: number }
  | { unit: 'hours'; hours: number; minutes: number }
  | { unit: 'days'; days: number; hours: number; minutes: number };

/** Splits an uptime into the largest units it reaches, so the sentence never says "0 days 0 hours". */
export function uptimeParts(uptimeMs: number): UptimeParts {
  const ms = Math.max(0, uptimeMs);
  const days = Math.floor(ms / DAY_MS);
  const hours = Math.floor((ms % DAY_MS) / HOUR_MS);
  const minutes = Math.floor((ms % HOUR_MS) / MINUTE_MS);
  if (days > 0) return { unit: 'days', days, hours, minutes };
  if (hours > 0) return { unit: 'hours', hours, minutes };
  if (minutes > 0) return { unit: 'minutes', minutes };
  return { unit: 'lessThanMinute' };
}
