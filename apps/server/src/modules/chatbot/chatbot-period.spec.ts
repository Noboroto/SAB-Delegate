import { describe, expect, it } from 'vitest';
import { periodOf } from './chatbot-period.js';

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
