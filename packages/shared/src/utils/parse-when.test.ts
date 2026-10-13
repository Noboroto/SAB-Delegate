import { describe, expect, it } from 'vitest';
import {
  formatDiscordTimestamp,
  formatIctDate,
  formatWhenIct,
  parseRunAt,
  parseWhen,
  toIct,
} from './parse-when.js';

// Tuesday 13 October 2026, 10:00 in Vietnam.
const NOW = new Date('2026-10-13T03:00:00.000Z');

const at = (time: string, date?: string | null, now = NOW) => parseWhen({ time, date }, now);
const iso = (result: ReturnType<typeof parseWhen>) =>
  'at' in result ? result.at.toISOString() : result;

describe('parseWhen with a clock time', () => {
  it('reads HH:mm as today in Vietnam time', () => {
    expect(iso(at('14:30'))).toBe('2026-10-13T07:30:00.000Z');
    expect(iso(at('11:05', 'today'))).toBe('2026-10-13T04:05:00.000Z');
    expect(iso(at('9:05', 'tomorrow'))).toBe('2026-10-14T02:05:00.000Z');
  });

  it('reads seconds when given', () => {
    expect(iso(at('14:30:45'))).toBe('2026-10-13T07:30:45.000Z');
  });

  it('puts the same time tomorrow on the next day', () => {
    expect(iso(at('09:00', 'tomorrow'))).toBe('2026-10-14T02:00:00.000Z');
    expect(iso(at('09:00', 'Ngày mai'))).toBe('2026-10-14T02:00:00.000Z');
  });

  it('refuses a time that has already passed today instead of guessing tomorrow', () => {
    expect(at('09:00')).toEqual({ error: 'PAST' });
    expect(at('10:00')).toEqual({ error: 'PAST' });
  });

  it('refuses a clock that does not exist', () => {
    for (const time of ['24:00', '12:60', '12:00:60', '1200', 'noon', '12:5']) {
      expect(at(time), time).toEqual({ error: 'INVALID_TIME' });
    }
  });

  it('asks for a time when there is none', () => {
    expect(at('')).toEqual({ error: 'TIME_REQUIRED' });
    expect(at('   ')).toEqual({ error: 'TIME_REQUIRED' });
  });
});

describe('parseWhen with a relative time', () => {
  it('counts from now', () => {
    expect(iso(at('30m'))).toBe('2026-10-13T03:30:00.000Z');
    expect(iso(at('2h'))).toBe('2026-10-13T05:00:00.000Z');
    expect(iso(at('1h30m'))).toBe('2026-10-13T04:30:00.000Z');
    expect(iso(at('90s'))).toBe('2026-10-13T03:01:30.000Z');
    expect(iso(at(' 1H 30M '))).toBe('2026-10-13T04:30:00.000Z');
  });

  it('refuses a span of zero and a date next to a span', () => {
    expect(at('0m')).toEqual({ error: 'PAST' });
    expect(at('30m', 'tomorrow')).toEqual({ error: 'RELATIVE_WITH_DATE' });
  });

  it('does not take text that only looks like a span', () => {
    for (const time of ['m', '30', '30x', '1m1h']) {
      expect(at(time), time).toEqual({ error: 'INVALID_TIME' });
    }
  });
});

describe('parseWhen with a date', () => {
  it('reads dd/MM and dd/MM/yyyy', () => {
    expect(iso(at('08:00', '20/10'))).toBe('2026-10-20T01:00:00.000Z');
    expect(iso(at('08:00', '5/11/2026'))).toBe('2026-11-05T01:00:00.000Z');
    expect(iso(at('08:00', '20-10-2026'))).toBe('2026-10-20T01:00:00.000Z');
  });

  it('does not cap the year', () => {
    expect(iso(at('08:00', '15/10/2035'))).toBe('2035-10-15T01:00:00.000Z');
    expect(iso(at('08:00', '01/01/2099'))).toBe('2099-01-01T01:00:00.000Z');
  });

  it('takes a date without a year as the next time it comes round', () => {
    expect(iso(at('08:00', '05/01'))).toBe('2027-01-05T01:00:00.000Z');
    expect(iso(at('08:00', '12/10'))).toBe('2027-10-12T01:00:00.000Z');
    // Today is not "before today": the time of day decides.
    expect(at('09:00', '13/10')).toEqual({ error: 'PAST' });
    expect(iso(at('11:00', '13/10'))).toBe('2026-10-13T04:00:00.000Z');
  });

  it('refuses a day that is not on the calendar', () => {
    for (const date of ['31/02', '31/04/2027', '29/02/2027', '00/10', '10/13', '32/01/2027']) {
      expect(at('08:00', date), date).toEqual({ error: 'NONEXISTENT_DATE' });
    }
    expect(iso(at('08:00', '29/02/2028'))).toBe('2028-02-29T01:00:00.000Z');
  });

  it('refuses a date in the past', () => {
    expect(at('08:00', '12/10/2026')).toEqual({ error: 'PAST' });
    expect(at('08:00', '01/01/2020')).toEqual({ error: 'PAST' });
  });

  it('refuses text that is not a date', () => {
    for (const date of ['next week', '2026-10-20', '20/10/26', '20']) {
      expect(at('08:00', date), date).toEqual({ error: 'INVALID_DATE' });
    }
  });

  it('treats a missing or blank date as today', () => {
    expect(iso(at('14:30', null))).toBe(iso(at('14:30', '  ')));
  });
});

describe('parseWhen around midnight in Vietnam', () => {
  it('resolves today and tomorrow by the Vietnamese date, not the UTC date', () => {
    // 23:59 on the 13th in Vietnam, still the 13th in UTC too.
    const lateEvening = new Date('2026-10-13T16:59:00.000Z');
    expect(iso(at('00:30', 'tomorrow', lateEvening))).toBe('2026-10-13T17:30:00.000Z');
    // 00:30 on the 14th in Vietnam is still the 13th in UTC.
    const justAfterMidnight = new Date('2026-10-13T17:30:00.000Z');
    expect(iso(at('08:00', 'today', justAfterMidnight))).toBe('2026-10-14T01:00:00.000Z');
    expect(iso(at('08:00', 'tomorrow', justAfterMidnight))).toBe('2026-10-15T01:00:00.000Z');
  });

  it('rolls the year over from the Vietnamese date', () => {
    const newYearsEve = new Date('2026-12-31T16:30:00.000Z');
    expect(iso(at('08:00', 'tomorrow', newYearsEve))).toBe('2027-01-01T01:00:00.000Z');
  });
});

describe('parseRunAt', () => {
  it('reads an instant with an offset or Z', () => {
    expect(parseRunAt('2026-10-20T09:30:00+07:00')?.toISOString()).toBe('2026-10-20T02:30:00.000Z');
    expect(parseRunAt('2026-10-20T09:30:00Z')?.toISOString()).toBe('2026-10-20T09:30:00.000Z');
    expect(parseRunAt('2026-10-20T09:30:00-05:30')?.toISOString()).toBe('2026-10-20T15:00:00.000Z');
    expect(parseRunAt('2026-10-20T09:30:00.250Z')?.toISOString()).toBe('2026-10-20T09:30:00.000Z');
  });

  it('reads a time with no offset as Vietnam time', () => {
    expect(parseRunAt('2026-10-20T09:30')?.toISOString()).toBe('2026-10-20T02:30:00.000Z');
    expect(parseRunAt('2026-10-20 09:30:15')?.toISOString()).toBe('2026-10-20T02:30:15.000Z');
  });

  it('refuses what is not an instant or not on the calendar', () => {
    for (const text of [
      '',
      'tomorrow',
      '2026-10-20',
      '2026-02-31T09:00:00Z',
      '2026-10-20T24:00:00Z',
      '2026-10-20T09:60:00Z',
      '2026-10-20T09:00:00+25:00',
      '20/10/2026 09:00',
    ]) {
      expect(parseRunAt(text), text).toBeNull();
    }
  });
});

describe('formatting', () => {
  it('prints a Discord timestamp in full and relative form', () => {
    expect(formatDiscordTimestamp(new Date(1_800_000_000_000))).toBe(
      '<t:1800000000:F> (<t:1800000000:R>)',
    );
  });

  it('prints Vietnam wall-clock time whatever the host zone', () => {
    expect(formatWhenIct(new Date('2026-10-13T17:05:00.000Z'))).toBe('14/10/2026 00:05');
    expect(formatIctDate({ year: 2026, month: 3, day: 7 })).toBe('07/03/2026');
    expect(toIct(new Date('2026-10-13T17:05:09.000Z'))).toEqual({
      year: 2026,
      month: 10,
      day: 14,
      hour: 0,
      minute: 5,
      second: 9,
    });
  });
});
