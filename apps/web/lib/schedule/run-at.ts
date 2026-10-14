import { SCHEDULE_MAX_HORIZON_DAYS, parseWhen, toIct, type ParseWhenError } from '@sab/shared';

export type RunAtError = ParseWhenError | 'TOO_FAR';

export type RunAtResult = { ok: true; at: Date; iso: string } | { ok: false; error: RunAtError };

const DAY_MS = 24 * 60 * 60 * 1000;

const pad = (value: number, width = 2): string => String(value).padStart(width, '0');

/** `2026-10-20T09:30:00+07:00`: the form the API takes, written in the business zone's fixed offset. */
export function toRunAtIso(at: Date): string {
  const p = toIct(at);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}+07:00`;
}

/**
 * Reads the date and time a person typed as a moment in Vietnam time and as the
 * ISO text the API takes, checking everything the server would refuse: no
 * time, an impossible day (31/02), a moment that has passed, one too far ahead.
 * `date` may be empty (today). Pure: `now` is a parameter.
 */
export function resolveRunAt(date: string, time: string, now: Date): RunAtResult {
  const parsed = parseWhen({ time, date }, now);
  if ('error' in parsed) return { ok: false, error: parsed.error };

  // The API carries whole seconds. Rounding up keeps a moment just after
  // `now` (a span of seconds) from rounding down into the past.
  const at = new Date(Math.ceil(parsed.at.getTime() / 1000) * 1000);
  const iso = toRunAtIso(at);
  if (at.getTime() - now.getTime() > SCHEDULE_MAX_HORIZON_DAYS * DAY_MS) {
    return { ok: false, error: 'TOO_FAR' };
  }
  return { ok: true, at, iso };
}

/** The field a failure is shown on: the date's own mistakes on the date, everything else on the time. */
export function errorField(error: RunAtError): 'date' | 'time' {
  return error === 'INVALID_DATE' || error === 'NONEXISTENT_DATE' ? 'date' : 'time';
}
