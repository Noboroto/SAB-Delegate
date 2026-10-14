import { describe, expect, it } from 'vitest';
import { uptimeParts } from './uptime';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('uptimeParts', () => {
  it('uses the largest unit the uptime reaches', () => {
    expect(uptimeParts(0)).toEqual({ unit: 'lessThanMinute' });
    expect(uptimeParts(59_999)).toEqual({ unit: 'lessThanMinute' });
    expect(uptimeParts(MINUTE)).toEqual({ unit: 'minutes', minutes: 1 });
    expect(uptimeParts(HOUR + 5 * MINUTE)).toEqual({ unit: 'hours', hours: 1, minutes: 5 });
    expect(uptimeParts(2 * DAY + 3 * HOUR + 4 * MINUTE + 5_000)).toEqual({
      unit: 'days',
      days: 2,
      hours: 3,
      minutes: 4,
    });
  });

  it('keeps zero hours inside a day-sized uptime', () => {
    expect(uptimeParts(DAY)).toEqual({ unit: 'days', days: 1, hours: 0, minutes: 0 });
  });
});
