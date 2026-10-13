import { BIRTHDAY_WISHES, BUSINESS_TIME_ZONE, SnowflakeSchema, isValidMonthDay } from '@sab/shared';
import {
  PlanSchema,
  type LegacyData,
  type LegacyRow,
  type Plan,
  type PlannedBirthday,
  type PlannedGuild,
  type PlannedWordGame,
  type SkipCode,
} from './types.js';

/*
 * How quick.db values map to rows (root/src/ultils/*):
 *
 * - Guilds are the top-level keys of the birthday, config and word files. The
 *   birthday file also holds a `max` row (the wish count); it is derived data
 *   and not a guild.
 * - `wishes[i] === false` means wish i was already used in the guild's current
 *   cycle (`true` = still available), so exactly the false entries become
 *   BirthdayWishUsage rows. `count` and `max` are derived and dropped. The
 *   value is an array when lodash created it and an object when its parent
 *   already existed; both are read the same way. Indexes past the shared wish
 *   list cannot be picked any more and are dropped.
 * - `completedDates["Y-M-D"] === true` is a finished greeting run for that
 *   business day. Only the last three days are loaded (as DONE): they are the
 *   ones that stop the first run after cutover from greeting twice. The older
 *   legacy `isCompleted.<month>.<day>` flag carried no year, suppressed a date
 *   forever and the old code already ignores it, so it is dropped.
 * - Notes are keyed by role id with no guild id, so they cannot be attributed;
 *   they are skipped and only counted.
 * - `used.<word>` is a lodash path, so a word with a dot is stored as nested
 *   objects and is rebuilt by joining the keys with `.`.
 * - A word row becomes WordGameState (+ one row per played word). Its optional
 *   fields get the legacy code's own defaults; a missing or too small
 *   `maxWords` becomes 1500.
 */

const DEFAULT_WORD_MAX_WORDS = 1500;
const MIN_WORD_MAX_WORDS = 200;
/** Today and the two days before it. */
const COMPLETED_DATE_WINDOW_DAYS = 2;
const DAY_MS = 86_400_000;

type Skip = (code: SkipCode, count?: number) => void;

/** The business date (YYYY-MM-DD) that `now` falls on. */
export function businessDate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** Days since the epoch for a real calendar date, null for 31 February and the like. */
function dayNumber(year: number, month: number, day: number): number | null {
  const time = Date.UTC(year, month - 1, day);
  const check = new Date(time);
  return check.getUTCFullYear() === year &&
    check.getUTCMonth() === month - 1 &&
    check.getUTCDate() === day
    ? time / DAY_MS
    : null;
}

function isoOf(number: number): string {
  return new Date(number * DAY_MS).toISOString().slice(0, 10);
}

/** `date` (YYYY-MM-DD) moved by a whole number of days. */
export function shiftDate(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return isoOf((dayNumber(year, month, day) as number) + days);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Objects and arrays alike: lodash picks the container from the next path segment. */
function entriesOf(value: unknown): [string, unknown][] {
  return value !== null && typeof value === 'object' ? Object.entries(value) : [];
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function newGuild(discordId: string): PlannedGuild {
  return {
    discordId,
    config: {
      introChannelId: null,
      logChannelId: null,
      birthdayChannelId: null,
      wordChannelId: null,
      wordMaxWords: DEFAULT_WORD_MAX_WORDS,
    },
    completedDates: [],
    wishIndexes: [],
    birthdays: [],
    wordGame: null,
  };
}

export function transform(data: LegacyData, now: Date = new Date()): Plan {
  const skipped: Plan['skipped'] = {};
  const skip: Skip = (code, count = 1) => {
    skipped[code] = (skipped[code] ?? 0) + count;
  };

  const [year, month, day] = businessDate(now).split('-').map(Number) as [number, number, number];
  const todayNumber = dayNumber(year, month, day) as number;
  const oldestKept = todayNumber - COMPLETED_DATE_WINDOW_DAYS;

  const guilds = new Map<string, PlannedGuild>();

  /** The guild row's plan entry and value, or null (one counted skip) when it cannot be loaded. */
  const guildRow = (row: LegacyRow): [PlannedGuild, Record<string, unknown>] | null => {
    if (!SnowflakeSchema.safeParse(row.id).success) {
      skip('GUILD_KEY_INVALID');
      return null;
    }
    if (!isRecord(row.value)) {
      skip('ROW_NOT_OBJECT');
      return null;
    }
    let guild = guilds.get(row.id);
    if (!guild) {
      guild = newGuild(row.id);
      guilds.set(row.id, guild);
    }
    return [guild, row.value];
  };

  const channel = (value: unknown): string | null => {
    if (value === undefined || value === null || value === '') return null;
    const parsed = SnowflakeSchema.safeParse(value);
    if (parsed.success) return parsed.data;
    skip('CHANNEL_ID_INVALID');
    return null;
  };

  for (const row of data.rows.birthday) {
    if (row.id === 'max') continue;
    const parsedRow = guildRow(row);
    if (!parsedRow) continue;
    const [guild, value] = parsedRow;

    guild.config.birthdayChannelId = channel(value['channel']);
    guild.birthdays = birthdaysOf(value['data'], skip);

    for (const [key, used] of entriesOf(value['wishes'])) {
      if (used !== false) continue;
      if (!/^\d+$/.test(key)) {
        skip('WISH_INDEX_INVALID');
      } else if (Number(key) >= BIRTHDAY_WISHES.length) {
        skip('WISH_INDEX_OUT_OF_RANGE');
      } else {
        guild.wishIndexes.push(Number(key));
      }
    }
    guild.wishIndexes.sort((a, b) => a - b);

    for (const [key, done] of entriesOf(value['completedDates'])) {
      const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(key);
      const number = match ? dayNumber(Number(match[1]), Number(match[2]), Number(match[3])) : null;
      if (number === null) {
        skip('COMPLETED_DATE_INVALID');
      } else if (done !== true) {
        continue;
      } else if (number < oldestKept) {
        skip('COMPLETED_DATE_EXPIRED');
      } else if (number > todayNumber) {
        // A future claim would suppress that day's greeting once it arrives.
        skip('COMPLETED_DATE_IN_FUTURE');
      } else {
        guild.completedDates.push(isoOf(number));
      }
    }
    guild.completedDates.sort();

    if (value['isCompleted'] !== undefined) skip('LEGACY_IS_COMPLETED_DROPPED');
  }

  for (const row of data.rows.config) {
    const parsedRow = guildRow(row);
    if (!parsedRow) continue;
    const [guild, value] = parsedRow;
    guild.config.introChannelId = channel(value['intro_channel']);
    guild.config.logChannelId = channel(value['log_channel']);
  }

  for (const row of data.rows.word) {
    const parsedRow = guildRow(row);
    if (!parsedRow) continue;
    const [guild, value] = parsedRow;
    guild.config.wordChannelId = channel(value['channelID']);

    const maxWords = value['maxWords'];
    if (maxWords !== undefined && maxWords !== null) {
      if (Number.isInteger(maxWords) && (maxWords as number) >= MIN_WORD_MAX_WORDS) {
        guild.config.wordMaxWords = maxWords as number;
      } else {
        skip('WORD_MAX_WORDS_DEFAULTED');
      }
    }
    guild.wordGame = wordGameOf(value, skip);
  }

  if (data.rows.note.length > 0) skip('NOTE_UNATTRIBUTABLE', data.rows.note.length);

  return PlanSchema.parse({
    guilds: [...guilds.values()].sort((a, b) => a.discordId.localeCompare(b.discordId)),
    skipped,
    noteRows: data.rows.note.length,
  });
}

function birthdaysOf(data: unknown, skip: Skip): PlannedBirthday[] {
  const result: PlannedBirthday[] = [];
  const seen = new Set<string>();
  for (const [monthKey, days] of entriesOf(data)) {
    for (const [dayKey, people] of entriesOf(days)) {
      if (!Array.isArray(people)) {
        skip('BIRTHDAY_DAY_NOT_LIST');
        continue;
      }
      const month = Number(monthKey);
      const day = Number(dayKey);
      for (const person of people as unknown[]) {
        if (!isRecord(person)) {
          skip('BIRTHDAY_ENTRY_INVALID');
          continue;
        }
        const studentId =
          typeof person['id'] === 'number' ? String(person['id']) : nonEmptyString(person['id']);
        const discordId = nonEmptyString(person['discordId']);
        const name = typeof person['name'] === 'string' ? person['name'] : null;
        if (studentId === null || discordId === null || name === null) {
          skip('BIRTHDAY_ENTRY_INVALID');
        } else if (!isValidMonthDay(month, day)) {
          skip('BIRTHDAY_DATE_INVALID');
        } else if (seen.has(studentId)) {
          skip('BIRTHDAY_DUPLICATE_STUDENT');
        } else {
          seen.add(studentId);
          result.push({ studentId, name, discordId, month, day });
        }
      }
    }
  }
  return result;
}

/**
 * quick.db stores a word as the path `used.<word>`, so a word containing a dot
 * comes back as nested objects; joining the keys with `.` restores the word.
 */
function usedWordsOf(value: unknown, prefix = ''): string[] {
  const words: string[] = [];
  for (const [key, child] of entriesOf(value)) {
    const word = prefix === '' ? key : `${prefix}.${key}`;
    if (child !== null && typeof child === 'object' && Object.keys(child).length > 0) {
      words.push(...usedWordsOf(child, word));
    } else {
      words.push(word);
    }
  }
  return words;
}

function wordGameOf(value: Record<string, unknown>, skip: Skip): PlannedWordGame {
  const words = new Set<string>();
  for (const word of usedWordsOf(isRecord(value['used']) ? value['used'] : {})) {
    const normalized = word.trim().toLowerCase();
    if (normalized === '') {
      skip('WORD_EMPTY');
    } else {
      words.add(normalized);
    }
  }
  const count = value['count'];
  return {
    // Same reading as the old code, which tests the flag for truthiness.
    started: Boolean(value['start']),
    lastUserId: typeof value['lastUser'] === 'string' ? value['lastUser'] : '',
    lastWord: typeof value['lastWord'] === 'string' ? value['lastWord'].toLowerCase() : '',
    count: Number.isInteger(count) && (count as number) > 0 ? (count as number) : 0,
    words: [...words],
  };
}
