import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime } from './format-datetime';

// 17:30 UTC on 1 January is 00:30 on 2 January in Asia/Ho_Chi_Minh (UTC+7).
const INSTANT = '2026-01-01T17:30:00Z';

describe('formatDateTime', () => {
  it('reads the clock in the business time zone, whatever the machine zone is', () => {
    expect(formatDateTime(INSTANT, 'en')).toBe('2 Jan 2026, 00:30');
    expect(formatDate(INSTANT, 'en')).toBe('2 Jan 2026');
  });

  it('uses 24-hour time and the Vietnamese date format for vi', () => {
    const text = formatDateTime(INSTANT, 'vi');
    expect(text).toContain('00:30');
    expect(text).toContain('2026');
    expect(text).toMatch(/\b2\b/);
  });

  it('accepts a Date and an epoch number', () => {
    const date = new Date(INSTANT);
    expect(formatDateTime(date, 'en')).toBe(formatDateTime(date.getTime(), 'en'));
  });
});
