import { describe, expect, it } from 'vitest';
import { dayEndIso, dayOf, dayStartIso } from './day-range';

describe('day range in the business zone', () => {
  it('starts a day at midnight in Ho Chi Minh time, not in UTC', () => {
    expect(dayStartIso('2026-10-16')).toBe('2026-10-15T17:00:00.000Z');
  });

  it('ends a day on its last millisecond so a filter up to that day keeps the whole day', () => {
    expect(dayEndIso('2026-10-16')).toBe('2026-10-16T16:59:59.999Z');
  });

  it('names the business-zone day an instant falls on', () => {
    expect(dayOf('2026-10-15T17:00:00.000Z')).toBe('2026-10-16');
    expect(dayOf('2026-10-16T16:59:59.999Z')).toBe('2026-10-16');
    expect(dayOf('2026-10-16T17:00:00.000Z')).toBe('2026-10-17');
  });

  it('round-trips a picked day', () => {
    expect(dayOf(dayStartIso('2026-01-01'))).toBe('2026-01-01');
    expect(dayOf(dayEndIso('2026-01-01'))).toBe('2026-01-01');
  });

  it('answers nothing for text that is not a day', () => {
    expect(dayStartIso('')).toBeUndefined();
    expect(dayEndIso('16/10/2026')).toBeUndefined();
    expect(dayOf(undefined)).toBe('');
    expect(dayOf('soon')).toBe('');
  });
});
