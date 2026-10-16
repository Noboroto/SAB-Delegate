import { describe, expect, it } from 'vitest';
import { nextPeriodStart, periodOf, resetMarkup } from './chatbot-period.js';

describe('periodOf', () => {
  it('rolls over at midnight in the business zone, not in UTC', () => {
    expect(periodOf(new Date('2026-10-31T16:59:59Z'))).toBe('2026-10');
    expect(periodOf(new Date('2026-10-31T17:00:00Z'))).toBe('2026-11');
  });

  it('crosses the year at midnight in the business zone', () => {
    expect(periodOf(new Date('2026-12-31T16:59:59.999Z'))).toBe('2026-12');
    expect(periodOf(new Date('2026-12-31T17:00:00Z'))).toBe('2027-01');
  });

  it('agrees with the UTC month at the first instant of a UTC month', () => {
    // 00:00 UTC is already 07:00 local, so the local month matches the UTC one.
    expect(periodOf(new Date('2026-03-01T00:00:00Z'))).toBe('2026-03');
  });

  it('pads a single-digit month', () => {
    expect(periodOf(new Date('2026-02-15T12:00:00Z'))).toBe('2026-02');
  });
});

describe('nextPeriodStart', () => {
  const next = (iso: string) => nextPeriodStart(new Date(iso)).toISOString();

  it('is midnight on day 1 of the next month in the business zone', () => {
    expect(next('2026-10-16T16:33:00Z')).toBe('2026-10-31T17:00:00.000Z');
  });

  it('is still the same boundary in the last second of the month', () => {
    expect(next('2026-12-31T16:59:59Z')).toBe('2026-12-31T17:00:00.000Z');
  });

  it('crosses the year', () => {
    expect(next('2026-12-31T17:00:00Z')).toBe('2027-01-31T17:00:00.000Z');
  });

  it('agrees with periodOf at the boundary', () => {
    for (const iso of ['2026-10-16T16:33:00Z', '2026-12-31T17:00:00Z', '2026-02-28T20:00:00Z']) {
      const date = new Date(iso);
      const start = nextPeriodStart(date);
      expect(periodOf(new Date(start.getTime() - 1))).toBe(periodOf(date));
      expect(periodOf(start)).not.toBe(periodOf(date));
    }
  });
});

describe('resetMarkup', () => {
  it('is a relative Discord timestamp of the next period start', () => {
    expect(resetMarkup(new Date('2026-10-16T16:33:00Z'))).toBe(`<t:${1_793_466_000}:R>`);
  });
});
