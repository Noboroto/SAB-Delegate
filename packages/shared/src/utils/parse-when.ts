/**
 * Vietnam has had no daylight saving since 1975, so the business zone is a
 * fixed +07:00. Computing with the offset instead of `Intl` keeps the result
 * identical on any host `TZ` and in any ICU build.
 */
const ICT_OFFSET_MINUTES = 7 * 60;
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const ICT_OFFSET_MS = ICT_OFFSET_MINUTES * MINUTE_MS;

export type ParseWhenError =
  /** No time was given. */
  | 'TIME_REQUIRED'
  /** The time is neither `HH:mm[:ss]` nor a relative span such as `30m` or `1h30m`. */
  | 'INVALID_TIME'
  /** The date is neither `today`, `tomorrow`, `dd/MM` nor `dd/MM/yyyy`. */
  | 'INVALID_DATE'
  /** The day is not on the calendar (31/02, 29/02 of a common year). */
  | 'NONEXISTENT_DATE'
  /** A relative time (`30m`) already says when; a date next to it is a mistake. */
  | 'RELATIVE_WITH_DATE'
  /** The moment is not after `now`. */
  | 'PAST';

type ParseWhenResult = { at: Date } | { error: ParseWhenError };

type ParseWhenInput = {
  /** `HH:mm`, `HH:mm:ss`, or a span from now: `30m`, `2h`, `1h30m`, `90s`. */
  time: string;
  /** `today`, `tomorrow`, `dd/MM` or `dd/MM/yyyy`; absent means today. */
  date?: string | null | undefined;
};

/** A calendar day or a wall-clock moment in the business zone. */
type IctParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

/** The wall-clock reading of `at` in Vietnam. */
export function toIct(at: Date): IctParts {
  const shifted = new Date(at.getTime() + ICT_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
  };
}

/** The instant a Vietnamese wall-clock reading denotes; null when the day is not on the calendar. */
function fromIct(parts: IctParts): Date | null {
  const { year, month, day, hour, minute, second } = parts;
  // Date.UTC maps years 0-99 to 1900-1999 and rolls 31/02 over to 03/03; the
  // round trip below catches both.
  const wall = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (
    wall.getUTCFullYear() !== year ||
    wall.getUTCMonth() !== month - 1 ||
    wall.getUTCDate() !== day
  ) {
    return null;
  }
  return new Date(wall.getTime() - ICT_OFFSET_MS);
}

const TIME_OF_DAY = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;
const RELATIVE = /^(?:(\d{1,4})h)?(?:(\d{1,4})m)?(?:(\d{1,5})s)?$/;
const DAY_MONTH_YEAR = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{4}))?$/;

const TODAY = new Set(['today', 'hôm nay', 'hom nay']);
const TOMORROW = new Set(['tomorrow', 'ngày mai', 'ngay mai']);

type Clock = { hour: number; minute: number; second: number };

function parseClock(text: string): Clock | 'INVALID' {
  const match = TIME_OF_DAY.exec(text);
  if (match === null) return 'INVALID';
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = match[3] === undefined ? 0 : Number(match[3]);
  if (hour > 23 || minute > 59 || second > 59) return 'INVALID';
  return { hour, minute, second };
}

/** The span in milliseconds, or null when `text` is not a relative time. */
function parseRelative(text: string): number | null {
  const match = RELATIVE.exec(text);
  if (match === null) return null;
  const [, hours, minutes, seconds] = match;
  if (hours === undefined && minutes === undefined && seconds === undefined) return null;
  return (
    Number(hours ?? 0) * HOUR_MS + Number(minutes ?? 0) * MINUTE_MS + Number(seconds ?? 0) * 1000
  );
}

type DayResult = { day: Pick<IctParts, 'year' | 'month' | 'day'> } | { error: ParseWhenError };

/** Which calendar day `date` names, read against today's date in Vietnam. */
function resolveDay(date: string | null | undefined, now: Date): DayResult {
  const today = toIct(now);
  const text = (date ?? '').trim().toLowerCase();
  if (text === '' || TODAY.has(text)) return { day: today };
  if (TOMORROW.has(text)) {
    const tomorrow = toIct(new Date(now.getTime() + DAY_MS));
    return { day: tomorrow };
  }

  const match = DAY_MONTH_YEAR.exec(text);
  if (match === null) return { error: 'INVALID_DATE' };
  const day = Number(match[1]);
  const month = Number(match[2]);

  if (match[3] !== undefined) {
    const year = Number(match[3]);
    return fromIct({ year, month, day, hour: 0, minute: 0, second: 0 }) === null
      ? { error: 'NONEXISTENT_DATE' }
      : { day: { year, month, day } };
  }

  // No year: the next time this date comes round. A date that already passed
  // this year means next year, which is what "05/01" typed in December intends.
  const thisYear = { year: today.year, month, day };
  const start = fromIct({ ...thisYear, hour: 0, minute: 0, second: 0 });
  if (start === null) return { error: 'NONEXISTENT_DATE' };
  const todayStart = fromIct({ ...today, hour: 0, minute: 0, second: 0 });
  if (todayStart !== null && start.getTime() < todayStart.getTime()) {
    const nextYear = { year: today.year + 1, month, day };
    return fromIct({ ...nextYear, hour: 0, minute: 0, second: 0 }) === null
      ? { error: 'NONEXISTENT_DATE' }
      : { day: nextYear };
  }
  return { day: thisYear };
}

/**
 * Reads what a person typed into a `time` and an optional `date` field as a
 * moment in Vietnam time (UTC+7, whatever the host's zone). Pure: `now` is a
 * parameter. Never throws; failures come back as a code to translate.
 *
 * Years are not capped, so a schedule far ahead is allowed; the moment must be
 * strictly after `now`.
 */
export function parseWhen(input: ParseWhenInput, now: Date): ParseWhenResult {
  const timeText = input.time.trim().toLowerCase();
  if (timeText === '') return { error: 'TIME_REQUIRED' };

  const relative = parseRelative(timeText.replaceAll(/\s+/g, ''));
  if (relative !== null) {
    if ((input.date ?? '').trim() !== '') return { error: 'RELATIVE_WITH_DATE' };
    const at = new Date(now.getTime() + relative);
    return at.getTime() > now.getTime() ? { at } : { error: 'PAST' };
  }

  const clock = parseClock(timeText);
  if (clock === 'INVALID') return { error: 'INVALID_TIME' };

  const resolved = resolveDay(input.date, now);
  if ('error' in resolved) return { error: resolved.error };

  const at = fromIct({ ...resolved.day, ...clock });
  if (at === null) return { error: 'NONEXISTENT_DATE' };
  return at.getTime() > now.getTime() ? { at } : { error: 'PAST' };
}

const RUN_AT =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?$/i;

/**
 * An ISO 8601 instant for the REST and MCP callers: `2026-10-20T09:30:00+07:00`,
 * `...Z`, or no offset at all, which reads as Vietnam time. Null for anything
 * else, including a day that is not on the calendar. It does not judge past or
 * future; the service does.
 */
export function parseRunAt(text: string): Date | null {
  const match = RUN_AT.exec(text.trim());
  if (match === null) return null;
  const [, year, month, day, hour, minute, second, zone] = match;
  const parts = {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
    second: Number(second ?? 0),
  };
  if (parts.hour > 23 || parts.minute > 59 || parts.second > 59) return null;

  const local = fromIct(parts);
  if (local === null) return null;
  if (zone === undefined) return local;

  // `local` is the wall-clock reading taken as Vietnam time; move it to the
  // zone the text named.
  if (zone.toUpperCase() === 'Z') return new Date(local.getTime() + ICT_OFFSET_MS);
  const sign = zone.startsWith('-') ? -1 : 1;
  const zoneHours = Number(zone.slice(1, 3));
  const zoneMinutes = Number(zone.slice(4, 6));
  if (zoneHours > 23 || zoneMinutes > 59) return null;
  const offsetMs = sign * (zoneHours * HOUR_MS + zoneMinutes * MINUTE_MS);
  return new Date(local.getTime() + ICT_OFFSET_MS - offsetMs);
}

const two = (value: number): string => String(value).padStart(2, '0');

/** `dd/MM/yyyy` of a day in Vietnam, the form `parseWhen` reads back. */
export function formatIctDate(parts: Pick<IctParts, 'year' | 'month' | 'day'>): string {
  return `${two(parts.day)}/${two(parts.month)}/${parts.year}`;
}

/** `dd/MM/yyyy HH:mm` in Vietnam time; plain text for places Discord cannot render a timestamp (autocomplete). */
export function formatWhenIct(at: Date): string {
  const parts = toIct(at);
  return `${formatIctDate(parts)} ${two(parts.hour)}:${two(parts.minute)}`;
}

/**
 * Discord renders `<t:unix:F>` in the reader's zone and language, and `:R` as
 * "in 5 minutes", so the person sees both when it fires and how soon.
 */
export function formatDiscordTimestamp(at: Date): string {
  const unix = Math.floor(at.getTime() / 1000);
  return `<t:${unix}:F> (<t:${unix}:R>)`;
}
